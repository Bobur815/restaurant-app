import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import os from 'node:os';
import path from 'path';
import {
  closeDatabase,
  databaseFilePath,
  getPrisma,
  initializeDatabase,
} from './database/sqlite-client';
import { cleanupOrphanImages } from './images/image-store';
import { receiptImageNames } from './printing/layouts';
import { removeLeftoverReceiptFiles } from './printing/printer';
import { handleImageScheme, registerImageScheme } from './images/images-protocol';
import { broadcast, registerIpcHandlers } from './ipc/register';
import { initLogger, logger } from './logger';
import { installSecurityHandlers } from './security';
import { createUpdater, UPDATE_FEED_URL, type UpdaterEngine } from './updater/updater';
import { publicKeyFrom } from './license/license-core';
import { LICENSE_PUBLIC_KEY } from './license/license-public-key';
import { DEFAULT_API_URL, httpClient, LicenseService } from './license/license-service';
import { dbMarkStore, fileMarkStore } from './license/mark-stores';
import { TrustedClock } from './license/trusted-clock';
import { createWindow, DEV_SERVER_URL, INDEX_HTML_PATH } from './window';

/** The quiet update check waits for start-up to settle (database, first window, printers). */
const STARTUP_UPDATE_CHECK_MS = 15_000;

let mainWindow: BrowserWindow | null = null;
let license: LicenseService | null = null;

/**
 * The posgro API the licence comes from. Only a development run may point elsewhere
 * (SAVDOCHEF_API_URL, https or this machine), so an installed till cannot be aimed at a local
 * server that plays an old licence back.
 */
function licenseApiUrl(): string {
  const override = process.env['SAVDOCHEF_API_URL']?.trim();
  if (!override || app.isPackaged) return DEFAULT_API_URL;
  const ok = /^https:\/\//.test(override) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(override);
  return ok ? override : DEFAULT_API_URL;
}

/** Housekeeping, never blocks or breaks startup. */
async function removeOrphanImages(imageDir: string): Promise<void> {
  try {
    const rows = await getPrisma().menuItem.findMany({
      where: { imageFile: { not: null } },
      select: { imageFile: true },
    });
    // Dish pictures and the receipt layouts' top and bottom pictures share the store.
    const referenced = new Set([
      ...rows.map((r) => r.imageFile!),
      ...(await receiptImageNames(getPrisma())),
    ]);
    const removed = cleanupOrphanImages(imageDir, referenced);
    if (removed.length) logger.info(`[img] removed ${removed.length} unused picture(s)`);
  } catch (error) {
    logger.warn('[img] cleanup failed', error);
  }
}

// No GPU acceleration (as posgro): tills are often reached over AnyDesk/RDP or have weak GPUs.
// Measured on the dev machine: first paint ~19 s with the GPU, ~1 s without.
app.disableHardwareAcceleration();

initLogger();

// Chromium's own UI locale (native date inputs, built-in messages). It has no Uzbek locale, so
// Russian gives the day-first date format used in Uzbekistan (dd.mm.yyyy). The app's own text
// comes from its i18n files, not from this.
app.commandLine.appendSwitch('lang', 'ru');

// Custom schemes must be declared before the app is ready.
registerImageScheme();

// One instance per machine: two copies would fight over the SQLite file (and, later, the LAN port).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    installSecurityHandlers({ devServerUrl: DEV_SERVER_URL, indexHtmlPath: INDEX_HTML_PATH });

    try {
      await initializeDatabase();
    } catch (error) {
      logger.error('[db] failed to open database:', error);
      dialog.showErrorBox(
        "Ma'lumotlar bazasini ochib bo'lmadi",
        `${error instanceof Error ? error.message : String(error)}\n\nFayl: ${databaseFilePath()}`,
      );
      app.exit(1);
      return;
    }

    const imageDir = path.join(app.getPath('userData'), 'img');
    handleImageScheme(imageDir);
    void removeOrphanImages(imageDir);
    void removeLeftoverReceiptFiles();
    const updater = createUpdater({
      currentVersion: app.getVersion(),
      // The NSIS build only: dev and unpacked runs have no app-update.yml and nothing to replace.
      supported: app.isPackaged && process.platform === 'win32',
      // autoUpdater is created on first access, so a dev run never builds one.
      engine: () => {
        autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
        autoUpdater.logger = logger;
        return autoUpdater as unknown as UpdaterEngine;
      },
      onChange: () => broadcast([{ type: 'update-changed' }]),
      // Only the database: quitAndInstall then quits the app itself. Destroying the windows here
      // fired window-all-closed -> app.quit() before quitAndInstall ran, so nothing installed.
      beforeInstall: async () => {
        await license?.stop();
        await closeDatabase();
      },
      log: logger,
    });
    // Feature F5: the licence from the posgro server, checked on every IPC call.
    license = new LicenseService({
      db: getPrisma(),
      publicKey: publicKeyFrom(LICENSE_PUBLIC_KEY),
      clock: new TrustedClock([dbMarkStore(getPrisma), fileMarkStore(app.getPath('userData'))]),
      http: httpClient(licenseApiUrl()),
      appVersion: app.getVersion(),
      machineName: os.hostname(),
      onChange: () => broadcast([{ type: 'license-changed' }]),
      log: logger,
    });
    await license.init();
    license.start();
    registerIpcHandlers(getPrisma, imageDir, updater, license);
    setTimeout(() => void updater.check({ quiet: true }), STARTUP_UPDATE_CHECK_MS).unref();

    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    // The clock mark first (it writes to the database), then the database.
    void (license?.stop() ?? Promise.resolve()).finally(() => closeDatabase());
  });
}
