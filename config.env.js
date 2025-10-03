// config.env.js
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import dotenv from 'dotenv';

export function loadEnv() {
  const locations = [];

  if (app.isPackaged) {
    // 1) per-user config (best place for editable config)
    locations.push(path.join(app.getPath('userData'), '.env'));

    // 2) read-only template shipped with the app (see step 3)
    locations.push(path.join(process.resourcesPath, 'config', '.env'));

    // 3) as a last resort, try inside asar (works for reads)
    locations.push(path.join(app.getAppPath(), '.env'));
  } else {
    // dev
    locations.push(path.join(process.cwd(), '.env'));
  }

  for (const p of locations) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      return p;
    }
  }

  console.warn('[env] no .env found — using defaults if any');
  return null;
}
