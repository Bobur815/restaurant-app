import { randomUUID, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { IpcChannel } from '@shared/ipc';
import {
  LICENSE_FEATURES,
  type LicenseFeature,
  type LicensePlansDto,
  type LicenseStatusDto,
  type SignupStartDto,
} from '@shared/license';
import type { Db } from '../domain/db';
import { conflict } from '../domain/errors';
import { getSetupStatus } from '../settings/setup';
import {
  readLicense,
  refusal,
  tillState,
  type LicensePayload,
  type TillState,
} from './license-core';
import type { TrustedClock } from './trusted-clock';

/**
 * Feature F5: this till's licence from the posgro server (`/api/savdochef/*`). Main only; the
 * renderer asks through the license:* channels and never sees the token.
 *
 * The till works offline. It reaches the server to link a restaurant (setup wizard, or Settings →
 * Obuna), and to check in: quietly on start and every few hours while online, at least once every
 * 14 days (the licence's `checkinBy`), or when someone presses "Hozir tekshirish".
 *
 * Everything the server answers is checked here (zod) before it is stored or shown, and a licence
 * is accepted only with the compiled-in key's signature and only if it is newer than the one held:
 * an old licence played back cannot wind the trusted clock back.
 */

/** The posgro production API. A dev build may point elsewhere (main/index.ts `licenseApiUrl`). */
export const DEFAULT_API_URL = 'https://api.posgro.uz/api';
export const REQUEST_TIMEOUT_MS = 15_000;
export const BACKGROUND_EVERY_MS = 6 * 60 * 60 * 1000;
/** "Hozir tekshirish" pressed again within this long answers from what the till has. */
export const CHECK_MIN_INTERVAL_MS = 30_000;
const FIRST_BACKGROUND_DELAY_MS = 20_000;
const ROW_ID = 1;
const MAX_SERVER_TEXT = 300;

const OFFLINE = "Internetga ulanib bo'lmadi. Ulanishni tekshirib qayta urinib ko'ring";
const BAD_ANSWER = "Serverdan noto'g'ri javob keldi. Keyinroq urinib ko'ring";

// ── What the server may answer ─────────────────────────────────────────────────────────────

const shortText = (max: number) => z.string().max(max);
const featureList = z
  .array(z.string().max(40))
  .max(20)
  .transform((list) => LICENSE_FEATURES.filter((f) => list.includes(f)));

const plansAnswer = z.object({
  trial: z.object({ enabled: z.boolean(), days: z.number().int().min(0).max(365) }),
  checkinDays: z.number().int().min(1).max(365),
  plans: z
    .array(
      z.object({
        id: z.enum(['STARTER', 'PRO', 'VIP']),
        label: shortText(40),
        price: z.number().min(0).max(1e10),
        period: z.enum(['month', 'once']),
        terminals: z.number().int().min(0).max(9999).nullable(),
        features: featureList,
      }),
    )
    .max(10),
  extraTerminalPrice: z.number().min(0).max(1e10),
  supportPhone: shortText(32),
});

const signupStartAnswer = z.object({
  verificationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  // Only a link to a Telegram bot with a start token: anything else would be a QR to who knows where.
  botLink: z
    .string()
    .regex(/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Za-z0-9_-]{1,64}$/)
    .nullable(),
  expiresAt: z.string().max(40),
});

const signupStatusAnswer = z.object({ contactConfirmed: z.boolean(), expired: z.boolean() });

const grantAnswer = z.object({
  storeId: z.string().min(1).max(64),
  storeName: shortText(200),
  license: z.string().min(1).max(8192),
  payment: z
    .object({
      paymentUrl: z.string().max(300).default(''),
      supportPhone: z.string().max(32).default(''),
    })
    .partial()
    .optional(),
});
type Grant = z.infer<typeof grantAnswer>;

function parseAnswer<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ServerError(BAD_ANSWER, null);
  return parsed.data;
}

// ── HTTP ───────────────────────────────────────────────────────────────────────────────────

export type HttpPost = (path: string, body: unknown) => Promise<unknown>;
export type HttpGet = (path: string) => Promise<unknown>;

/** An error the server or the network gave, in Uzbek, for the renderer to show. */
export class ServerError extends Error {
  constructor(
    message: string,
    /** The server's own code (kept apart from the app's error reasons). */
    readonly serverCode: string | null,
  ) {
    super(message.slice(0, MAX_SERVER_TEXT));
  }
}

/**
 * fetch with a timeout and no redirects (a redirect would send the licence, phone or code
 * elsewhere). Server errors come back as ServerError with the server's Uzbek text.
 */
export function httpClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): { get: HttpGet; post: HttpPost } {
  const call = async (path: string, init: RequestInit): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServerError(OFFLINE, 'OFFLINE');
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const text = typeof body?.['messageUz'] === 'string' ? body['messageUz'] : null;
      const code = typeof body?.['code'] === 'string' ? body['code'].slice(0, 40) : null;
      if (res.status === 404 && !code) {
        throw new ServerError(
          "Xizmat hozircha ishlamayapti. Keyinroq urinib ko'ring",
          'UNAVAILABLE',
        );
      }
      throw new ServerError(text ?? `Server xatosi (${res.status})`, code);
    }
    return body;
  };
  return {
    get: (path) => call(path, { method: 'GET', headers: { Accept: 'application/json' } }),
    post: (path, body) =>
      call(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

// ── Service ────────────────────────────────────────────────────────────────────────────────

export interface LicenseServiceOptions {
  db: Db;
  publicKey: KeyObject;
  clock: TrustedClock;
  http: { get: HttpGet; post: HttpPost };
  appVersion: string;
  machineName: string;
  /** Every change the renderer should re-read (main broadcasts `license-changed`). */
  onChange(): void;
  log: { info(message: string): void; warn(message: string, error?: unknown): void };
  /** Default CHECK_MIN_INTERVAL_MS; tests pass 0. */
  minCheckIntervalMs?: number;
}

interface Row {
  terminalId: string;
  storeId: string | null;
  storeName: string | null;
  token: string | null;
  lastCheckinAt: Date | null;
  lastError: string | null;
  firstRunAt: Date;
}

export class LicenseService {
  private row: Row | null = null;
  /** The held token, verified once when it is loaded or stored. */
  private payload: LicensePayload | null = null;
  /** Setup only ever goes from not done to done. */
  private setupDone = false;
  private payment: LicenseStatusDto['payment'] = null;
  private last: TillState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking: Promise<LicenseStatusDto> | null = null;
  private lastAttemptAt = 0;

  constructor(private readonly o: LicenseServiceOptions) {}

  /** Makes this till's row (and its id) on the first start with F5. */
  async init(): Promise<void> {
    await this.o.clock.init();
    const existing = await this.o.db.licenseState.findUnique({ where: { id: ROW_ID } });
    this.row =
      existing ??
      (await this.o.db.licenseState.create({
        data: { id: ROW_ID, terminalId: randomUUID(), firstRunAt: new Date(this.o.clock.now()) },
      }));
    this.payload = readLicense(this.row.token, this.o.publicKey);
    await this.state();
  }

  private requireRow(): Row {
    if (!this.row) throw new Error('LicenseService.init() was not called');
    return this.row;
  }

  /** Where the till stands now (trusted clock); also cached for the synchronous checks. */
  async state(): Promise<TillState> {
    const row = this.requireRow();
    if (!this.setupDone) this.setupDone = (await getSetupStatus(this.o.db)).setupComplete;
    this.last = tillState({
      license: this.payload,
      setupComplete: this.setupDone,
      firstRunAt: row.firstRunAt,
      terminalId: row.terminalId,
      now: this.o.clock.now(),
    });
    return this.last;
  }

  /** As of the last `state()`: for checks that cannot wait (printing pictures). */
  hasFeature(feature: LicenseFeature): boolean {
    return this.last ? this.last.features.includes(feature) : true;
  }

  async isSetupMode(): Promise<boolean> {
    return (await this.state()).mode === 'setup';
  }

  async status(): Promise<LicenseStatusDto> {
    const row = this.requireRow();
    const s = await this.state();
    const l = this.payload;
    return {
      mode: s.mode,
      reason: s.reason,
      linked: l !== null,
      storeId: l?.storeId ?? null,
      storeName: l?.storeName ?? row.storeName,
      plan: s.plan,
      features: s.features,
      daysLeft: s.daysLeft,
      expiresAt: l?.expiresAt ?? null,
      trialEndsAt: l?.trialEndsAt ?? null,
      lastCheckinAt: row.lastCheckinAt?.toISOString() ?? null,
      checkinBy: l?.checkinBy ?? null,
      terminalId: row.terminalId,
      lastError: row.lastError,
      payment: this.payment,
    };
  }

  /** The Uzbek reason main refuses `channel` now, or null (ipc-safe.ts calls it on every call). */
  async refusal(channel: IpcChannel, input: unknown): Promise<string | null> {
    const s = await this.state();
    return refusal(channel, input, s, (excludeId) =>
      this.o.db.hall.count({
        where: { isActive: true, ...(excludeId !== undefined && { id: { not: excludeId } }) },
      }),
    );
  }

  isLinked(): boolean {
    return this.payload !== null;
  }

  // ── Server calls ───────────────────────────────────────────────────────────────────────────

  private terminal() {
    return {
      id: this.requireRow().terminalId,
      appVersion: this.o.appVersion.slice(0, 64),
      machineName: this.o.machineName.slice(0, 64),
    };
  }

  async plans(): Promise<LicensePlansDto> {
    return parseAnswer(plansAnswer, await this.o.http.get('/savdochef/plans'));
  }

  async signupStart(phone: string): Promise<SignupStartDto> {
    return parseAnswer(
      signupStartAnswer,
      await this.o.http.post('/savdochef/signup/start', { phone }),
    );
  }

  async signupStatus(
    verificationId: string,
  ): Promise<{ contactConfirmed: boolean; expired: boolean }> {
    return parseAnswer(
      signupStatusAnswer,
      await this.o.http.get(
        `/savdochef/signup/status?verificationId=${encodeURIComponent(verificationId)}`,
      ),
    );
  }

  async signupComplete(input: {
    verificationId: string;
    code: string;
    restaurantName: string;
    ownerName: string;
    address?: string;
  }): Promise<LicenseStatusDto> {
    const body = await this.o.http.post('/savdochef/signup/complete', {
      ...input,
      terminal: this.terminal(),
    });
    return this.accept(parseAnswer(grantAnswer, body), { linking: true });
  }

  async activate(input: { phone: string; activationCode: string }): Promise<LicenseStatusDto> {
    const body = await this.o.http.post('/savdochef/activate', {
      ...input,
      terminal: this.terminal(),
    });
    return this.accept(parseAnswer(grantAnswer, body), { linking: true });
  }

  /** The check-in. Failures are recorded (and shown), never thrown: the till keeps working. */
  checkNow(options: { force?: boolean } = {}): Promise<LicenseStatusDto> {
    // Anyone may press it at the lock screen: not more than once per interval. An administrator
    // (who just paid, say) always gets a fresh answer.
    const minGap = this.o.minCheckIntervalMs ?? CHECK_MIN_INTERVAL_MS;
    if (!options.force && !this.checking && Date.now() - this.lastAttemptAt < minGap) {
      return this.status();
    }
    // One at a time: the button and the background timer share the call in flight.
    this.checking ??= this.renew().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async renew(): Promise<LicenseStatusDto> {
    const token = this.requireRow().token;
    if (!token) return this.status();
    this.lastAttemptAt = Date.now();
    try {
      const body = await this.o.http.post('/savdochef/licenses/renew', {
        license: token,
        terminal: this.terminal(),
      });
      return await this.accept(parseAnswer(grantAnswer, body), { linking: false });
    } catch (error) {
      const message =
        error instanceof ServerError || error instanceof Error ? error.message : OFFLINE;
      this.o.log.warn(`[license] check-in failed: ${message}`);
      await this.save({ lastError: message.slice(0, MAX_SERVER_TEXT) });
      this.o.onChange();
      return this.status();
    }
  }

  /**
   * Stores a licence the server sent, after checking its signature, that it is this till's
   * restaurant, and that it is newer than the one held (a renewal never goes back in time; linking
   * to another restaurant starts afresh). Only then is the clock set to the server's time.
   */
  private async accept(grant: Grant, how: { linking: boolean }): Promise<LicenseStatusDto> {
    const payload = readLicense(grant.license, this.o.publicKey);
    if (!payload || payload.storeId !== grant.storeId) {
      throw conflict('Serverdan kelgan litsenziya yaroqsiz', { reason: 'LICENSE_INVALID' });
    }
    const held = this.payload;
    const sameStore = held !== null && held.storeId === payload.storeId;
    const issued = Date.parse(payload.issuedAt);
    if (held && (sameStore || !how.linking)) {
      if (!sameStore)
        throw conflict('Serverdan kelgan litsenziya yaroqsiz', { reason: 'LICENSE_INVALID' });
      const heldIssued = Date.parse(held.issuedAt);
      if (issued < heldIssued) {
        throw conflict('Serverdan eski litsenziya keldi', { reason: 'LICENSE_STALE' });
      }
      if (issued === heldIssued) return this.status(); // the same licence again: nothing new
    }
    if (held && !sameStore) {
      this.o.log.info(`[license] till moved from restaurant ${held.storeId} to ${payload.storeId}`);
    }
    await this.o.clock.correctTo(issued);
    await this.save({
      token: grant.license,
      storeId: payload.storeId,
      storeName: payload.storeName,
      lastCheckinAt: new Date(this.o.clock.now()),
      lastError: null,
    });
    this.payment = {
      supportPhone: grant.payment?.supportPhone ?? '',
      paymentUrl: grant.payment?.paymentUrl ?? '',
    };
    this.o.log.info(
      `[license] licence for restaurant ${payload.storeId}, plan ${payload.plan ?? '-'}`,
    );
    this.o.onChange();
    return this.status();
  }

  private async save(data: Partial<Omit<Row, 'terminalId' | 'firstRunAt'>>): Promise<void> {
    this.row = await this.o.db.licenseState.update({ where: { id: ROW_ID }, data });
    if ('token' in data) this.payload = readLicense(this.row.token, this.o.publicKey);
  }

  // ── Background ─────────────────────────────────────────────────────────────────────────────

  start(): void {
    this.o.clock.start();
    const tick = () => {
      if (this.row?.token) void this.checkNow();
    };
    setTimeout(tick, FIRST_BACKGROUND_DELAY_MS).unref?.();
    this.timer = setInterval(tick, BACKGROUND_EVERY_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.o.clock.stop();
    await this.o.clock.persist();
  }
}
