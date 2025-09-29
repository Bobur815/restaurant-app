import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPreloadPath, htmlPath } from './paths.js';

// ESMda __dirname yaratish
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export function createCategoryWindow(parent) {

  const catWin = new BrowserWindow({
    width: 500,
    height: 450,
    parent,
    modal: true,
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  catWin.loadFile(htmlPath('category.settings.html'));
  return catWin;
}
