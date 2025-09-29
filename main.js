// main.js
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import 'dotenv/config';

// Window factories (split files are optional; see below)
import { createLoginWindow } from './login.page.js';
import { createMainWindow } from './main.page.js';
import { createCategoryWindow } from './category-window.js';
import { createSessionWindow } from './sessionAdd-window.js';
import { getPreloadPath, htmlPath } from './paths.js';
import { fileURLToPath } from 'node:url';

// IMPORTANT: base origin without /api
const API_ORIGIN = process.env.API_BASE || 'http://localhost:3000';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let setupWindow = null;

// Dev reload (optional)
if (process.env.NODE_ENV !== 'production') {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const reload = require('electron-reload');
  reload(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    watchRenderer: true,
    ignored: ['**/backend/**', '**/*.log']
  });
}

/* ----------------------------- Setup Window ----------------------------- */
function openSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) return setupWindow;

  setupWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    show: false,
    title: 'Initial Setup',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupWindow.loadFile(htmlPath('setup.html'));
  setupWindow.once('ready-to-show', () => setupWindow?.show());
  setupWindow.on('closed', () => { setupWindow = null; });

  return setupWindow;
}

/* ------------------------------ Health check ---------------------------- */
async function checkHealth() {
  try {
    const res = await fetch(`${API_ORIGIN}/api/setup/status`);
    if (!res.ok) throw new Error(`Health HTTP ${res.status}`);
    const data = await res.json();
    // setupComplete = adminExists && receiptExists
    return Boolean(data?.adminExists && data?.receiptExists);
  } catch (e) {
    console.error('[health] failed:', e.message);
    return false;
  }
}

/* ------------------------------ IPC: Setup ------------------------------ */

// Renderer holat so‘rashi uchun
ipcMain.handle('setup:status', async () => {
  const r = await fetch(`${API_ORIGIN}/api/setup/status`);
  if (!r.ok) throw new Error(`status HTTP ${r.status}`);
  return r.json();
});

// Setup submit: qaysi qismi yo‘qligiga qarab ish tutamiz
ipcMain.handle('setup:submit', async (_evt, payload) => {
  const { username, password, restaurantName, address, phone, footerNote } = payload || {};

  // 1) statusni tekshir
  const stRes = await fetch(`${API_ORIGIN}/api/setup/status`);
  if (!stRes.ok) throw new Error(`status HTTP ${stRes.status}`);
  const { adminExists, receiptExists } = await stRes.json();

  // 2) yo‘q qismlarini to‘ldir
  if (!adminExists) {
    const ures = await fetch(`${API_ORIGIN}/api/setup`, {   // <-- setupRouter POST /
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!ures.ok) throw new Error(`Create admin failed: ${await ures.text()}`);
  }

  if (!receiptExists) {
    const sres = await fetch(`${API_ORIGIN}/api/receipt-settings/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantName, address, phone, footerNote })
    });
    if (!sres.ok) throw new Error(`Create receipt settings failed: ${await sres.text()}`);
  }

  // 3) ixtiyoriy: ikkisi ham bor bo‘lsa setup_complete=true qilib qo‘yish (agar ishlatayotgan bo‘lsangiz)
  try {
    const { adminExists: a2, receiptExists: r2 } = await (await fetch(`${API_ORIGIN}/api/setup/status`)).json();
    if (a2 && r2) {
      // agar Settings.setup_complete dan foydalanayotgan bo‘lsangiz shu yerda update qilishingiz mumkin
      // fetch(`${API_ORIGIN}/api/setup/complete`, { method:'POST' }) ... (ixtiyoriy)
    }
  } catch { }

  return { ok: true };
});

ipcMain.on('setup:done', () => {
  // After setup closes, go to login screen
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  setupWindow = null;
  createLoginWindow(); // -> on successful login, renderer sends 'auth/open-main'
});

/* ------------------------------ IPC: Auth ------------------------------- */
ipcMain.on('auth/open-main', () => {
  // called by login renderer after successful auth
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
  BrowserWindow.getAllWindows().forEach(win => {
    if (win !== mainWindow) win.close();
  });
  mainWindow.show();
});

let currentUser = null; // token o‘rniga oddiy session flag

// main.js
ipcMain.handle('attempt-login', async (_e, { username, password }) => {
  const res = await fetch(`${API_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) return { success: false, message: 'Login failed' };
  const data = await res.json();
  
  return { success: true, user: data.user };
});


ipcMain.handle('auth:me', async () => currentUser);
ipcMain.on('auth:logout', () => { currentUser = null; });

/* ------------------------------ Payment win ----------------------------- */
function createPaymentWindow(order, parentWindow) {
  const win = new BrowserWindow({
    width: 600,
    height: 700,
    parent: parentWindow || mainWindow,
    modal: true,
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(htmlPath('payment.html'));

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('load-order', order);
  });

  return win;
}

ipcMain.on('open-payment-window', (event, order) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const child = createPaymentWindow(order, parentWindow);

  ipcMain.once('confirm-payment', () => {
    if (!event.sender.isDestroyed()) {
      event.reply('payment-complete', { success: true });
    }
    if (!child.isDestroyed()) child.close();
  });
});

/* ------------------------------- Add/Menu etc --------------------------- */
ipcMain.handle('open-add-window', (event, dish) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const addWin = new BrowserWindow({
    width: 950, height: 550, parent, modal: true, autoHideMenuBar: true, resizable: false,
    webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false }
  });
  addWin.loadFile(htmlPath('add-item.html'));
  if (dish) {
    addWin.webContents.once('did-finish-load', () => addWin.webContents.send('load-dish', dish));
  }
  return true;
});

ipcMain.handle('open-category-window', (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  createCategoryWindow(parent);
  return true;
});

ipcMain.handle('open-session-window', (e, { mode = 'create', sessionId = null } = {}) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  createSessionWindow(parent, { mode, sessionId });
  return true;
});

ipcMain.on('session-updated', (e) => {
  const child = BrowserWindow.fromWebContents(e.sender);
  const parent = child?.getParentWindow();
  if (parent) parent.webContents.send('session-updated');
});

ipcMain.on('menu-updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('reload-menu');
  }
});

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

/* ----------------------------- App lifecycle ---------------------------- */
app.whenReady().then(async () => {
  // decide which window to show first
  const setupComplete = await checkHealth();
  if (!setupComplete) {
    openSetupWindow();
  } else {
    createLoginWindow(); // your existing login flow
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
