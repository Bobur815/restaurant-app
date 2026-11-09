import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { IPC_CHANNELS, type AppEvent, type IpcChannel } from '@shared/ipc';
import type { IpcResult } from '@shared/errors';
import type { Actor, Db } from '../domain/db';
import { AppError } from '../domain/errors';
import { IMAGE_MIME, resolveImagePath } from '../images/image-store';
import { eventsFor } from '../ipc/events';
import { HANDLERS } from '../ipc/handlers';
import {
  invokeHandler,
  toIpcError,
  type HandlerContext,
  type HandlerServices,
} from '../ipc/ipc-safe';
import { authenticateDevice, createDevice } from './devices';
import type { PairingStore } from './pairing';
import { isLocalAddress } from './serve-policy';

/**
 * Feature F12: the main till's server for its satellites (posgro local-server pattern: plain
 * node:http, no framework). A satellite's renderer is unchanged: its main process forwards every
 * IPC call here, and this runs the very same handler (`invokeHandler`) with the satellite's user as
 * the actor. So access, validation, the licence and every database guard are the main till's.
 *
 * Routes (all refused for callers outside the shop's network):
 *   GET  /health      no auth: { app, version } (enough for the join form to know what answers)
 *   POST /pair        no auth, the pairing code (throttled): { deviceId, secret, lineage, version }
 *   GET  /hello       device: { lineage, version } (the satellite checks it is still its main)
 *   POST /rpc         device: { channel, input } -> { result, session? }
 *   GET  /events      device: Server-Sent Events, every AppEvent the main till broadcasts
 *   GET  /img/<file>  device: a picture from the image store
 *
 * Credentials: `Authorization: SavdoChef <deviceId>.<secret>` names the till (a device secret from
 * pairing, kept hashed); `X-Session` names who is signed in at it (an in-memory token made when a
 * PIN login over RPC succeeds, bound to that device, dropped on logout, revoke or restart).
 */

/** Channels a satellite never runs on the main till: they belong to the machine they run on. */
export const NOT_OVER_LAN: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  'setup:complete',
  'updater:status',
  'updater:check',
  'updater:download',
  'updater:install',
  // A file dialog would open on the main till's screen.
  'menu:pickImage',
  'receipt:pickImage',
  // Linking the restaurant is done on the main till itself.
  'license:signupStart',
  'license:signupStatus',
  'license:signupComplete',
  'license:activate',
  'lan:status',
  'lan:update',
  'lan:pairingCode',
  'lan:cancelPairing',
  'lan:revoke',
  'lan:link',
  'lan:join',
  'lan:leave',
]);

/** The largest call a satellite makes (a dish with its fields, an order with lines) is a few KB. */
const MAX_RPC_BODY = 1024 * 1024;
const MAX_PAIR_BODY = 4 * 1024;
const SSE_PING_MS = 20_000;
/** Event streams per satellite (a restart may overlap the old one briefly). */
const MAX_STREAMS_PER_DEVICE = 2;
/** A satellite that stops reading its stream loses it rather than growing the main till's memory. */
const MAX_STREAM_BACKLOG = 1024 * 1024;
const MAX_CONNECTIONS = 64;

/** Sign-in channels: run one at a time over the LAN, with a lock per satellite (see rpc). */
const AUTH_CHANNELS: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  'auth:pinLogin',
  'auth:recover',
  'auth:bootstrapPin',
]);
/** Wrong PINs from one satellite before it waits, below the till-wide lock in auth.ts. */
const DEVICE_PIN_FAILURES = 3;
const DEVICE_PIN_LOCK_MS = 5 * 60 * 1000;

export interface LanServerDeps {
  getDb(): Db;
  /** The main till's services; pickImage is never reached (NOT_OVER_LAN). */
  services: HandlerServices;
  imageDir: string;
  version: string;
  lineage(): Promise<string>;
  pairing: PairingStore;
  /** Satellites the plan allows; null = no limit. */
  deviceLimit(): number | null;
  /** The main till's own windows; the server adds its satellites (broadcast below). */
  broadcastLocal(events: AppEvent[]): void;
  /** A satellite paired: the settings page re-reads, the serve policy is checked again. */
  onPaired(): void;
  log(message: string, error?: unknown): void;
}

interface Session {
  deviceId: number;
  actor: Actor | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class LanServer {
  private server: Server | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly streams = new Map<ServerResponse, number>();
  private ping: NodeJS.Timeout | null = null;
  /**
   * Sign-ins over the LAN go one after the other: the till-wide lock in auth.ts reads, then writes,
   * so parallel guesses would all pass its check before the first failure was written.
   */
  private authQueue: Promise<unknown> = Promise.resolve();
  private readonly pinFailures = new Map<number, { count: number; until: number }>();

  constructor(private readonly deps: LanServerDeps) {}

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  get port(): number | null {
    const a = this.server?.address();
    return a && typeof a === 'object' ? a.port : null;
  }

  async start(port: number, host = '0.0.0.0'): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    // Slow or idle sockets do not hold the till: requests finish in seconds, events ping.
    server.requestTimeout = 60_000;
    server.headersTimeout = 15_000;
    server.maxConnections = MAX_CONNECTIONS;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.ping = setInterval(() => this.write(': ping\n\n'), SSE_PING_MS);
    this.ping.unref();
  }

  async stop(): Promise<void> {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    for (const res of this.streams.keys()) res.end();
    this.streams.clear();
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /** Every AppEvent the main till broadcasts reaches its satellites too. */
  push(events: AppEvent[]): void {
    if (events.length === 0) return;
    this.write(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
  }

  private write(data: string): void {
    for (const res of this.streams.keys()) {
      if (res.writableLength > MAX_STREAM_BACKLOG) res.end();
      else res.write(data);
    }
  }

  /** A revoked satellite loses its sessions and its event stream at once. */
  dropDevice(deviceId: number): void {
    this.deps.services.tableLocks.releaseTerminal(lanTerminal(deviceId));
    for (const [token, s] of this.sessions)
      if (s.deviceId === deviceId) this.sessions.delete(token);
    for (const [res, id] of this.streams) if (id === deviceId) res.end();
  }

  private broadcast(events: AppEvent[]): void {
    this.deps.broadcastLocal(events);
    this.push(events);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!isLocalAddress(ip)) {
      req.socket.destroy();
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://lan');
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { app: 'savdochef', version: this.deps.version });
      }
      if (req.method === 'POST' && url.pathname === '/pair') return await this.pair(req, res, ip);

      const device = await authenticateDevice(this.deps.getDb(), credentialOf(req), ip);
      if (!device) throw new HttpError(401, 'Bu kassa asosiy kassada ulanmagan');

      if (req.method === 'GET' && url.pathname === '/hello') {
        return json(res, 200, { lineage: await this.deps.lineage(), version: this.deps.version });
      }
      if (req.method === 'POST' && url.pathname === '/rpc')
        return await this.rpc(req, res, device.id);
      if (req.method === 'GET' && url.pathname === '/events') return this.events(res, device.id);
      if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
        let fileName: string;
        try {
          fileName = decodeURIComponent(url.pathname.slice(5));
        } catch {
          throw new HttpError(404, 'Not found');
        }
        return await this.image(res, fileName);
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) return json(res, error.status, { error: error.message });
      if (error instanceof AppError) return json(res, 409, { error: error.toIpc() });
      this.deps.log('[lan] request failed', error);
      return json(res, 500, { error: 'Kutilmagan xatolik' });
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    const body = (await readJson(req, MAX_PAIR_BODY)) as { code?: unknown; name?: unknown };
    const code = typeof body.code === 'string' ? body.code : '';
    const outcome = this.deps.pairing.redeem(code, ip);
    if (outcome === 'throttled')
      throw new HttpError(429, "Ko'p marta noto'g'ri kod. 10 daqiqadan keyin urinib ko'ring");
    if (outcome === 'closed')
      throw new HttpError(403, 'Asosiy kassada juftlash kodi ochilmagan yoki muddati tugagan');
    if (outcome === 'wrong') throw new HttpError(403, "Kod noto'g'ri");
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const device = await createDevice(this.deps.getDb(), name, ip, this.deps.deviceLimit());
    this.deps.log(`[lan] paired device ${device.id} (${name}) from ${ip}`);
    this.deps.onPaired();
    return json(res, 200, {
      deviceId: device.id,
      secret: device.secret,
      lineage: await this.deps.lineage(),
      version: this.deps.version,
    });
  }

  private async rpc(req: IncomingMessage, res: ServerResponse, deviceId: number): Promise<void> {
    const body = (await readJson(req, MAX_RPC_BODY)) as { channel?: unknown; input?: unknown };
    const channel = body.channel as IpcChannel;
    if (typeof channel !== 'string' || !(IPC_CHANNELS as readonly string[]).includes(channel)) {
      throw new HttpError(400, 'Unknown channel');
    }
    if (NOT_OVER_LAN.has(channel)) {
      const result: IpcResult<never> = {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Bu amal faqat asosiy kassada bajariladi' },
      };
      return json(res, 200, { result });
    }

    const token = req.headers['x-session'];
    const presented = typeof token === 'string' ? token : null;
    const found = presented ? this.sessions.get(presented) : undefined;
    // A session from another till is no session (and this call must not touch it).
    const session = found && found.deviceId === deviceId ? found : undefined;
    let actor: Actor | null = session?.actor ?? null;
    let changed = false;
    const ctx: HandlerContext = {
      db: this.deps.getDb(),
      actor,
      setActor: (a) => {
        actor = a;
        changed = true;
      },
      terminal: lanTerminal(deviceId),
      services: this.deps.services,
      log: (message, error) => this.deps.log(`${message} (satellite ${deviceId})`, error),
    };
    const run = async (): Promise<IpcResult<unknown>> => {
      try {
        return await invokeHandler(channel, HANDLERS[channel] as never, ctx, body.input);
      } catch (error) {
        return { ok: false, error: toIpcError(error, ctx.log, channel) };
      }
    };
    let result: IpcResult<unknown>;
    if (AUTH_CHANNELS.has(channel)) {
      this.deps.log(`[lan] ${channel} from satellite ${deviceId}`);
      result = await this.signIn(deviceId, run);
      if (!result.ok)
        this.deps.log(`[lan] ${channel} refused for satellite ${deviceId}: ${result.error.code}`);
    } else {
      result = await run();
    }

    let sessionOut: string | null | undefined;
    if (changed) {
      if (presented && session) this.sessions.delete(presented);
      if (actor) {
        sessionOut = randomBytes(32).toString('hex');
        this.sessions.set(sessionOut, { deviceId, actor });
      } else {
        sessionOut = null;
      }
    } else if (presented && !session) {
      // A token from another till, or one the main till forgot.
      // The main till restarted (or revoked it): the satellite signs in again.
      sessionOut = null;
    }
    if (result.ok) this.broadcast(eventsFor(channel, body.input as never, result.data as never));
    return json(res, 200, sessionOut === undefined ? { result } : { result, session: sessionOut });
  }

  /**
   * One sign-in at a time for the whole server, and a lock per satellite after a few wrong tries,
   * so one satellite guessing cannot lock the PIN pad of every till (the lock in auth.ts is
   * till-wide) before its own runs out.
   */
  private signIn(
    deviceId: number,
    run: () => Promise<IpcResult<unknown>>,
  ): Promise<IpcResult<unknown>> {
    const next = this.authQueue.then(async (): Promise<IpcResult<unknown>> => {
      const now = Date.now();
      const f = this.pinFailures.get(deviceId) ?? { count: 0, until: 0 };
      if (f.until > now) {
        return {
          ok: false,
          error: {
            code: 'LOCKED',
            message: 'Juda ko‘p noto‘g‘ri urinish. Birozdan keyin qayta urinib ko‘ring',
            details: { lockedUntil: new Date(f.until).toISOString() },
          },
        };
      }
      const result = await run();
      if (result.ok) {
        this.pinFailures.delete(deviceId);
      } else if (result.error.code !== 'LOCKED') {
        const count = f.count + 1;
        this.pinFailures.set(
          deviceId,
          count >= DEVICE_PIN_FAILURES
            ? { count: 0, until: now + DEVICE_PIN_LOCK_MS }
            : { count, until: 0 },
        );
      }
      return result;
    });
    this.authQueue = next.catch(() => undefined);
    return next;
  }

  private events(res: ServerResponse, deviceId: number): void {
    // A satellite has one stream; a restart may briefly make a second. Older ones beyond that go.
    const mine = [...this.streams].filter(([, id]) => id === deviceId).map(([r]) => r);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_DEVICE + 1)))
      old.end();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.streams.set(res, deviceId);
    res.on('close', () => {
      this.streams.delete(res);
      // F13: a satellite whose line dropped holds no table (it takes it again when it renews).
      if (![...this.streams.values()].includes(deviceId))
        this.deps.services.tableLocks.releaseTerminal(lanTerminal(deviceId));
    });
  }

  private async image(res: ServerResponse, fileName: string): Promise<void> {
    const full = resolveImagePath(this.deps.imageDir, fileName);
    if (!full) throw new HttpError(404, 'Not found');
    const data = await fs.promises.readFile(full).catch(() => null);
    if (!data) throw new HttpError(404, 'Not found');
    const ext = path.extname(full).slice(1) as keyof typeof IMAGE_MIME;
    res.writeHead(200, { 'content-type': IMAGE_MIME[ext], 'content-length': data.length });
    res.end(data);
  }
}

/** F13: a satellite, as a table-lock holder. */
const lanTerminal = (deviceId: number) => `lan:${deviceId}`;

function credentialOf(req: IncomingMessage): string {
  const h = req.headers.authorization ?? '';
  return h.startsWith('SavdoChef ') ? h.slice('SavdoChef '.length).trim() : '';
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'Too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}
