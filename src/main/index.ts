import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC, type AppInfo } from '@shared/api';
import { closeDatabase, databaseFilePath, initializeDatabase } from './database/sqlite-client';
import { installSecurityHandlers } from './security';
import { createWindow, DEV_SERVER_URL, INDEX_HTML_PATH } from './window';

let mainWindow: BrowserWindow | null = null;

// No GPU acceleration (as posgro): tills are often reached over AnyDesk/RDP or have weak GPUs.
// Measured on the dev machine: first paint ~19 s with the GPU, ~1 s without.
app.disableHardwareAcceleration();

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
      console.error('[db] failed to open database:', error);
      dialog.showErrorBox(
        "Ma'lumotlar bazasini ochib bo'lmadi",
        `${error instanceof Error ? error.message : String(error)}\n\nFayl: ${databaseFilePath()}`,
      );
      app.exit(1);
      return;
    }

    ipcMain.handle(
      IPC.appInfo,
      (): AppInfo => ({
        name: app.getName(),
        version: app.getVersion(),
        isPackaged: app.isPackaged,
      }),
    );

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
