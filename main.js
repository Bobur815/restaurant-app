// main.js — SavdoChef (ESM) with IPC

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// === your modules ===
import { createLoginWindow } from './login.page.js';
import { createMainWindow } from './main.page.js';
import { createCategoryWindow } from './category-window.js';
import { createSessionWindow } from './sessionAdd-window.js';
import { getPreloadPath, htmlPath } from './paths.js';
import { registerPrinting } from './printing.js';

// ---------------- small utils / logging ----------------
function logLine(s) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'startup.log'), `[${new Date().toISOString()}] ${s}\n`);
  } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function withTimeout(promise, ms, tag = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms)),
  ]);
}

// ---------------- early boot ----------------
logLine('---- boot');
logLine(`argv=${JSON.stringify(process.argv)}`);
logLine(`cwd=${process.cwd()}`);

if (process.platform === 'win32') {
  try {
    const sq = require('electron-squirrel-startup');
    logLine(`electron-squirrel-startup=${String(sq)}`);
    if (sq) {
      logLine('Exiting due to Squirrel maintenance.');
      process.exit(0);
    }
  } catch (e) {
    logLine('squirrel require failed (ok in dev): ' + (e?.message || e));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { win.show(); win.focus(); }
  });
}

app.setAppUserModelId('com.savdochef.app');

const API_PORT   = Number(process.env.API_PORT || 3000);
const API_HOST   = '127.0.0.1';
const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const RES_DIR    = app.isPackaged ? process.resourcesPath : process.cwd();
const BASE_IMG_PATH = path.join(app.isPackaged ? app.getPath('userData') : process.cwd(), 'img');

// ---------------- database url (sqlite) ----------------
function ensureDatabaseUrl() {
  const userData = app.getPath('userData');
  const dataDir  = path.join(userData, 'data');
  const dbPath   = path.join(dataDir, 'app.db');
  fs.mkdirSync(dataDir, { recursive: true });

  const seed = path.join(RES_DIR, 'backend', 'prisma', 'data', 'app.db');
  if (!fs.existsSync(dbPath) && fs.existsSync(seed)) {
    try { fs.copyFileSync(seed, dbPath); } catch (e) { logLine('seed copy failed: ' + e.message); }
  }

  const filePosix = dbPath.split(path.sep).join('/');
  process.env.DATABASE_URL = `file:${filePosix}`;
  logLine('DATABASE_URL=' + process.env.DATABASE_URL);
}

// ---------------- backend start / wait ----------------
async function startBackendInline() {
  const distEntry  = path.join(RES_DIR, 'backend', 'dist', 'main.js');
  const devEntry   = path.join(RES_DIR, 'backend', 'server.js');
  const entryPath  = fs.existsSync(distEntry) ? distEntry : devEntry;
  if (!fs.existsSync(entryPath)) throw new Error('Backend entry not found: ' + entryPath);

  process.env.PORT = String(API_PORT);
  process.env.HOST = API_HOST;
  process.env.NODE_ENV = app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development');

  logLine('starting backend: ' + entryPath);
  await import(pathToFileURL(entryPath).href);
  logLine('backend module imported');
}

async function waitForApi(origin, totalMs = 15000) {
  const deadline = Date.now() + totalMs;
  const probes = [
    `${origin}/health`,               // agar bor bo‘lsa
    `${origin}/api/setup/status`,     // sizda aniq bor
  ];
  while (Date.now() < deadline) {
    for (const url of probes) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (r.ok) return true;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`waitForApi timeout; tried: ${probes.join(', ')}`);
}


// ---------------- health + basic windows ----------------
async function checkHealth() {
  const url = `${API_ORIGIN}/api/setup/status`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      logLine(`checkHealth HTTP ${res.status}`);
      return false;
    }
    const data = await res.json();
    const setupComplete = Boolean(data?.setupComplete);
    logLine(`checkHealth: admin=${data?.adminExists} receipt=${data?.receiptExists} complete=${setupComplete}`);
    return setupComplete;
  } catch (e) {
    logLine('checkHealth error: ' + (e?.message || e));
    return false;
  }
}


function openSetupWindow() {
  const win = new BrowserWindow({
    width: 520, height: 640, resizable: false, show: false,
    webPreferences: { 
      preload: getPreloadPath(), 
      contextIsolation: true, 
      nodeIntegration: false,
      devTools: !app.isPackaged ? true : false, 
    }
  });
  win.loadFile(htmlPath('setup.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

// ------------------- IPC (your handlers restored) -------------------
ipcMain.handle('get-image-path', (_evt, filename) => {
  const file = filename || 'placeholder.jpg';
  const abs  = path.join(BASE_IMG_PATH, file);
  return pathToFileURL(abs).href; // file:///...
});

ipcMain.handle('setup:status', async () => {
  const r = await fetch(`${API_ORIGIN}/api/setup/status`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`status HTTP ${r.status}`);
  return r.json();
});

ipcMain.handle('setup:submit', async (_evt, payload) => {
  const { username, password, restaurantName, address, phone, footerNote } = payload || {};

  const stRes = await fetch(`${API_ORIGIN}/api/setup/status`);
  if (!stRes.ok) throw new Error(`status HTTP ${stRes.status}`);
  const { adminExists, receiptExists } = await stRes.json();

  if (!adminExists) {
    const ures = await fetch(`${API_ORIGIN}/api/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!ures.ok) throw new Error(`Create admin failed: ${await ures.text()}`);
  }

  if (!receiptExists) {
    const sres = await fetch(`${API_ORIGIN}/api/receipt-settings/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantName, address, phone, footerNote })
    });
    if (!sres.ok) throw new Error(`Create receipt settings failed: ${await sres.text()}`);
  }

  return { ok: true };
});

ipcMain.on('setup:done', () => {
  // Renderer aytadi: setup tugadi → login oynasiga o‘tamiz
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(w => { if (!w.isDestroyed()) w.close(); });
  createLoginWindow();
});

ipcMain.on('auth/open-main', () => {
  // login muvaffaqiyatli bo‘lgach, asosiy oynani ochish
  const main = createMainWindow();
  BrowserWindow.getAllWindows().forEach(w => { if (w !== main) w.close(); });
  main.show();
});

ipcMain.handle('attempt-login', async (_e, { username, password }) => {
  const res = await fetch(`${API_ORIGIN}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) return { success: false, message: 'Login failed' };
  const data = await res.json();
  return { success: true, user: data.user };
});

let currentUser = null;
ipcMain.handle('auth:me', async () => currentUser);
ipcMain.on('auth:logout', () => { currentUser = null; });

function createPaymentWindow(order, parentWindow) {
  const win = new BrowserWindow({
    width: 600, height: 700, parent: parentWindow,
    modal: true, autoHideMenuBar: true, resizable: true,
    minimizable: false, maximizable: false,
    webPreferences: { 
      preload: getPreloadPath(), 
      contextIsolation: true, 
      nodeIntegration: false,
      devTools: true,
    }
  });
  
  win.loadFile(htmlPath('payment.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('load-order', order);
  });
  return win;
}

ipcMain.on('open-payment-window', (event, order) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || null;
  const child  = createPaymentWindow(order, parent);
  ipcMain.once('confirm-payment', () => {
    if (!event.sender.isDestroyed()) {
      event.reply('payment-complete', { success: true });
    }
    if (!child.isDestroyed()) child.close();
  });
});

ipcMain.handle('open-add-window', (event, dish) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || null;
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
    title: 'Select an image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','gif','webp'] }]
  });
  if (canceled || !filePaths?.length) return null;

  const filePath = filePaths[0];
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);

  // Sanitize filename: replace spaces with underscores, remove special chars
  const sanitized = baseName
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '');

  // Add timestamp to avoid overwrites
  const fileName = `${sanitized}_${Date.now()}${ext}`;

  // Ensure img directory exists
  fs.mkdirSync(BASE_IMG_PATH, { recursive: true });

  // Copy file to img folder
  const destPath = path.join(BASE_IMG_PATH, fileName);
  fs.copyFileSync(filePath, destPath);

  const fileUrl = pathToFileURL(destPath).href;
  return { filePath: destPath, fileName, fileUrl };
});

ipcMain.handle('open-category-window', (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || null;
  createCategoryWindow(parent);
  return true;
});

ipcMain.handle('open-session-window', (e, { mode = 'create', sessionId = null } = {}) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || null;
  createSessionWindow(parent, { mode, sessionId });
  return true;
});

ipcMain.on('session-updated', (e) => {
  const child  = BrowserWindow.fromWebContents(e.sender);
  const parent = child?.getParentWindow();
  if (parent) parent.webContents.send('session-updated');
});

ipcMain.on('menu-updated', (event) => {
  const child  = BrowserWindow.fromWebContents(event.sender);
  const parent = child?.getParentWindow() || null;
  if (parent && !parent.isDestroyed()) parent.webContents.send('reload-menu');
});

ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

// ---------------- app lifecycle ----------------
app.whenReady().then(async () => {
  logLine('app.whenReady');

  // DB URL first (Prisma reads it at client instantiate)
  ensureDatabaseUrl();

  // Start backend
  try {
    logLine('startBackendInline begin');
    await withTimeout(startBackendInline(), 15000, 'startBackendInline');
    logLine('startBackendInline ok');
  } catch (e) {
    logLine('startBackendInline failed: ' + (e?.message || e));
    const w = new BrowserWindow({ width: 640, height: 420, show: true });
    w.loadURL(`data:text/html,<h3>Backend failed</h3><pre>${String(e?.message || e)}</pre>`);
    return;
  }

  // Wait health
  try {
    logLine('waitForApi begin ' + API_ORIGIN);
    await withTimeout(waitForApi(API_ORIGIN, 5000), 6000, 'waitForApi wrapper');
    logLine('waitForApi ok');
  } catch (e) {
    logLine('waitForApi failed: ' + (e?.message || e));
    return;
  }

  const isSetupComplete = await checkHealth();
if (isSetupComplete) {
  try { await registerPrinting(); } catch (e) { logLine('print init: ' + e?.message); }
  createLoginWindow();
  // createMainWindow();
} else {
  openSetupWindow();
}

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  logLine('window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
