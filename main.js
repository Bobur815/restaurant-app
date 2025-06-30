// === main.js ===
import { app, ipcMain, BrowserWindow } from 'electron';
import { createLoginWindow } from './login.page.js';
import { createMainWindow } from './main.page.js';
import path from 'path';
import url from 'url';

// Electron reload in development
if (process.env.NODE_ENV !== 'production') {
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

let __filename = url.fileURLToPath(import.meta.url);
let __dirname = path.dirname(__filename);

// Create payment window function
function createPaymentWindow(order,parentWindow) {
  const win = new BrowserWindow({
    width: 600,
    height: 700,
    parent: parentWindow,     // 👈 parent window set
    modal: true,              // 👈 make it modal
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, '/html/payment.html'));

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('load-order', order);
  });

  return win;
}

// Listen to renderer event to open payment window
ipcMain.on('open-payment-window', (event, order) => {
  const parentWindow = BrowserWindow.getFocusedWindow();
  const win = createPaymentWindow(order, parentWindow);

  ipcMain.once('confirm-payment', () => {
    // ✅ Check before sending reply
    if (!event.sender.isDestroyed()) {
      event.reply('payment-complete', { success: true });
    }

    if (!win.isDestroyed()) {
      win.close(); // only close if not already closed
    }
  });
});


// Electron lifecycle
app.whenReady().then(() => {
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
