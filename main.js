// main.js
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import squirrelStartup from 'electron-squirrel-startup';
// Window factories (split files are optional; see below)
import { createLoginWindow } from './login.page.js';
import { createMainWindow } from './main.page.js';
import { createCategoryWindow } from './category-window.js';
import { createSessionWindow } from './sessionAdd-window.js';
import { getPreloadPath, htmlPath } from './paths.js';
import { loadEnv } from './config.env.js';
import { printReceipt } from './printer.js';
// ---- DB path resolver (put near the top of main.js) ----
import fs from "node:fs";
import os from "node:os";

// choose a nice filename
const DB_FILENAME = "savdochef.db";

if (process.platform === 'win32' && squirrelStartup) {
  app.quit();
}

function getDevDbPath() {
  // your current dev db location
  return path.join(process.cwd(), "backend", "data", "app.db");
}

function getProdDbPath() {
  // user-writable location
  return path.join(app.getPath("userData"), DB_FILENAME);
}

function getPackagedSeedDbPath() {
  // optional seed shipped inside the app (read-only)
  // e.g. you can package backend/data/app.db as a seed
  const appRoot = app.getAppPath();
  return path.join(appRoot, "backend", "data", "app.db");
}

/** Ensure DB exists in a writable place; copy from packaged seed if present. */
function ensureWritableDb() {
  if (!app.isPackaged) {
    const dev = getDevDbPath();
    fs.mkdirSync(path.dirname(dev), { recursive: true });
    return dev; // dev writes directly to backend/data/app.db
  }

  const target = getProdDbPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (!fs.existsSync(target)) {
    const seed = getPackagedSeedDbPath();
    if (fs.existsSync(seed)) {
      try {
        fs.copyFileSync(seed, target);
      } catch (e) {
        console.warn("[db] Seed copy failed, Prisma will create tables on first run:", e.message);
      }
    } else {
      // no seed — Prisma will create the file/tables on migrate/db push
    }
  }
  return target;
}

/** Build a Prisma DATABASE_URL from an absolute file path */
function buildSqliteUrl(absPath) {
  // Prisma expects a file: URL; make sure we escape Windows backslashes
  // simplest: prefix with file:
  return `file:${absPath}`;
}


// IMPORTANT: base origin without /api
const API_PORT = process.env.API_PORT || '3000';
const API_ORIGIN = process.env.API_BASE || `http://127.0.0.1:${API_PORT}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


async function startBackendInline() {
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const entryPath = path.join(appRoot, 'backend', 'server.js');
  const entryUrl = pathToFileURL(entryPath).href;

  // decide DB file location and export to backend env
  const dbPath = ensureWritableDb();
  process.env.DATABASE_URL = buildSqliteUrl(dbPath);

  process.env.PORT = process.env.PORT || '3000';
  process.env.NODE_ENV = process.env.NODE_ENV || (app.isPackaged ? 'production' : 'development');

  try {
    await import(entryUrl);
  } catch (e) {
    console.error('[backend] failed to start:', e);
  }
}

async function waitForApi(origin, { retries = 40, interval = 250 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 800);
      const r = await fetch(`${origin}/api/setup/status`, { signal: c.signal, cache: 'no-store' });
      clearTimeout(t);
      if (r.ok) return true;
    } catch { }
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

let mainWindow = null;
let setupWindow = null;

// DEV ONLY: enable reload when not packaged
if (!app.isPackaged) {
  try {
    const { default: reload } = await import('electron-reload'); // dynamic import
    const electronBin =
      process.platform === 'win32'
        ? path.join(process.cwd(), 'node_modules', '.bin', 'electron.cmd')
        : path.join(process.cwd(), 'node_modules', '.bin', 'electron');

    reload(__dirname, {
      electron: electronBin,
      watchRenderer: true,
      awaitWriteFinish: true,
      ignored: ['**/backend/**', '**/*.log'],
    });
  } catch { }
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
    resizable: true,
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

ipcMain.handle('dialog:openImage', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Rasm tanlash',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
    ]
  });

  if (canceled || !filePaths || !filePaths[0]) return null;
  // Return absolute path (renderer can do `file://` preview)
  return filePaths[0];
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

ipcMain.on('menu-updated', (event) => {
  // Use the parent of the Add window if present; fallback to mainWindow
  const child  = BrowserWindow.fromWebContents(event.sender);
  const parent = child?.getParentWindow() || mainWindow;
  if (parent && !parent.isDestroyed()) {
    parent.webContents.send('reload-menu');
  }
});

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});


ipcMain.on('print-receipt', async (evt, payload) => {
  try {
    const { order, paymentMethod } = payload || {};
    await printReceipt(order, paymentMethod);
    evt.reply('print-receipt:done', { ok: true });
  } catch (err) {
    console.error('print-receipt failed:', err);
    evt.reply('print-receipt:done', { ok: false, error: String(err?.message || err) });
  }
});

/* ----------------------------- App lifecycle ---------------------------- */
app.whenReady().then(async () => {
  loadEnv();
  await startBackendInline();            // ⬅️ start API in the same process
  const up = await waitForApi(API_ORIGIN);
  // decide which window to show first
  const setupComplete = await checkHealth();
  if (!setupComplete) {
    openSetupWindow();
  } else {
    createMainWindow();
    // createLoginWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
      
      // createLoginWindow();
    }
  });
});

app.on('browser-window-created', (_e, win) => {
  if (app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      // Block F12 and Ctrl+Shift+I (Cmd+Alt+I on macOS)
      const isDevToolsCombo =
        input.key === 'F12' ||
        (input.control && input.shift && input.key.toUpperCase() === 'I') ||
        (process.platform === 'darwin' && input.meta && input.alt && input.key.toUpperCase() === 'I');

      if (isDevToolsCombo) event.preventDefault();
    });
  }
});

app.setAppUserModelId('com.savdochef.app');

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
