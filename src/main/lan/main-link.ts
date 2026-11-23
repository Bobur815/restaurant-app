import type { AppEvent, IpcChannel } from '@shared/ipc';
import type { IpcResult } from '@shared/errors';
import type { LanLinkDto, LanLinkState } from '@shared/types';
import type { SatelliteLink } from './config';
import { versionsCompatible } from './serve-policy';

/**
 * Feature F12: a satellite till's one line to its main till (posgro lan/main-link.ts). Every IPC
 * call of the satellite's renderer goes through `rpc`; the main till's events arrive on one
 * long-lived stream and are handed to the satellite's windows. Electron-free (global fetch), so the
 * end-to-end test runs a real main till and this client in one process.
 *
 * "The main till refused" (an IpcResult error) and "the main till did not answer" (a network
 * failure) are different: the first is shown like any refusal, the second turns the satellite's
 * screen into "waiting for the main till" and keeps the open order in the renderer.
 */

export interface MainLinkOptions {
  link: SatelliteLink;
  version: string;
  onEvent(event: AppEvent): void;
  onState(state: LanLinkDto): void;
  log(message: string, error?: unknown): void;
  fetch?: typeof fetch;
  /** Reconnect delays; tests shorten them. */
  retryMs?: number[];
}

const RPC_TIMEOUT_MS = 30_000;
/** What a satellite accepts from its main till: a picture, one event frame. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_EVENT_FRAME = 256 * 1024;
const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY = [1_000, 2_000, 5_000, 10_000];

/** `0.9.1`, `0.10.0-beta.2`: what a SavdoChef release reports. */
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,32})?$/;

const unreachableError = (): IpcResult<never> => ({
  ok: false,
  error: {
    code: 'CONFLICT',
    message: "Asosiy kassa bilan aloqa yo'q. Asosiy kassa yoqilganini va tarmoqni tekshiring",
    details: { reason: 'MAIN_UNREACHABLE' },
  },
});

const STATE_MESSAGE: Record<Exclude<LanLinkState, 'online' | 'connecting'>, string> = {
  unreachable: "Asosiy kassa bilan aloqa yo'q. Asosiy kassa yoqilganini va tarmoqni tekshiring",
  unpaired: 'Bu kassa asosiy kassadan ajratilgan. Qayta ulang',
  superseded: 'Bu manzilda boshqa asosiy kassa javob bermoqda. Manzilni tekshiring',
  version: 'Asosiy kassa va bu kassa versiyalari mos emas. Ikkalasini ham yangilang',
};

function headers(link: SatelliteLink, session?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `SavdoChef ${link.deviceId}.${link.secret}`,
    'content-type': 'application/json',
  };
  if (session) h['x-session'] = session;
  return h;
}

export class MainLink {
  private state: LanLinkState = 'connecting';
  private mainVersion: string | null;
  private lastContactAt: Date | null = null;
  private stopped = false;
  private stream: AbortController | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly o: MainLinkOptions) {
    this.f = o.fetch ?? fetch;
    this.mainVersion = o.link.mainVersion;
  }

  status(): LanLinkDto {
    return {
      role: 'satellite',
      mainUrl: this.o.link.mainUrl,
      state: this.state,
      mainVersion: this.mainVersion,
      lastContactAt: this.lastContactAt?.toISOString() ?? null,
    };
  }

  private setState(next: LanLinkState): void {
    if (next === 'online') this.lastContactAt = new Date();
    if (next === this.state) return;
    this.state = next;
    this.o.onState(this.status());
  }

  private refusal(): IpcResult<never> | null {
    if (this.state === 'online' || this.state === 'connecting' || this.state === 'unreachable')
      return null;
    return {
      ok: false,
      error: { code: 'CONFLICT', message: STATE_MESSAGE[this.state], details: { reason: 'LINK' } },
    };
  }

  /**
   * One IPC call on the main till. `session` is this window's sign-in there; `session` in the
   * answer replaces it (a new token after login, null after logout or when the main till forgot).
   */
  async rpc(
    channel: IpcChannel,
    input: unknown,
    session: string | null,
  ): Promise<{ result: IpcResult<unknown>; session?: string | null }> {
    const refused = this.refusal();
    if (refused) return { result: refused };
    let res: Response;
    try {
      res = await this.f(`${this.o.link.mainUrl}/rpc`, {
        method: 'POST',
        headers: headers(this.o.link, session),
        body: JSON.stringify({ channel, input }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch (error) {
      this.o.log(`[lan] ${channel}: main till unreachable`, error);
      this.setState('unreachable');
      void this.reconnectSoon();
      return { result: unreachableError() };
    }
    if (res.status === 401) {
      this.setState('unpaired');
      return { result: this.refusal()! };
    }
    if (!res.ok) {
      return {
        result: {
          ok: false,
          error: { code: 'INTERNAL', message: "Kutilmagan xatolik. Qayta urinib ko'ring" },
        },
      };
    }
    if (this.state === 'unreachable') void this.reconnectSoon();
    this.setState('online');
    return (await res.json()) as { result: IpcResult<unknown>; session?: string | null };
  }

  /** A picture from the main till's image store, or null. */
  async image(fileName: string): Promise<Buffer | null> {
    try {
      const res = await this.f(`${this.o.link.mainUrl}/img/${encodeURIComponent(fileName)}`, {
        headers: headers(this.o.link),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return null;
      const data = Buffer.from(await res.arrayBuffer());
      return data.length > MAX_IMAGE_BYTES ? null : data;
    } catch {
      return null;
    }
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.stream?.abort();
    // A loop waiting out its retry delay ends now instead of holding a timer for up to 30 s.
    this.wake?.();
  }

  private reconnecting = false;
  /** After a failed call, the stream loop retries at once instead of waiting out its delay. */
  private async reconnectSoon(): Promise<void> {
    this.wake?.();
  }
  private wake: (() => void) | null = null;

  /** Checks who answers at the address, then follows the main till's events until it drops. */
  private async loop(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const delays = this.o.retryMs ?? DEFAULT_RETRY;
    let attempt = 0;
    while (!this.stopped) {
      const ok = await this.checkHealth();
      if (ok) {
        attempt = 0;
        await this.follow();
      }
      if (this.stopped) break;
      if (this.state === 'unpaired' || this.state === 'superseded' || this.state === 'version') {
        // Nothing to retry until someone re-pairs or updates; check again slowly.
        await this.sleep(delays[delays.length - 1]! * 3);
      } else {
        await this.sleep(delays[Math.min(attempt, delays.length - 1)]!);
        attempt += 1;
      }
    }
    this.reconnecting = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.wake = done;
    });
  }

  /**
   * Who answers at the address: SavdoChef at all (/health), then, with this till's credential,
   * the same restaurant's main till (/hello: lineage). The lineage is never given to strangers.
   */
  private async checkHealth(): Promise<boolean> {
    try {
      const res = await this.f(`${this.o.link.mainUrl}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const body = (await res.json()) as { app?: string; version?: string };
      if (body.app !== 'savdochef') {
        this.setState('superseded');
        return false;
      }
      // A version string as releases have it; anything else is not a till of ours.
      const version =
        typeof body.version === 'string' && VERSION_RE.test(body.version) ? body.version : null;
      if (!version) {
        this.setState('superseded');
        return false;
      }
      // Who answers first (this till's credential, /hello works across versions): only our own
      // main till's version is believed. A stranger at the address claiming a newer version must
      // not open the sign-in-free actions of the waiting card (leave, update; F15 review).
      const hello = await this.f(`${this.o.link.mainUrl}/hello`, {
        headers: headers(this.o.link),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (hello.status === 401) {
        this.setState('unpaired');
        return false;
      }
      const who = (await hello.json()) as { lineage?: string };
      if (who.lineage !== this.o.link.lineage) {
        this.setState('superseded');
        return false;
      }
      const changed = version !== this.mainVersion;
      this.mainVersion = version;
      if (!versionsCompatible(version, this.o.version)) {
        // Already waiting on the version: a new one (the main till updated again) still re-renders.
        if (changed && this.state === 'version') this.o.onState(this.status());
        this.setState('version');
        return false;
      }
      return true;
    } catch {
      this.setState('unreachable');
      return false;
    }
  }

  /** Reads the event stream until it ends; online while it lasts. */
  private async follow(): Promise<void> {
    const ctl = new AbortController();
    this.stream = ctl;
    try {
      const res = await this.f(`${this.o.link.mainUrl}/events`, {
        headers: headers(this.o.link),
        signal: ctl.signal,
      });
      if (res.status === 401) {
        this.setState('unpaired');
        return;
      }
      if (!res.ok || !res.body) {
        this.setState('unreachable');
        return;
      }
      this.setState('online');
      // Whatever changed while the line was down: every view reloads what it shows.
      for (const type of [
        'orders-changed',
        'session-changed',
        'menu-changed',
        'settings-changed',
      ] as const)
        this.o.onEvent({ type });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.length > MAX_EVENT_FRAME) throw new Error('event frame too large');
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          this.lastContactAt = new Date();
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              this.o.onEvent(JSON.parse(line.slice(6)) as AppEvent);
            } catch (error) {
              this.o.log('[lan] bad event', error);
            }
          }
        }
      }
      if (!this.stopped) this.setState('unreachable');
    } catch (error) {
      if (!this.stopped) {
        this.o.log('[lan] event stream dropped', error);
        this.setState('unreachable');
      }
    } finally {
      this.stream = null;
    }
  }
}

/** The answer of the main till's /pair, as the satellite stores it. */
export async function pairWithMain(
  mainUrl: string,
  code: string,
  name: string,
  f: typeof fetch = fetch,
): Promise<SatelliteLink> {
  const unreachable = new PairError(
    "Asosiy kassaga ulanib bo'lmadi. Manzilni, tarmoqni va asosiy kassada yo'ldosh kassalar yoqilganini tekshiring",
  );
  // Only a SavdoChef main till gets the code, and only its answer is shown to the user.
  try {
    const health = (await (
      await f(`${mainUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    ).json()) as { app?: string };
    if (health.app !== 'savdochef') throw unreachable;
  } catch {
    throw unreachable;
  }
  let res: Response;
  try {
    res = await f(`${mainUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // F20: a satellite is a till; a phone's code is refused instead of making it a phone.
      body: JSON.stringify({ code, name, expect: 'till' }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS * 2),
    });
  } catch {
    throw new PairError(
      "Asosiy kassaga ulanib bo'lmadi. Manzilni, tarmoqni va asosiy kassada yo'ldosh kassalar yoqilganini tekshiring",
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    deviceId?: number;
    secret?: string;
    lineage?: string;
    version?: string;
    error?: string | { message?: string };
  };
  if (!res.ok || !body.deviceId || !body.secret || !body.lineage) {
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new PairError(msg ?? "Ulanib bo'lmadi");
  }
  return {
    mainUrl,
    deviceId: body.deviceId,
    secret: body.secret,
    lineage: body.lineage,
    mainVersion: body.version ?? '',
  };
}

export class PairError extends Error {}
