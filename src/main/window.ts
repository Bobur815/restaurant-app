import { app, BrowserWindow, Menu, type BrowserWindowConstructorOptions } from 'electron';
import path from 'path';
import { logger } from './logger';

export const INDEX_HTML_PATH = path.join(__dirname, '../../dist-renderer/index.html');
export const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

// Taskbar/window icon: shipped as resources/icons (extraResources) in a package, build/icons in dev.
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icons', 'savdochef.ico')
  : path.join(__dirname, '../../build/icons/savdochef.ico');

/**
 * The only way a BrowserWindow is created. webPreferences are fixed here and cannot be
 * overridden by callers: the security baseline lives in one place.
 */
export function createWindow(
  options: Omit<BrowserWindowConstructorOptions, 'webPreferences'> = {},
  route = '',
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'SavdoChef',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    ...options,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  if (app.isPackaged) Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error(`[window] did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(route ? `${DEV_SERVER_URL}#${route}` : DEV_SERVER_URL);
  } else {
    void win.loadFile(INDEX_HTML_PATH, route ? { hash: route } : undefined);
  }

  return win;
}
