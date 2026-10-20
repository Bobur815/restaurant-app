import type { UpdateStatusDto } from '@shared/types';

/**
 * Software update (feature F4). Releases are published by `npm run deploy:pos` to the posgro VPS
 * and served at UPDATE_FEED_URL; electron-updater reads `latest.yml` there, downloads the
 * installer (differentially when the blockmap is there), checks its sha512 and runs it.
 *
 * Nothing happens on its own except one quiet check after start: downloading and installing wait
 * for someone with the settings permission to press the buttons (never in the middle of a sale).
 * The renderer only calls check/download/install; the feed is fixed here.
 */
export const UPDATE_FEED_URL = 'https://panel.posgro.uz/releases/savdochef/';

/** The part of electron-updater's AppUpdater this module uses (a fake in tests). */
export interface UpdaterEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(
    event: 'update-available',
    listener: (info: { version: string; releaseDate?: string }) => void,
  ): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
}

export interface UpdaterService {
  status(): UpdateStatusDto;
  /** quiet: the start-up check; a failure there (no internet) is only logged. */
  check(options?: { quiet?: boolean }): Promise<UpdateStatusDto>;
  /** Starts the download and returns at once; progress arrives as `update-changed` events. */
  download(): UpdateStatusDto;
  /** Closes the database, then quits, installs silently and starts the new version. */
  install(): Promise<void>;
}

export interface UpdaterOptions {
  currentVersion: string;
  /** False in a dev or unpacked run: electron-updater only works in the installed app. */
  supported: boolean;
  /** Created only when supported (electron-updater reads app-update.yml on creation). */
  engine: () => UpdaterEngine;
  /** Every status change (main broadcasts `update-changed`). */
  onChange(status: UpdateStatusDto): void;
  beforeInstall(): Promise<void>;
  log: { info(message: string): void; warn(message: string, error?: unknown): void };
  now?: () => Date;
}

/** Uzbek text for what went wrong; the raw error goes to the log. */
export function updateErrorMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as { code?: unknown }).code ?? '')}`
      : String(error);
  if (/sha512|checksum|signature/i.test(text))
    return "Yuklangan fayl buzilgan. Qayta yuklab ko'ring";
  if (/\b(404|403)\b|cannot find latest|HttpError/i.test(text))
    return 'Yangilanish serverda topilmadi';
  if (
    /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|net::ERR_|socket hang up|timeout/i.test(
      text,
    )
  )
    return "Internetga ulanib bo'lmadi. Ulanishni tekshirib qayta urinib ko'ring";
  return "Yangilanishni olib bo'lmadi. Qayta urinib ko'ring";
}

export function createUpdater(options: UpdaterOptions): UpdaterService {
  const now = options.now ?? (() => new Date());
  let status: UpdateStatusDto = {
    state: options.supported ? 'idle' : 'unsupported',
    currentVersion: options.currentVersion,
    version: null,
    releaseDate: null,
    percent: null,
    message: null,
    checkedAt: null,
  };
  let engine: UpdaterEngine | null = null;
  /** The running check is quiet: its errors do not show up as the error state. */
  let quiet = false;

  const set = (patch: Partial<UpdateStatusDto>) => {
    status = { ...status, ...patch };
    options.onChange(status);
  };

  const getEngine = (): UpdaterEngine => {
    if (engine) return engine;
    const e = options.engine();
    e.autoDownload = false;
    e.autoInstallOnAppQuit = false;
    e.on('update-available', (info) =>
      set({
        state: 'available',
        version: info.version,
        releaseDate: info.releaseDate ?? null,
        percent: null,
        message: null,
        checkedAt: now().toISOString(),
      }),
    );
    e.on('update-not-available', () =>
      set({ state: 'not-available', version: null, message: null, checkedAt: now().toISOString() }),
    );
    e.on('download-progress', ({ percent }) => {
      const whole = Math.max(0, Math.min(100, Math.floor(percent)));
      // Whole percents only: one event per percent, not one per network chunk.
      if (status.state !== 'downloading' || whole !== status.percent)
        set({ state: 'downloading', percent: whole });
    });
    e.on('update-downloaded', (info) =>
      set({ state: 'downloaded', version: info.version, percent: 100, message: null }),
    );
    e.on('error', (error) => fail(error));
    engine = e;
    return e;
  };

  const fail = (error: unknown) => {
    if (quiet && status.state === 'checking') {
      options.log.warn('[update] start-up check failed', error);
      set({ state: 'idle' });
      return;
    }
    options.log.warn('[update] failed', error);
    set({ state: 'error', percent: null, message: updateErrorMessage(error) });
  };

  return {
    status: () => status,

    async check(opts) {
      if (!options.supported) return status;
      // Already checking, downloading or waiting to install: nothing new to ask the server.
      if (['checking', 'downloading', 'downloaded'].includes(status.state)) return status;
      quiet = !!opts?.quiet;
      set({ state: 'checking', message: null });
      try {
        await getEngine().checkForUpdates();
        // electron-updater answers with an event; without one (it skipped), call it up to date.
        if (status.state === 'checking')
          set({ state: 'not-available', checkedAt: now().toISOString() });
      } catch (error) {
        if (status.state === 'checking') fail(error);
      } finally {
        quiet = false;
      }
      return status;
    },

    download() {
      if (status.state !== 'available' && !(status.state === 'error' && status.version))
        return status;
      set({ state: 'downloading', percent: 0, message: null });
      getEngine()
        .downloadUpdate()
        .catch((error: unknown) => {
          if (status.state === 'downloading') fail(error);
        });
      return status;
    },

    async install() {
      if (status.state !== 'downloaded' || !engine) return;
      options.log.info(`[update] installing ${status.version ?? '?'}`);
      await options.beforeInstall();
      // Silent install into the folder the till was installed to, then start it again.
      engine.quitAndInstall(true, true);
    },
  };
}
