import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true,
    }
  });

  // ❌ maximize emas — bu taskbarni e’tiborga olmaydi
  mainWindow.maximize();

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(join(__dirname, '/html/index.html'));

  // ❗ DevTools vaqtincha, ishlab chiqqach olib tashlang
  mainWindow.webContents.openDevTools();
}
