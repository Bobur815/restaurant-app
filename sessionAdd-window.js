import { BrowserWindow } from 'electron';
import { getPreloadPath, htmlPath } from './paths.js';

export function createSessionWindow(parent, { mode = 'create', sessionId = null } = {}) {

  const win = new BrowserWindow({
    width: 1200,
    height: 750,
    parent,
    modal: true,
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // --- Query obyektini tayyorlaymiz
  const query = { mode: String(mode) };
  if (mode === 'edit' && sessionId) {
    query.edit = String(sessionId);
  } else if (mode === 'close' && sessionId) {
    query.sessionId = String(sessionId);
  }


  // ✅ ENG ISHONCHLI USUL: loadFile(..., { query })
  win.loadFile(htmlPath('session-create.html'), {query});

  // DIAGNOSTIKA: renderer yuklangach, u yerda ko‘rayotgan location’ni qayta log qilamiz
  win.webContents.once('did-finish-load', () => {
    win.webContents.executeJavaScript('location.href')
      .then(href => console.log('[sessionWindow] renderer location.href =', href))
      .catch(err => console.warn('executeJavaScript err:', err));
  });

  return win;
}
