import { app, BrowserWindow } from 'electron';
import { getPreloadPath, htmlPath } from './paths.js';

const isProd = app.isPackaged;

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
      nodeIntegration: false,
      devTools: !isProd ? true : false,
    }
  });

  catWin.loadFile(htmlPath('category.settings.html'));
  return catWin;
}
