import { BrowserWindow } from 'electron';
import { getPreloadPath, htmlPath } from './paths.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createLoginWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 600,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'brand_logo.png'),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(htmlPath('login.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}
