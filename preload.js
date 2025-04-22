
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
  sendLogin: (credentials) => ipcRenderer.send("attempt-login", credentials),
  receiveLoginResult: (callback) =>
    ipcRenderer.on("login-result", (event, result) => callback(result)),
});
