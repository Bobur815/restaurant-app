const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {

  openSessionAddWindow: () => ipcRenderer.invoke('open-session-window'),
  
  openCategoryWindow: () => ipcRenderer.invoke('open-category-window'),

  // ↙︎ keep this so your menu page can open the add-item window
  openAddWindow: (dish) => ipcRenderer.invoke('open-add-window', dish),

  selectImage: () => ipcRenderer.invoke('dialog:openImage'),

  // ↙︎ call this from add_items.js after a successful save
  menuUpdated: () => ipcRenderer.send('menu-updated'),

  // ↙︎ use this in your mainrenderer.js to auto-reload the grid
  onMenuReload: (callback) => ipcRenderer.on('reload-menu', callback),

  onLoadDish: cb => ipcRenderer.on('load-dish', (_evt, dish) => cb(dish)),

  // Login funksiyalari
  sendLogin: (credentials) => ipcRenderer.send("attempt-login", credentials),
  receiveLoginResult: (callback) =>
    ipcRenderer.on("login-result", (event, result) => callback(result)),

  // 💳 To‘lov oynasi funksiyalari
  openPaymentWindow: (order) => {
    return new Promise((resolve) => {
      ipcRenderer.once('payment-complete', (event, result) => {
        resolve(result);
      });
      ipcRenderer.send('open-payment-window', order);
    });
  },

  // ✅ Add this to receive the order in payment.html
  onLoadOrder: (callback) => ipcRenderer.on("load-order", (event, data) => callback(data)),

  // ✅ Add this to confirm the payment from payment.html
  confirmPayment: () => ipcRenderer.send("confirm-payment"),

});
