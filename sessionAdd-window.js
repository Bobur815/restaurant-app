import { BrowserWindow } from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

// ESMda __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export function sessionWindow(parent, { mode = 'create', sessionId = null } = {}) {
  const preloadPath = join(__dirname, 'preload.js');
  const htmlPath    = join(__dirname, 'html', 'session-create.html');

  const win = new BrowserWindow({
    width: 1200,
    height: 750,
    parent,
    modal: true,
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // file:// URL yaratib, query param qo‘shamiz
  const fileUrl = pathToFileURL(htmlPath);
  fileUrl.searchParams.set('mode', mode);
  if (mode === 'edit' && sessionId) {
    fileUrl.searchParams.set('edit', sessionId);
  }

  win.loadURL(fileUrl.toString());
  return win;
}
