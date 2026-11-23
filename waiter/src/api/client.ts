import type { IpcResult } from '@shared/errors';
import type { AppEvent, IpcInput, IpcOutput } from '@shared/ipc';
import {
  isWaiterEvent,
  WAITER_PROTOCOL,
  type WaiterChannel,
  type WaiterHelloDto,
} from '@shared/lan-waiter';
import { baseUrl, type Credential } from './credential';
import { ApiError } from './errors';
import { openSse, type SseHandle } from './sse';

/**
 * The phone's line to its till (the waiter-side `main-link.ts`): every call is an RPC on the till,
 * run there with the signed-in waiter as the actor, so access, prices, stock and versions are the
 * till's. A loop checks who answers (`/hello`), then follows `/events` while the line holds.
 *
 * States: `connecting` (first contact), `online`, `unreachable` (no answer: Wi-Fi, till off),
 * `unpaired` (the till unpaired this phone: pair again), `version` (the till speaks another phone
 * protocol: update one of them), `limit` (the plan's phones are all taken), `superseded` (another
 * restaurant's till answers at the address).
 */

export type LinkState =
  | 'connecting'
  | 'online'
  | 'unreachable'
  | 'unpaired'
  | 'version'
  | 'limit'
  | 'superseded';

export interface LinkStatus {
  state: LinkState;
  /** The address that answers (`192.168.1.10:5180`). */
  address: string;
  lastContactAt: Date | null;
  tillVersion: string;
  restaurantName: string;
}

export interface ClientOptions {
  credential: Credential;
  onStatus(status: LinkStatus): void;
  onEvent(event: AppEvent): void;
  /** The till forgot this phone's sign-in (it restarted, or the waiter was signed out). */
  onSignedOut(): void;
  fetchImpl?: typeof fetch;
  retryMs?: number[];
  openSseImpl?: typeof openSse;
}

const RPC_TIMEOUT_MS = 15_000;
const HELLO_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY = [1_000, 2_000, 5_000, 10_000];

type CallArgs<C extends WaiterChannel> =
  undefined extends IpcInput<C> ? [input?: IpcInput<C>] : [input: IpcInput<C>];

export class WaiterClient {
  private state: LinkState = 'connecting';
  private host: string;
  private session: string | null = null;
  private lastContactAt: Date | null = null;
  private tillVersion: string;
  private restaurantName: string;
  private stopped = true;
  private stream: SseHandle | null = null;
  private wake: (() => void) | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly o: ClientOptions) {
    this.host = o.credential.hosts[0]!;
    this.tillVersion = o.credential.tillVersion;
    this.restaurantName = o.credential.restaurantName;
    this.f = o.fetchImpl ?? fetch;
  }

  get status(): LinkStatus {
    return {
      state: this.state,
      address: `${this.host}:${this.o.credential.port}`,
      lastContactAt: this.lastContactAt,
      tillVersion: this.tillVersion,
      restaurantName: this.restaurantName,
    };
  }

  get signedIn(): boolean {
    return this.session !== null;
  }

  private get base(): string {
    return baseUrl(this.host, this.o.credential.port);
  }

  private headers(withSession = true): Record<string, string> {
    const c = this.o.credential;
    return {
      authorization: `SavdoChef ${c.deviceId}.${c.secret}`,
      'content-type': 'application/json',
      ...(withSession && this.session ? { 'x-session': this.session } : {}),
    };
  }

  private setState(next: LinkState): void {
    if (next === 'online') this.lastContactAt = new Date();
    if (next === this.state) return;
    this.state = next;
    this.o.onStatus(this.status);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.stream?.close();
    this.stream = null;
    this.wake?.();
  }

  /** Try again now (the "Qayta urinish" button, or after a failed call). */
  retry(): void {
    this.wake?.();
  }

  /** Drops the sign-in here (the till forgets it on logout). */
  forgetSession(): void {
    this.session = null;
  }

  /** A picture from the till's image store, for <Image source>. */
  imageSource(fileName: string): { uri: string; headers: Record<string, string> } {
    return {
      uri: `${this.base}/img/${encodeURIComponent(fileName)}`,
      headers: this.headers(false),
    };
  }

  /** One call on the till. Throws ApiError (main's code and Uzbek message, or OFFLINE/...). */
  async rpc<C extends WaiterChannel>(channel: C, ...args: CallArgs<C>): Promise<IpcOutput<C>> {
    if (this.state === 'unpaired') throw new ApiError('UNPAIRED', 'unpaired');
    if (this.state === 'version') throw new ApiError('CONFLICT', 'version', { reason: 'VERSION' });
    if (this.state === 'limit') throw new ApiError('LIMIT', 'limit');
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.base}/rpc`, RPC_TIMEOUT_MS, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ channel, input: args[0] }),
      });
    } catch {
      this.setState('unreachable');
      this.retry();
      throw new ApiError('OFFLINE', 'offline');
    }
    if (res.status === 401) {
      this.setState('unpaired');
      throw new ApiError('UNPAIRED', 'unpaired');
    }
    if (res.status === 403) {
      // Before any channel runs: this phone is beyond the plan's phones.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      this.setState('limit');
      throw new ApiError('LIMIT', body.error ?? 'limit');
    }
    if (!res.ok) throw new ApiError('INTERNAL', 'http');
    if (this.state === 'unreachable') this.retry();
    this.setState('online');
    const body = (await res.json()) as { result: IpcResult<unknown>; session?: string | null };
    const had = this.session !== null;
    if (body.session !== undefined) this.session = body.session;
    if (had && body.session === null && channel !== 'auth:logout') this.o.onSignedOut();
    if (!body.result.ok) throw ApiError.from(body.result.error);
    return body.result.data as IpcOutput<C>;
  }

  private async fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      return await this.f(url, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(timer);
        if (self.wake === done) self.wake = null;
        resolve();
      }
      this.wake = done;
    });
  }

  private async loop(): Promise<void> {
    const delays = this.o.retryMs ?? DEFAULT_RETRY;
    let attempt = 0;
    while (!this.stopped) {
      if (await this.hello()) {
        attempt = 0;
        await this.follow();
      }
      if (this.stopped) break;
      const stuck = this.state === 'unpaired' || this.state === 'version' || this.state === 'superseded';
      await this.sleep(stuck ? delays[delays.length - 1]! * 3 : delays[Math.min(attempt, delays.length - 1)]!);
      attempt += 1;
    }
  }

  /**
   * Who answers: each known address in turn (the till's Wi-Fi address may change), with this
   * phone's credential. Only our own restaurant's till (same lineage) speaking our protocol counts.
   */
  async hello(): Promise<boolean> {
    const hosts = [this.host, ...this.o.credential.hosts.filter((h) => h !== this.host)];
    for (const host of hosts) {
      let res: Response;
      try {
        res = await this.fetchWithTimeout(
          `${baseUrl(host, this.o.credential.port)}/hello`,
          HELLO_TIMEOUT_MS,
          { headers: this.headers(false) },
        );
      } catch {
        continue;
      }
      if (res.status === 401) {
        this.host = host;
        this.setState('unpaired');
        return false;
      }
      if (!res.ok) continue;
      const who = (await res.json().catch(() => ({}))) as Partial<WaiterHelloDto>;
      if (who.lineage !== this.o.credential.lineage) {
        this.setState('superseded');
        continue;
      }
      this.host = host;
      if (typeof who.version === 'string') this.tillVersion = who.version;
      if (typeof who.restaurantName === 'string' && who.restaurantName)
        this.restaurantName = who.restaurantName;
      if (who.protocol !== WAITER_PROTOCOL) {
        this.setState('version');
        return false;
      }
      return true;
    }
    if (this.state !== 'superseded') this.setState('unreachable');
    return false;
  }

  /** Follows the till's events until the stream ends; online while it lasts. */
  private follow(): Promise<void> {
    return new Promise((resolve) => {
      const open = this.o.openSseImpl ?? openSse;
      this.stream = open({
        url: `${this.base}/events`,
        headers: this.headers(false),
        onOpen: () => {
          this.setState('online');
          // Whatever changed while the line was down: the screens reload what they show.
          for (const type of ['orders-changed', 'session-changed', 'menu-changed', 'settings-changed', 'halls-changed'] as const)
            this.o.onEvent({ type });
        },
        onData: (json) => {
          this.lastContactAt = new Date();
          try {
            const event = JSON.parse(json) as AppEvent;
            if (isWaiterEvent(event)) this.o.onEvent(event);
          } catch {
            // A bad frame is skipped; the next one still counts.
          }
        },
        onEnd: (status) => {
          this.stream = null;
          if (status === 401) this.setState('unpaired');
          else if (status === 403) this.setState('limit');
          else if (status !== 200 && !this.stopped) this.setState('unreachable');
          resolve();
        },
      });
    });
  }
}
