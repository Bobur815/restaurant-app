// paths.js
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Development (unpackaged) base dir = folder where main.js lives
const DEV_BASE = __dirname;

// In production, packaged assets are under process.resourcesPath
const PROD_BASE = process.resourcesPath;

export function getPreloadPath() {
  // Put your preload.js NEXT TO main.js (dev) and in resources root (prod)
  return app.isPackaged
    ? path.join(PROD_BASE, 'preload.js')
    : path.join(DEV_BASE, 'preload.js');
}

export function htmlPath(rel) {
  // Your HTMLs under ./html in dev; copy to resources in prod
  return app.isPackaged
    ? path.join(PROD_BASE, 'html', rel)
    : path.join(DEV_BASE, 'html', rel);
}
