// npm run apk [-- --debug-signed]
//
// Builds the release APK of SavdoChef Ofitsiant: a clean `expo prebuild`, then Gradle
// `assembleRelease`, then copies it to waiter/dist/ with its sha256 and a version.json for the
// update feed (panel.posgro.uz/releases/savdochef-waiter/). Uploading is a separate, deliberate
// step (scripts/upload-waiter.mjs at the repo root, only when asked).
//
// Refuses to build for phones without the release key (see plugins/with-release-signing.js);
// `--debug-signed` builds for the emulator only, and its file name says so.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debugSigned = process.argv.includes('--debug-signed');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!debugSigned) {
  const missing = ['WAITER_KEYSTORE', 'WAITER_KEYSTORE_PASSWORD', 'WAITER_KEY_ALIAS', 'WAITER_KEY_PASSWORD'].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(`Release key not set: ${missing.join(', ')}. Use --debug-signed for the emulator.`);
    process.exit(1);
  }
  if (!fs.existsSync(process.env.WAITER_KEYSTORE)) {
    console.error(`Keystore not found: ${process.env.WAITER_KEYSTORE}`);
    process.exit(1);
  }
}

const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
if (!fs.existsSync(sdk)) {
  console.error(`Android SDK not found (${sdk}). Set ANDROID_HOME.`);
  process.exit(1);
}
const env = { ...process.env, ANDROID_HOME: sdk, NODE_ENV: 'production' };
if (debugSigned) delete env.WAITER_KEYSTORE;

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });

run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], root);
run(process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew', ['assembleRelease', '--no-daemon'], path.join(root, 'android'));

const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const name = `SavdoChef-Ofitsiant-${pkg.version}${debugSigned ? '-debug-signed' : ''}.apk`;
const target = path.join(dist, name);
fs.copyFileSync(built, target);
const bytes = fs.readFileSync(target);
const sha256 = createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(`${target}.sha256`, `${sha256}  ${name}\n`);
if (!debugSigned) {
  const feed = {
    version: pkg.version,
    url: `https://panel.posgro.uz/releases/savdochef-waiter/${name}`,
    sha256,
    size: bytes.length,
    notes: { uz: [], ru: [] },
  };
  fs.writeFileSync(path.join(dist, 'version.json'), `${JSON.stringify(feed, null, 2)}\n`);
}
console.log(`\n${target}\n${bytes.length} bytes, sha256 ${sha256}`);
