const { contextBridge, ipcRenderer } = require('electron');
const { Chart, registerables } = require('chart.js');
Chart.register(...registerables);

contextBridge.exposeInMainWorld("electronAPI", {
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

  createChart: (canvasCtx, config) => new Chart(canvasCtx, config),
  destroyChart: (chartInstance) => chartInstance.destroy()
});
