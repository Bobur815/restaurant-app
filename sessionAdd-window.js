import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ESMda __dirname yaratish
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export function sessionWindow(parent) {
  const preloadPath = join(__dirname, 'preload.js');
  const htmlPath    = join(__dirname, 'html', 'session-create.html');

  const catWin = new BrowserWindow({
    width: 1200,
    height: 750,
    parent,
    modal: true,
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  catWin.loadFile(htmlPath);
  return catWin;
}
