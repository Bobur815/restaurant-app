import { app } from 'electron';
import { createLoginWindow } from './login.page.js';

app.whenReady().then(() => {
  createLoginWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createLoginWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Ping uchun qoladi
import { ipcMain } from 'electron';
ipcMain.handle("ping", () => {
  return "pong";
});
