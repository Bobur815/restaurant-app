import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);



export function createMainWindow() {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true
    },
  });

  mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(join(__dirname, '/html/index.html'));
  mainWindow.webContents.openDevTools();
}
