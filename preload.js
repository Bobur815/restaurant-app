// preload.js (CJS is fine here)
const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  // --- Sessions ---
  openSessionCreateWindow: () => ipcRenderer.invoke('open-session-window', { mode: 'create' }),
  openSessionEditWindow: (sessionId) => ipcRenderer.invoke('open-session-window', { mode: 'edit', sessionId }),
  closeSessionWindow: (sessionId) => ipcRenderer.invoke('open-session-window', { mode: 'close', sessionId }),
  emitSessionUpdated: () => ipcRenderer.send('session-updated'),
  onSessionUpdated: (cb) => ipcRenderer.on('session-updated', (_e, ...args) => cb?.(...args)),

  // --- Windows / dialogs ---
  closeMainWindow: () => ipcRenderer.send('window:close'),
  openCategoryWindow: () => ipcRenderer.invoke('open-category-window'),
  openAddWindow: (dish) => ipcRenderer.invoke('open-add-window', dish),
  selectImage: () => ipcRenderer.invoke('dialog:openImage'),

  // --- Menu reload ---
  menuUpdated: () => ipcRenderer.send('menu-updated'),
  onMenuReload: (cb) => ipcRenderer.on('reload-menu', (_e) => cb?.()),

  // --- Add-item preload comms ---
  onLoadDish: (cb) => ipcRenderer.on('load-dish', (_e, dish) => cb?.(dish)),

  // --- Payment flow ---
  openPaymentWindow: (order) => new Promise((resolve) => {
    ipcRenderer.once('payment-complete', (_e, result) => resolve(result));
    ipcRenderer.send('open-payment-window', order);
  }),
  onLoadOrder: (cb) => ipcRenderer.on('load-order', (_e, data) => cb?.(data)),
  confirmPayment: () => ipcRenderer.send('confirm-payment'),

  // --- Setup flow (merge these; do NOT expose electronAPI twice) ---
  submitSetup: (payload) => ipcRenderer.invoke('setup:submit', payload),
  setupDone: () => ipcRenderer.send('setup:done'),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
};

// Optional separate namespace (fine to keep distinct)
const authAPI = {
  afterLoginSuccess: () => ipcRenderer.send('auth/open-main'),
  attemptLogin: (p) => ipcRenderer.invoke('attempt-login', p),
  me: () => ipcRenderer.invoke('auth:me'),
  logout: () => ipcRenderer.send('auth:logout'),
};

// Guard to avoid double-binding error
try {
  if (!Object.prototype.hasOwnProperty.call(globalThis, 'electronAPI')) {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  } else {
    console.warn('[preload] electronAPI already exists; skipping expose.');
  }

  if (!Object.prototype.hasOwnProperty.call(globalThis, 'authAPI')) {
    contextBridge.exposeInMainWorld('authAPI', authAPI);
  } else {
    console.warn('[preload] authAPI already exists; skipping expose.');
  }
} catch (err) {
  console.error('[preload] expose error:', err);
}
