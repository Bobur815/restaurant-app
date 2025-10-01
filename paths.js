// paths.js
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// In prod: app.getAppPath() => .../resources/app.asar
const APP_ROOT = app.isPackaged ? app.getAppPath() : __dirname;

export const getPreloadPath = () => path.join(APP_ROOT, 'preload.js');

// If your files live in ./html/*.html use 'html' below; if ./renderer/*.html use 'renderer'
export const htmlPath = (rel) => path.join(APP_ROOT, 'html', rel);
