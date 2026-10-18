import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC, type AppInfo } from '@shared/api';
import { installSecurityHandlers } from './security';
import { createWindow, DEV_SERVER_URL, INDEX_HTML_PATH } from './window';

let mainWindow: BrowserWindow | null = null;

// One instance per machine: two copies would fight over the SQLite file (and, later, the LAN port).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    installSecurityHandlers({ devServerUrl: DEV_SERVER_URL, indexHtmlPath: INDEX_HTML_PATH });

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
}
