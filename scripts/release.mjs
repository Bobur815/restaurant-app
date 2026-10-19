/**
 * Builds a release installer for manual distribution (no auto-updater: tills are offline and the
 * repo is private, decided 2026-10-19).
 *
 *   node scripts/release.mjs patch|minor|major
 *
 * Version rule:
 *   patch  fixes only, no database migration
 *   minor  new features, or any database migration (always additive; the app backs the database
 *          up before migrating, and an older build refuses a newer schema)
 *   major  a change a till operator must be told about before installing (new workflow, a step
 *          that cannot be undone)
 *
 * Steps: refuse a dirty tree -> `npm run check` -> bump version (commit + tag vX.Y.Z) -> build the
 * Windows installer -> write SHA-256 next to it in release/. Pushing is left to you.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: node scripts/release.mjs patch|minor|major');
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

if (out('git status --porcelain')) {
  console.error('Working tree is not clean; commit or stash first.');
  process.exit(1);
}

run('npm run check');
run(`npm version ${bump} -m "release: v%s"`);
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

run('npm run dist:win');

const name = `SavdoChef-Setup-${version}.exe`;
const releaseDir = path.join('release', `v${version}`);
fs.mkdirSync(releaseDir, { recursive: true });
fs.copyFileSync(path.join('dist', name), path.join(releaseDir, name));
const sha = createHash('sha256')
  .update(fs.readFileSync(path.join(releaseDir, name)))
  .digest('hex');
fs.writeFileSync(path.join(releaseDir, `${name}.sha256`), `${sha}  ${name}\n`);

console.log(`\n${releaseDir}/${name}\nsha256 ${sha}\nPush when ready: git push && git push --tags`);
