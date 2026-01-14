import { app, BrowserWindow, screen } from 'electron';
import { getPreloadPath, htmlPath } from './paths.js';

const isProd = app.isPackaged;

export function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width,
    height,
    fullscreen: false,        // ❌ fullscreen emas
    fullScreenable: false,    // F11 bilan fullscreen’ga o'tishni ham bloklaydi (Windows’da no-op, zarar qilmaydi)
    maximizable: true,
    autoHideMenuBar: true,    // menyu yashirin
    frame: true,              // Windows title bar ko’rinadi (brand + actions)
    show: false,
    resizable: true,
    backgroundColor: '#343a40',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isProd ? true : false,
    }
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.webContents.on('devtools-opened', () => {
    if (isProd) win.webContents.closeDevTools();
  });

  win.loadFile(htmlPath('index.html'));
  return win;
}
