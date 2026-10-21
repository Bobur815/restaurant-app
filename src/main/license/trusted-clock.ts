/**
 * The time this till judges its licence by: one the shop cannot wind back (posgro's
 * src/main/license/trusted-clock.ts, simplified).
 *
 *   trustedNow = max(system clock, mark + time the app has run since the mark was read)
 *
 * The mark is the latest moment this till knows has passed. It is kept twice, in SQLite and in an
 * encrypted file in userData, and the larger wins, so deleting one copy resets nothing. While the
 * app runs the mark advances with the monotonic clock, so setting the system clock back mid-session
 * gains nothing either. A licence fresh from the server sets the mark to the server's time
 * (`correctTo`), which is how a clock that ran ahead by mistake is put right.
 *
 * The limit, stated plainly: someone who rewrites the app can skip all of this. The asar integrity
 * fuse makes that harder than editing a file, not impossible.
 */

/** One copy of the mark. Both implementations must swallow their own failures. */
export interface MarkStore {
  read(): Promise<number | null>;
  write(ms: number): Promise<void>;
}

export interface ClockSeams {
  now(): number;
  monotonic(): number;
}

const defaultSeams: ClockSeams = { now: () => Date.now(), monotonic: () => performance.now() };

/** How often the running clock is written back: a crash or a kill loses at most this much. */
export const PERSIST_EVERY_MS = 60_000;

export class TrustedClock {
  private mark = 0;
  private markedAtMono = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly stores: MarkStore[],
    private readonly seams: ClockSeams = defaultSeams,
  ) {}

  /** Reads both copies; call once before the first `now()`. */
  async init(): Promise<void> {
    const marks = await Promise.all(this.stores.map((s) => s.read().catch(() => null)));
    this.mark = Math.max(
      0,
      ...marks.filter((m): m is number => typeof m === 'number' && Number.isFinite(m)),
    );
    this.markedAtMono = this.seams.monotonic();
  }

  now(): number {
    const running = this.mark + (this.seams.monotonic() - this.markedAtMono);
    return Math.max(this.seams.now(), running);
  }

  /** Writes the current trusted time to both copies. */
  async persist(): Promise<void> {
    const at = this.now();
    this.mark = at;
    this.markedAtMono = this.seams.monotonic();
    await Promise.all(this.stores.map((s) => s.write(at).catch(() => undefined)));
  }

  /** The server's own time, from a licence it just signed: may move the mark down. */
  async correctTo(serverMs: number): Promise<void> {
    if (!Number.isFinite(serverMs)) return;
    this.mark = serverMs;
    this.markedAtMono = this.seams.monotonic();
    await Promise.all(this.stores.map((s) => s.write(serverMs).catch(() => undefined)));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.persist(), PERSIST_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
