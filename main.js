if (process.env.NODE_ENV !== 'production') {
  const path = await import('path');
  const url = await import('url');
  const { createRequire } = await import('module');

  const require = createRequire(import.meta.url);
  const reload = require('electron-reload');

  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  reload(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    watchRenderer: true
  });
}


import { app } from 'electron';
import { createLoginWindow } from './login.page.js';
import { createMainWindow } from './main.page.js';


app.whenReady().then(() => {
  // createLoginWindow();
  createMainWindow(); 
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createLoginWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});



