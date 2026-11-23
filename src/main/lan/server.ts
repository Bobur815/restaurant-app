import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { IPC_CHANNELS, type AppEvent, type IpcChannel } from '@shared/ipc';
import type { IpcResult } from '@shared/errors';
import type { MenuItemDto, SessionDto } from '@shared/types';
import type { Actor, Db } from '../domain/db';
import { AppError, conflict } from '../domain/errors';
import { IMAGE_MIME, resolveImagePath } from '../images/image-store';
import { eventsFor } from '../ipc/events';
import { HANDLERS } from '../ipc/handlers';
import {
  invokeHandler,
  toIpcError,
  type HandlerContext,
  type HandlerServices,
} from '../ipc/ipc-safe';
import {
  isWaiterChannel,
  isWaiterEvent,
  WAITER_PROTOCOL,
  type LanDeviceKind,
  type PairRefusal,
  type WaiterHelloDto,
} from '@shared/lan-waiter';
import {
  authenticateDevice,
  countActiveDevices,
  createDevice,
  LIMIT_MESSAGE,
  waiterWithinLimit,
} from './devices';
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
 * Feature F20: a waiter phone is a device too (`lan_devices.kind = 'waiter'`, from its pairing
 * code). It may call only `WAITER_CHANNELS`, whoever signs in on it, gets only `WAITER_EVENT_TYPES`
 * on its stream, and works only while it is among the first `waiterLimit()` phones paired.
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
  // F18: REGOS:VCR runs on the main till's PC; it is configured there (its password stays there).
  'fiscal:getConfig',
  'fiscal:setConfig',
  'fiscal:testConnection',
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
  /** F20: waiter phones the plan allows (0 = the plan has no waiter app). */
  waiterLimit(): number;
  /** F20: the restaurant's name for a phone's PIN screen ('' before the receipt is set up). */
  restaurantName(): Promise<string>;
  /** The main till's own windows; the server adds its satellites (broadcast below). */
  broadcastLocal(events: AppEvent[]): void;
  /** A satellite paired: the settings page re-reads, the serve policy is checked again. */
  onPaired(): void;
  /**
   * F20-T: a device's line opened or closed, or who is signed in on it changed (the settings
   * page shows "Onlayn" and a phone's user from `presence()`).
   */
  onPresence?(): void;
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
    /** F20-W: why /pair refused, for the phone's error card (the message stays Uzbek). */
    readonly reason?: PairRefusal,
  ) {
    super(message);
  }
}

export class LanServer {
  private server: Server | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly streams = new Map<ServerResponse, { deviceId: number; kind: LanDeviceKind }>();
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
    this.ping = setInterval(() => this.write(() => ': ping\n\n'), SSE_PING_MS);
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

  /** Every AppEvent the main till broadcasts reaches its satellites too (a phone only its own). */
  push(events: AppEvent[]): void {
    if (events.length === 0) return;
    // F20: the plan may have lost phones: those beyond it stop hearing at once.
    if (events.some((e) => e.type === 'license-changed')) void this.recheckWaiters();
    const frames = (list: AppEvent[]) => list.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const all = frames(events);
    const waiter = frames(events.filter(isWaiterEvent));
    this.write((kind) => (kind === 'waiter' ? waiter : all));
  }

  private write(data: (kind: LanDeviceKind) => string): void {
    for (const [res, { kind }] of this.streams) {
      const chunk = data(kind);
      if (!chunk) continue;
      if (res.writableLength > MAX_STREAM_BACKLOG) res.end();
      else res.write(chunk);
    }
  }

  /** F20: ends the event streams of phones the plan no longer allows (they cannot call either). */
  async recheckWaiters(): Promise<void> {
    const limit = this.deps.waiterLimit();
    for (const [res, s] of this.streams) {
      if (s.kind !== 'waiter') continue;
      try {
        if (!(await waiterWithinLimit(this.deps.getDb(), s.deviceId, limit))) res.end();
      } catch (error) {
        this.deps.log('[lan] phone limit check failed', error);
      }
    }
  }

  /**
   * F20-T: the devices whose event stream is open now (online), each with the name of whoever
   * signed in on it last (null = nobody). Names only: no role, token or permission leaves here.
   */
  presence(): Map<number, { userName: string | null }> {
    const out = new Map<number, { userName: string | null }>();
    for (const { deviceId } of this.streams.values()) out.set(deviceId, { userName: null });
    // Sessions are kept in the order they were made: the last one per device wins.
    for (const s of this.sessions.values()) {
      const entry = out.get(s.deviceId);
      if (entry && s.actor) entry.userName = s.actor.fullName;
    }
    return out;
  }

  /** A revoked satellite loses its sessions and its event stream at once. */
  dropDevice(deviceId: number): void {
    this.deps.services.tableLocks.releaseTerminal(lanTerminal(deviceId));
    for (const [token, s] of this.sessions)
      if (s.deviceId === deviceId) this.sessions.delete(token);
    for (const [res, s] of this.streams) if (s.deviceId === deviceId) res.end();
    this.deps.onPresence?.();
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
        if (device.kind === 'waiter') {
          const hello: WaiterHelloDto = {
            lineage: await this.deps.lineage(),
            version: this.deps.version,
            protocol: WAITER_PROTOCOL,
            restaurantName: await this.deps.restaurantName(),
          };
          return json(res, 200, hello);
        }
        return json(res, 200, { lineage: await this.deps.lineage(), version: this.deps.version });
      }
      // F20: a phone beyond the plan's phones (or on a plan without them) does nothing else.
      if (
        device.kind === 'waiter' &&
        !(await waiterWithinLimit(this.deps.getDb(), device.id, this.deps.waiterLimit()))
      ) {
        throw new HttpError(403, WAITER_LIMIT_MESSAGE);
      }
      if (req.method === 'POST' && url.pathname === '/rpc')
        return await this.rpc(req, res, device.id, device.kind);
      if (req.method === 'GET' && url.pathname === '/events')
        return this.events(res, device.id, device.kind);
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
      if (error instanceof HttpError) {
        return json(res, error.status, {
          error: error.message,
          ...(error.reason ? { reason: error.reason } : {}),
        });
      }
      if (error instanceof AppError) return json(res, 409, { error: error.toIpc() });
      this.deps.log('[lan] request failed', error);
      return json(res, 500, { error: 'Kutilmagan xatolik' });
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    const body = (await readJson(req, MAX_PAIR_BODY)) as {
      code?: unknown;
      name?: unknown;
      expect?: unknown;
    };
    const code = typeof body.code === 'string' ? body.code : '';
    // What the caller says it is can only narrow what the code allows (pairing.ts redeem).
    const expect =
      body.expect === 'waiter' || body.expect === 'till'
        ? (body.expect as LanDeviceKind)
        : undefined;
    // The plan and the device count are checked before the code is used up, so a refused
    // phone does not cost the owner the code (they free a slot and the same code still works).
    const open = this.deps.pairing.current();
    if (open && sameCode(code, open.code) && (!expect || expect === open.kind)) {
      const room = open.kind === 'waiter' ? this.deps.waiterLimit() : this.deps.deviceLimit();
      if (open.kind === 'waiter' && room === 0)
        throw new HttpError(403, WAITER_PLAN_MESSAGE, 'plan');
      if (room !== null && (await countActiveDevices(this.deps.getDb(), open.kind)) >= room) {
        throw conflict(LIMIT_MESSAGE[open.kind], {
          reason: 'DEVICE_LIMIT',
          limit: room,
          kind: open.kind,
        });
      }
    }
    const outcome = this.deps.pairing.redeem(code, ip, expect);
    if (outcome === 'throttled')
      throw new HttpError(
        429,
        "Ko'p marta noto'g'ri kod. 10 daqiqadan keyin urinib ko'ring",
        'throttled',
      );
    if (outcome === 'closed')
      throw new HttpError(
        403,
        'Asosiy kassada juftlash kodi ochilmagan yoki muddati tugagan',
        'expired',
      );
    if (outcome === 'wrong') throw new HttpError(403, "Kod noto'g'ri", 'wrong');
    if (outcome === 'kind')
      throw new HttpError(
        403,
        expect === 'waiter'
          ? "Bu kod kassa uchun. Asosiy kassada «Telefon qo'shish» tugmasini bosing"
          : 'Bu kod telefon uchun. Asosiy kassada «Juftlash kodini olish» tugmasini bosing',
        'kind',
      );
    // The kind is the code's (the owner chose it on the main till), never the caller's.
    const { kind } = outcome;
    const limit = kind === 'waiter' ? this.deps.waiterLimit() : this.deps.deviceLimit();
    if (kind === 'waiter' && limit === 0) throw new HttpError(403, WAITER_PLAN_MESSAGE, 'plan');
    // Stored and logged the same: no control, format (bidi, zero-width) or separator characters,
    // so a name cannot pass for another device; at most 60 characters, never half a surrogate.
    const name =
      typeof body.name === 'string'
        ? [
            ...body.name
              .replace(/\p{Cf}/gu, '')
              .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
              .replace(/ {2,}/g, ' ')
              .trim(),
          ]
            .slice(0, 60)
            .join('')
            .trim()
        : '';
    const device = await createDevice(this.deps.getDb(), name, ip, limit, kind);
    const what = kind === 'waiter' ? 'phone' : 'device';
    this.deps.log(`[lan] paired ${what} ${device.id} (${name}) from ${ip}`);
    this.deps.onPaired();
    return json(res, 200, {
      deviceId: device.id,
      secret: device.secret,
      lineage: await this.deps.lineage(),
      version: this.deps.version,
      ...(kind === 'waiter'
        ? { kind, protocol: WAITER_PROTOCOL, restaurantName: await this.deps.restaurantName() }
        : {}),
    });
  }

  private async rpc(
    req: IncomingMessage,
    res: ServerResponse,
    deviceId: number,
    kind: LanDeviceKind,
  ): Promise<void> {
    const body = (await readJson(req, MAX_RPC_BODY)) as { channel?: unknown; input?: unknown };
    const channel = body.channel as IpcChannel;
    if (typeof channel !== 'string' || !(IPC_CHANNELS as readonly string[]).includes(channel)) {
      throw new HttpError(400, 'Unknown channel');
    }
    // F20: a phone sells; everything else stays on the tills, even with an admin's PIN.
    if (kind === 'waiter' && !isWaiterChannel(channel)) {
      this.deps.log(`[lan] ${channel} refused for phone ${deviceId}`);
      const result: IpcResult<never> = {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Bu amal telefondan bajarilmaydi: kassada bajaring' },
      };
      return json(res, 200, { result });
    }
    if (NOT_OVER_LAN.has(channel)) {
      const result: IpcResult<never> = {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Bu amal faqat asosiy kassada bajariladi' },
      };
      return json(res, 200, { result });
    }
    if (kind === 'waiter') {
      // A phone never takes a table over from a till, whoever is signed in on it.
      if (channel === 'orders:lockTable' && body.input && typeof body.input === 'object') {
        body.input = { ...(body.input as Record<string, unknown>), force: false };
      }
      // A phone prints the pre-bill of an open table order only (not paid, takeaway or delivery).
      if (channel === 'printing:printPreBill') {
        const orderId = (body.input as { orderId?: unknown } | undefined)?.orderId;
        const order =
          typeof orderId === 'number' && Number.isInteger(orderId)
            ? await this.deps.getDb().order.findUnique({
                where: { id: orderId },
                select: { status: true, orderType: true },
              })
            : null;
        if (order && (order.status !== 'pending' || order.orderType !== 'DINE_IN')) {
          const result: IpcResult<never> = {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Telefondan faqat ochiq stol buyurtmasining hisobini chiqarish mumkin',
            },
          };
          return json(res, 200, { result });
        }
      }
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
        // One session per device: a phone or till that restarted without signing out leaves no
        // stale user behind (presence() shows the newest), and the map stays small.
        for (const [token, s] of this.sessions) {
          if (s.deviceId === deviceId) this.sessions.delete(token);
        }
        this.sessions.set(sessionOut, { deviceId, actor });
      } else {
        sessionOut = null;
      }
    } else if (presented && !session) {
      // A token from another till, or one the main till forgot.
      // The main till restarted (or revoked it): the satellite signs in again.
      sessionOut = null;
    }
    if (changed) this.deps.onPresence?.();
    if (result.ok) this.broadcast(eventsFor(channel, body.input as never, result.data as never));
    if (kind === 'waiter' && result.ok) result = { ok: true, data: forPhone(channel, result.data) };
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

  private events(res: ServerResponse, deviceId: number, kind: LanDeviceKind): void {
    // A satellite has one stream; a restart may briefly make a second. Older ones beyond that go.
    const mine = [...this.streams].filter(([, s]) => s.deviceId === deviceId).map(([r]) => r);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_DEVICE + 1)))
      old.end();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.streams.set(res, { deviceId, kind });
    this.deps.onPresence?.();
    res.on('close', () => {
      this.streams.delete(res);
      // F13: a satellite whose line dropped holds no table (it takes it again when it renews).
      if (![...this.streams.values()].some((s) => s.deviceId === deviceId))
        this.deps.services.tableLocks.releaseTerminal(lanTerminal(deviceId));
      this.deps.onPresence?.();
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

const WAITER_PLAN_MESSAGE = "Tarifingizda ofitsiant ilovasi yo'q (Standard va Pro tariflarida bor)";
const WAITER_LIMIT_MESSAGE =
  'Tarifdagi telefonlar soni tugagan: bu telefon ishlamaydi. Asosiy kassada ortiqcha telefonni ajrating';

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

/**
 * F20-W: what a phone is not shown, whoever signs in on it: a dish's cost price, kitchen printer
 * and fiscal codes, and the shift's cash drawer (an admin's PIN on a phone would otherwise get it).
 * The till's own windows and satellites get the answers unchanged.
 */
export function forPhone(channel: IpcChannel, data: unknown): unknown {
  if (channel === 'menu:list' && Array.isArray(data)) {
    return (data as MenuItemDto[]).map(
      (m): MenuItemDto => ({
        id: m.id,
        nameUz: m.nameUz,
        nameRu: m.nameRu,
        description: m.description,
        price: m.price,
        imageFile: m.imageFile,
        categoryId: m.categoryId,
        categoryNameUz: m.categoryNameUz,
        hasPortions: m.hasPortions,
        soldByWeight: m.soldByWeight,
        isActive: m.isActive,
        // The DTO's shape stays the till's; these are never filled for a phone.
        costPrice: null,
        printerId: null,
        mxik: null,
        packageCode: null,
      }),
    );
  }
  if (channel === 'sessions:getOpen' && data && typeof data === 'object') {
    const s = data as SessionDto;
    return {
      id: s.id,
      status: s.status,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openedBy: s.openedBy,
      closedBy: s.closedBy,
      items: s.items.map((i) => ({
        menuItemId: i.menuItemId,
        nameUz: i.nameUz,
        nameRu: i.nameRu,
        soldByWeight: i.soldByWeight,
        imageFile: i.imageFile,
        initialQuantity: i.initialQuantity,
        soldQuantity: i.soldQuantity,
        remainingQuantity: i.remainingQuantity,
        unlimited: i.unlimited,
      })),
      openingCash: null,
      countedCash: null,
      expectedCash: null,
    } satisfies SessionDto;
  }
  return data;
}

/** Constant-time comparison of a typed code with the open one. */
function sameCode(typed: string, open: string): boolean {
  const a = Buffer.from(typed.trim());
  const b = Buffer.from(open);
  return a.length === b.length && timingSafeEqual(a, b);
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
