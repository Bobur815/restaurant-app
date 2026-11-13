#!/usr/bin/env node
/**
 * Development run of SavdoChef against posgro STAGING, one data folder per test restaurant.
 *
 *   npm run dev:staging -- <profile>              start (creates the profile on first use)
 *   npm run dev:staging -- <profile> --copy-data  new profile seeded with a copy of the real data
 *   npm run dev:staging -- --list                 list the profiles
 *
 * A profile is `.dev-profiles/<profile>/` (git-ignored): its own database, licence, pictures and
 * logs, so each staging restaurant stays linked and switching is just another profile name.
 * Link a new profile once: setup wizard (or Settings -> Obuna) -> "Mavjud restoran" with the
 * restaurant's phone and an activation code from the staging dashboard (restaurant page).
 *
 * The real data in %APPDATA%\SavdoChef is only ever read (--copy-data copies it); a copied
 * database still holds the production licence: relink it in Settings -> Obuna.
 * SAVDOCHEF_API_URL / SAVDOCHEF_USER_DATA are honoured by development runs only (main/index.ts).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STAGING_API_URL = process.env.STAGING_API_URL || 'https://dev.web.posgro.uz/api';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilesDir = path.join(root, '.dev-profiles');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const name = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function list() {
  const names = fs.existsSync(profilesDir)
    ? fs.readdirSync(profilesDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];
  if (!names.length) {
    console.log('No profiles yet. Start one: npm run dev:staging -- <profile>');
    return;
  }
  for (const d of names) {
    const db = path.join(profilesDir, d.name, 'data', 'savdochef.db');
    const used = fs.existsSync(db) ? fs.statSync(db).mtime.toISOString().slice(0, 16).replace('T', ' ') : 'never started';
    console.log(`${d.name.padEnd(20)} last used ${used}`);
  }
}

if (flags.has('--list')) {
  list();
  process.exit(0);
}
if (!name) fail('Usage: npm run dev:staging -- <profile> [--copy-data] | --list');
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) fail('Profile name: lowercase letters, digits and -, up to 32 characters.');

const userData = path.join(profilesDir, name);
const dbFile = path.join(userData, 'data', 'savdochef.db');
const fresh = !fs.existsSync(dbFile);

if (flags.has('--copy-data')) {
  if (!fresh) fail(`Profile "${name}" already has a database; --copy-data only seeds a new profile.`);
  const real = path.join(process.env.APPDATA || '', 'SavdoChef', 'data', 'savdochef.db');
  if (!fs.existsSync(real)) fail(`No real database at ${real}`);
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  // Copy only; the real file is never opened for writing.
  fs.copyFileSync(real, dbFile);
  console.log(`Seeded "${name}" with a copy of ${real}. Relink it to a staging restaurant in Settings -> Obuna.`);
}

fs.mkdirSync(userData, { recursive: true });
console.log(`SavdoChef dev | profile "${name}"${fresh && !flags.has('--copy-data') ? ' (new: link it in the setup wizard)' : ''}`);
console.log(`  server   ${STAGING_API_URL}`);
console.log(`  data     ${userData}`);

const child = spawn('npx', ['electron-vite', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SAVDOCHEF_API_URL: STAGING_API_URL, SAVDOCHEF_USER_DATA: userData },
});
child.on('exit', (code) => process.exit(code ?? 0));
