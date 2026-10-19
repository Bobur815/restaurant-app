/**
 * One-time import of a legacy SavdoChef database into the app's database.
 *
 *   npm run import:legacy -- --legacy <path/to/legacy/app.db> --images <legacy img dir>
 *        [--user-data <dir>]   default: %APPDATA%/SavdoChef (the app's userData)
 *        [--replace]           move the current database (and a copy of its pictures) to
 *                              <userData>/backups/pre-legacy-import-<time>/ first
 *        [--dry-run]           do everything on a temporary copy; change nothing
 *
 * Close SavdoChef first. The legacy file is only read, from a temporary copy.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importLegacy, readLegacy } from '../src/main/database/legacy-import';
import { loadPrismaModule, openDatabase } from '../src/main/database/open';
import { importImage } from '../src/main/images/image-store';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const legacyFile = arg('legacy');
  const legacyImages = arg('images');
  const userData = arg('user-data') ?? path.join(process.env['APPDATA'] ?? os.homedir(), 'SavdoChef');
  const dryRun = flag('dry-run');
  const replace = flag('replace');
  if (!legacyFile || !fs.existsSync(legacyFile)) throw new Error('--legacy <app.db> is required and must exist');

  const root = process.cwd();
  const prismaModule = loadPrismaModule(root);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-import-'));

  // Read the legacy data from a copy: the original file is never opened for writing.
  const legacyCopy = path.join(work, 'legacy.db');
  fs.copyFileSync(legacyFile, legacyCopy);
  const legacy = new prismaModule.PrismaClient({ datasources: { db: { url: `file:${legacyCopy}` } } });
  const data = await readLegacy(legacy);
  await legacy.$disconnect();

  const dbFile = path.join(userData, 'data', 'savdochef.db');
  const imageDir = path.join(userData, 'img');

  let target = dbFile;
  if (dryRun) {
    // Simulate on a scratch database (a fresh one for --replace, else a copy of the current one).
    target = path.join(work, 'target.db');
    if (!replace && fs.existsSync(dbFile)) fs.copyFileSync(dbFile, target);
  } else if (replace && fs.existsSync(dbFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(userData, 'backups', `pre-legacy-import-${stamp}`);
    fs.mkdirSync(backup, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbFile + suffix)) fs.renameSync(dbFile + suffix, path.join(backup, `savdochef.db${suffix}`));
    }
    if (fs.existsSync(imageDir)) fs.cpSync(imageDir, path.join(backup, 'img'), { recursive: true });
    console.log(`Backed up the current database and pictures to ${backup}`);
  }

  const { prisma } = await openDatabase(target, { prismaModule, backupDir: path.join(userData, 'backups') });
  try {
    const report = await importLegacy(prisma, data, {
      dryRun,
      copyImage: (name) => {
        const source = legacyImages ? path.join(legacyImages, name) : null;
        if (!source || !fs.existsSync(source)) return null;
        return importImage(source, imageDir);
      },
    });
    console.log(JSON.stringify(report, null, 2));
    console.log(dryRun ? 'Dry run: nothing was changed.' : `Imported into ${target}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
