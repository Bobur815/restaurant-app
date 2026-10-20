/**
 * Publishes the built installer to the software-update feed (feature F4, posgro's
 * scripts/upload-release.js pattern):
 *
 *   npm run deploy:pos               build + upload the version in package.json
 *   node scripts/upload-release.mjs  upload what is already in dist/
 *   node scripts/upload-release.mjs --dry-run   check everything, upload nothing
 *
 * Target: host `posgro-vps` (~/.ssh/config), /home/bobur/releases/savdochef/, which nginx serves
 * at https://panel.posgro.uz/releases/savdochef/ (the panel's /releases/ alias; no nginx change).
 * Tills read latest.yml there (src/main/updater/updater.ts UPDATE_FEED_URL).
 *
 * Order matters: the installer and its blockmap go up first, under temporary names, and are
 * renamed when complete; latest.yml goes up last and is renamed into place in one step. Until
 * then no till sees the release, and it never sees a half-uploaded file.
 *
 * A version already on the server is refused: tills that downloaded it check its sha512, so a
 * different file under the same name would fail on every till. Bump the version instead
 * (`npm run release -- patch|minor|major`).
 *
 * Uses Windows' own OpenSSH (C:\Windows\System32\OpenSSH): it talks to the Windows ssh-agent that
 * holds the key; Git Bash's ssh does not.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { get } from 'node:https';
import path from 'node:path';

const HOST = 'posgro-vps';
const REMOTE_DIR = '/home/bobur/releases/savdochef';
const PUBLIC_URL = 'https://panel.posgro.uz/releases/savdochef/';
const dryRun = process.argv.includes('--dry-run');

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
// It ends up in remote shell commands and sftp batch lines below: plain semver only.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`✖ package.json version "${version}" is not plain semver.`);
  process.exit(1);
}
const exeName = `SavdoChef-Setup-${version}.exe`;
const files = {
  exe: path.join('dist', exeName),
  blockmap: path.join('dist', `${exeName}.blockmap`),
  yml: path.join('dist', 'latest.yml'),
};

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function openssh(tool) {
  const windows = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', `${tool}.exe`);
  return process.platform === 'win32' && existsSync(windows) ? windows : tool;
}

function ssh(command, { quiet = false } = {}) {
  const r = spawnSync(openssh('ssh'), ['-o', 'BatchMode=yes', HOST, command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'],
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

function sftp(batch) {
  const r = spawnSync(
    openssh('sftp'),
    ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=20', '-b', '-', HOST],
    { input: batch, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (r.status !== 0) fail('sftp upload failed (see above). Nothing was published.');
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

// ── 1. What was built ──────────────────────────────────────────────────────────────────────
for (const [what, file] of Object.entries(files)) {
  if (!existsSync(file)) fail(`${file} not found (${what}). Run \`npm run deploy:pos\` to build it.`);
}
const yml = readFileSync(files.yml, 'utf8');
if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(yml))
  fail(`dist/latest.yml is not for ${version}; rebuild (npm run deploy:pos).`);
if (!yml.includes(`path: ${exeName}`))
  fail(`dist/latest.yml does not name ${exeName}; check artifactName in electron-builder.config.js.`);
// The sha512 tills will check must be this very file (a stale latest.yml would fail every till).
const sha512 = createHash('sha512').update(readFileSync(files.exe)).digest('base64');
if (!yml.includes(`sha512: ${sha512}`))
  fail(`dist/latest.yml's sha512 does not match ${exeName}; rebuild (npm run deploy:pos).`);
const exeSize = statSync(files.exe).size;
const mb = (exeSize / 1024 / 1024).toFixed(1);
console.log(`SavdoChef ${version}: ${exeName} (${mb} MB) -> ${HOST}:${REMOTE_DIR}`);

// ── 2. The server: reachable, folder there, version not published yet ─────────────────────
const probe = ssh(
  `${dryRun ? 'true' : `mkdir -p ${REMOTE_DIR}`} && ` +
    `if [ -e ${REMOTE_DIR}/${exeName} ]; then echo EXISTS; else echo FREE; fi && ` +
    `(grep -m1 '^version:' ${REMOTE_DIR}/latest.yml 2>/dev/null || echo 'version: none')`,
);
if (!probe.ok) fail(`cannot reach ${HOST} over ssh (is the key loaded in the Windows ssh-agent?).`);
const [slot, liveLine] = probe.out.split('\n');
console.log(`  live now: ${liveLine.replace('version: ', '')}`);
if (slot === 'EXISTS')
  fail(`${exeName} is already on the server. Bump the version (npm run release -- patch) and deploy again.`);

if (dryRun) {
  console.log('\n--dry-run: everything checks out; nothing uploaded.');
  process.exit(0);
}

// ── 3. Upload: installer and blockmap under temporary names, then latest.yml ───────────────
const q = (p) => `"${p.replace(/\\/g, '/')}"`;
sftp(
  [
    `put ${q(files.exe)} ${REMOTE_DIR}/${exeName}.part`,
    `put ${q(files.blockmap)} ${REMOTE_DIR}/${exeName}.blockmap.part`,
    `put ${q(files.yml)} ${REMOTE_DIR}/latest.yml.part`,
    'bye',
    '',
  ].join('\n'),
);

const remoteSize = ssh(`stat -c %s ${REMOTE_DIR}/${exeName}.part`).out;
if (Number(remoteSize) !== exeSize)
  fail(`uploaded size ${remoteSize} != local ${exeSize}; the release was NOT published (.part files left on the server).`);

// The installer first, latest.yml last: this mv is the moment the release goes live.
const publish = ssh(
  `cd ${REMOTE_DIR} && mv -f ${exeName}.part ${exeName} && ` +
    `mv -f ${exeName}.blockmap.part ${exeName}.blockmap && mv -f latest.yml.part latest.yml`,
);
if (!publish.ok) fail('renaming on the server failed; check the folder by hand.');

// ── 4. What tills will see ─────────────────────────────────────────────────────────────────
try {
  const res = await fetchText(`${PUBLIC_URL}latest.yml`);
  const served = /^version:\s*(\S+)/m.exec(res.body)?.[1];
  if (res.status !== 200 || served !== version)
    fail(`the feed answers ${res.status} with version ${served ?? '?'}, expected ${version}.`);
} catch (error) {
  fail(`could not read ${PUBLIC_URL}latest.yml: ${error.message}`);
}

console.log(`\n✔ SavdoChef ${version} is live.`);
console.log(`  feed:     ${PUBLIC_URL}latest.yml`);
console.log(`  download: ${PUBLIC_URL}${exeName}`);
