import { BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './backend/config/Database.js';  // DB ni shu yerda ishlatamiz
import { createMainWindow } from './main.page.js';  // Main oynani shu fayldan chaqiramiz

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createLoginWindow() {
  const loginWin = new BrowserWindow({
    width: 450,
    height: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  loginWin.setMenuBarVisibility(false);
  loginWin.loadFile(join(__dirname, './html/login.html'));
  // loginWin.webContents.openDevTools();

  // Login jarayoni shu yerda
  ipcMain.on("attempt-login", async (event, { username, password }) => {
    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE name = ? AND password = ?", [username, password]);
      if (rows.length > 0) {
        event.sender.send("login-result", { success: true });
        loginWin.close();
        createMainWindow();   // Muvaffaqiyatli login bo‘lsa, asosiy oynani ochamiz
      } else {
        event.sender.send("login-result", { success: false });
      }
    } catch (err) {
      console.error("Login DB error:", err);
      event.sender.send("login-result", { success: false, error: err.message });
    }
  });

  return loginWin;
}

