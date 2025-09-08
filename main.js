// === main.js ===
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { createLoginWindow } from './login.page.js';
import { createMainWindow } from './main.page.js';
import path from 'path';
import url from 'url';
import { categoryWindow } from './category-window.js';
import { sessionWindow } from './sessionAdd-window.js';

let mainWindow;

// Electron reload in development
if (process.env.NODE_ENV !== 'production') {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const reload = require('electron-reload');

  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  reload(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    watchRenderer: true,

    // ← Prevent reload when files change in your backend or log directories:
    ignored: [
      '**/backend/**',
      '**/*.log'
    ]
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

function createAddWindow(parent) {

  const addWin = new BrowserWindow({
    width: 950,
    height: 550,
    parent,            
    modal: true,       
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  addWin.loadFile(path.join(__dirname, 'html/add-item.html'));
  return addWin;
}

ipcMain.handle('dialog:openImage', async () => {
  const result = await dialog.showOpenDialog({
    title: "Rasm tanlang",
    defaultPath: "/home/boburmirzo/restaurant-app/img",
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

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
  mainWindow = createMainWindow(); 
});

ipcMain.handle('open-add-window', (event, dish) => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const win = createAddWindow(parent)
  
  if(dish){
    win.webContents.once('did-finish-load', ()=> {
      win.webContents.send('load-dish', dish)
    })
  }
  // use the focused window (your main menu window) as parent
  return true
});

ipcMain.handle('open-category-window', (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const win = categoryWindow(parent)
  return true
})

ipcMain.handle('open-session-window', (e, { mode = 'create', sessionId = null } = {}) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  sessionWindow(parent, { mode, sessionId });   // ⬅️ forward
  return true;
});

// Child oyna saqlaganda parent’ni yangilash uchun relay
ipcMain.on('session-updated', (e) => {
  const child  = BrowserWindow.fromWebContents(e.sender);
  const parent = child?.getParentWindow();
  if (parent) parent.webContents.send('session-updated');
});

ipcMain.on('menu-updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // send a 'reload-menu' event into the main menu renderer
    mainWindow.webContents.send('reload-menu');
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createLoginWindow();
  }
});

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
