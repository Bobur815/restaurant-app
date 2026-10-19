import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import {
  closeDatabase,
  databaseFilePath,
  getPrisma,
  initializeDatabase,
} from './database/sqlite-client';
import { cleanupOrphanImages } from './images/image-store';
import { handleImageScheme, registerImageScheme } from './images/images-protocol';
import { registerIpcHandlers } from './ipc/register';
import { initLogger, logger } from './logger';
import { installSecurityHandlers } from './security';
import { createWindow, DEV_SERVER_URL, INDEX_HTML_PATH } from './window';

let mainWindow: BrowserWindow | null = null;

/** Housekeeping, never blocks or breaks startup. */
async function removeOrphanImages(imageDir: string): Promise<void> {
  try {
    const rows = await getPrisma().menuItem.findMany({
      where: { imageFile: { not: null } },
      select: { imageFile: true },
    });
    const removed = cleanupOrphanImages(imageDir, new Set(rows.map((r) => r.imageFile!)));
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
    registerIpcHandlers(getPrisma, imageDir);

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
    void closeDatabase();
  });
}
