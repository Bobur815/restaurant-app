// paths.js (ESM)
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Dev: __dirname, Prod: app.getAppPath() (asar ichida)
const APP_ROOT = app.isPackaged ? app.getAppPath() : __dirname;

// 🔴 OLDIN: 'preload.js'  🔵 ENDI: 'preload.cjs'
export const getPreloadPath = () => path.join(APP_ROOT, 'preload.js');

// Agar html fayllaringiz ./html ichida bo‘lsa:
export const htmlPath = (rel) => path.join(APP_ROOT, 'html', rel);
// (Agar sizda boshqacha papka bo‘lsa — moslang)
