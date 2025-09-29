import { BrowserWindow } from 'electron';
import { getPreloadPath, htmlPath } from './paths.js';


export function createLoginWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    show: false,
    title: 'Login',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(htmlPath('login.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}
