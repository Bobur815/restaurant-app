import { BrowserWindow, screen } from 'electron';
import { getPreloadPath, htmlPath } from './paths.js';

export function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width,
    height,                          // ✅ ish maydoni bo‘yicha
    show: false,
    resizable: true,
    
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false)
  win.loadFile(htmlPath('index.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}
