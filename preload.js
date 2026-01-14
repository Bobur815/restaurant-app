// preload.cjs (CommonJS)
const { contextBridge, ipcRenderer } = require('electron');

// --- Birlashtirilgan API (barchasini bitta expose ostida beramiz)
const api = {
  // image helper
  getImagePath: (dish) => {
    const filename = (dish && (dish.imageUrl || (dish.menu && dish.menu.imageUrl))) || null;
    return ipcRenderer.invoke("get-image-path", filename);
  },

  // Sessions
  openSessionCreateWindow: () => ipcRenderer.invoke('open-session-window', { mode: 'create' }),
  openSessionEditWindow: (sessionId) => ipcRenderer.invoke('open-session-window', { mode: 'edit', sessionId }),
  closeSessionWindow: (sessionId) => ipcRenderer.invoke('open-session-window', { mode: 'close', sessionId }),
  emitSessionUpdated: () => ipcRenderer.send('session-updated'),
  onSessionUpdated: (cb) => ipcRenderer.on('session-updated', (_e, ...args) => cb?.(...args)),

  // Windows / dialogs
  closeMainWindow: () => ipcRenderer.send('window:close'),
  openCategoryWindow: () => ipcRenderer.invoke('open-category-window'),
  openAddWindow: (dish) => ipcRenderer.invoke('open-add-window', dish),
  selectImage: () => ipcRenderer.invoke('dialog:openImage'),

  // Menu reload
  menuUpdated: () => ipcRenderer.send('menu-updated'),
  onMenuReload: (cb) => ipcRenderer.on('reload-menu', () => cb?.()),

  // Add-item preload comms
  onLoadDish: (cb) => ipcRenderer.on('load-dish', (_e, dish) => cb?.(dish)),

  // Payment flow
  openPaymentWindow: (order) => new Promise((resolve) => {
    ipcRenderer.once('payment-complete', (_e, result) => resolve(result));
    ipcRenderer.send('open-payment-window', order);
  }),
  onLoadOrder: (cb) => ipcRenderer.on('load-order', (_e, data) => cb?.(data)),
  confirmPayment: () => ipcRenderer.send('confirm-payment'),
  sendPrint: (payload) => ipcRenderer.invoke('print-receipt', payload),


  // Setup flow
  submitSetup: (payload) => ipcRenderer.invoke('setup:submit', payload),
  setupDone: () => ipcRenderer.send('setup:done'),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),

  // Auth
  afterLoginSuccess: () => ipcRenderer.send('auth/open-main'),
  attemptLogin: (p) => ipcRenderer.invoke('attempt-login', p),
  me: () => ipcRenderer.invoke('auth:me'),
  logout: () => ipcRenderer.send('auth:logout'),
};

// Bitta namespace bilan expose qilamiz (dublikatdan qochish uchun try/catch shart emas)
contextBridge.exposeInMainWorld('electronAPI', api);

