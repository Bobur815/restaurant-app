# SavdoChef

Offline POS for small cafes and eateries (Uzbek market): tables, orders, payments, daily shifts with per-dish stock, leftovers, receipts, reports. One Windows till, no cloud, no internet. Electron + TypeScript, SQLite through Prisma, vanilla DOM renderer (no React, no UI framework). UI in Uzbek (Latin) and Russian.

Architecture follows posgro (`C:\Users\user\posgro`) without React. The old Express + JS app is gone from the tree; it lives in tag `legacy-js-express` and is the behaviour reference (`tasks/inventory.md`). Don't restore it.

## Commands

```bash
npm install            # also runs prisma generate (src/generated/ is gitignored)
npm run dev            # electron-vite dev (HMR renderer, restarts main)
npm run check          # typecheck (node + web) + eslint + jest. Run before saying "done".
npm run format         # prettier on src/**/*.{ts,css,html,json}; format:check in CI style
npm test -- <pattern>  # one suite, e.g. npm test -- printing
npm run build          # prisma generate + electron-vite build (dist-electron/, dist-renderer/)
npm run dist:win       # build + NSIS installer -> dist/SavdoChef-Setup-<version>.exe
npm run release -- patch|minor|major   # check, version + tag, installer + sha256 in release/
npm run deploy:pos     # installer + upload to the update feed panel.posgro.uz/releases/savdochef/ (outward-facing: only when asked)
npm run build:icons    # regenerate build/icons + favicon from src/shared/branding/brand.ts
npm run import:legacy  # legacy database -> new database (usage in scripts/import-legacy.ts header)
```

Verify UI changes in the real app, not only with tests: `npm run build`, then an Electron harness script (pattern in `tasks/lessons.md`) against a **copy** of the data in a scratch `userData`. Say what you actually ran.

## Architecture

```
src/shared/     types, zod schemas, IPC channel map, api client, formatting, Decimal helpers, branding
src/main/       Electron main: database, domain modules, IPC, printing, images, logger, window
  database/     open.ts (Electron-free), migrate.ts, migrations/NNNN_*.ts, seed.ts, legacy-import.ts
  domain/       db.ts (Db type), errors.ts (AppError + codes)
  ipc/          handlers.ts (channel -> access + schema + domain call), ipc-safe.ts, events.ts, register.ts
  <domain>/     auth, users, menu, orders, payments, sessions, residuals, reports, settings, printing
  preload.ts    contextBridge -> window.electronAPI built from the channel list (preload-api.ts)
src/renderer/   index.html (CSP), main.ts (routes), api/ (only user of electronAPI), router/, store/,
                ui/html.ts (escaping template), components/, layout/, views/<area>/, i18n/locales/{uz,ru}.json
prisma/schema.sqlite.prisma   the schema; the app never runs prisma migrate
scripts/        build-icons.mjs, import-legacy.ts, release.mjs
```

**IPC chain** (one per feature, no shortcuts): zod schema in `shared/schemas.ts` → channel in `shared/ipc.ts` (`IpcChannels` + `IPC_CHANNELS`) → `main/ipc/handlers.ts` entry with access `pub`/`user`/`admin` → domain function `(db, actor, input)` in `main/<domain>/` → `invokeHandler` (`ipc-safe.ts`) checks the session user and role in main, parses input, maps errors to codes → preload exposes `api.<ns>.<method>` automatically → renderer calls `api.<ns>.<method>()` from `@renderer/api` (returns data or throws `ApiError`). Every channel is either in `READ_ONLY_CHANNELS` or says which change event it emits (`events.ts`); views subscribe with `api.events.subscribe`. Compile-time maps and tests fail if a channel is missing anywhere.

**Database:** SQLite file in `%APPDATA%\SavdoChef\data\savdochef.db` (WAL). On every start `openDatabase` runs pending migrations from `src/main/database/migrations/` (tracked by `PRAGMA user_version`), after a `VACUUM INTO` backup in `backups/` (10 kept). A newer database than the build is refused. `database.test.ts` fails if migrations and `schema.sqlite.prisma` drift, and prints the SQL for the next migration.

**Domain:** dishes (`portions` 1 / 0.7 / 0.5, `soldByWeight`), one pending order per table (DB trigger), order number `YYYY-00007`, payments `cash | card | click | debt`, one open shift (DB trigger) with per-dish initial/sold quantity, leftovers carried or written off at close and applied when the next shift opens, receipt settings singleton, users `ADMIN | STAFF` with bcrypt passwords and optional 4-digit PIN (lock screen).

**Printing:** main builds the receipt HTML from the database (`main/printing/receipt.ts`, escaped, own CSP) and silent-prints it from a hidden sandboxed window without preload; the renderer only sends an order id. Preview = PNG of the same document.

**Updates:** electron-updater (generic feed `https://panel.posgro.uz/releases/savdochef/`, served from `/home/bobur/releases/savdochef/` on `posgro-vps`). `main/updater/updater.ts` is the only owner: one quiet check after start, download and install only from Settings → Dastur yangilanishi (`settings` permission). `npm run deploy:pos` publishes; a version already on the server is refused. Only the packaged Windows build updates (dev = `unsupported`).

## Hard rules

- **Money and quantities are `Decimal`** end to end (`decimal.js` / `Prisma.Decimal`), strings across IPC (`shared/utils/decimal.ts`). No float math, no `Number()` on money except for display/charts.
- **Database changes are additive** (new table, nullable or defaulted column, index, trigger) and go through skill `prisma-migration`. Never edit or reorder a released migration. Never edit `.db` files by hand.
- **Back up before any data operation** on a real database (import, repair, manual SQL): copy the file first. Real data lives in `%APPDATA%\SavdoChef`; tests and harnesses use a scratch `userData`. Never commit a database.
- **Security model:** access is checked in main on every call; UI hiding is cosmetic. `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`, no new `webPreferences` holes, CSP in `index.html` stays strict. The renderer never passes file paths, URLs or HTML to main. No password/PIN hash ever leaves main (`secrets.test.ts`).
- **Renderer DOM:** build markup with `html\`...\`` (escapes everything) or `textContent`; `innerHTML` is lint-blocked. `raw()` only for markup the code itself wrote.
- **Text:** every UI string in both `uz.json` and `ru.json`. User-facing errors from main are Uzbek. Code and logs English. Format numbers/dates with `shared/utils/format.ts` (Electron's ICU has no Uzbek; don't use `Intl`/`toLocaleString` for uz).
- **Dependencies:** exact versions, released at least two weeks ago. Main-process deps are bundled by electron-vite; anything native or loaded by path needs `asarUnpack`/`files` in `electron-builder.config.js`.
- **Git:** work on `rewrite/ts-ipc` (or a feature branch). Commit only when asked, push only when asked. Commit messages end with the `Co-Authored-By` line.

## Workflow

- Non-trivial work: `/plan` first (questions, then checkable items in `tasks/todo.md`), wait for approval.
- New feature over IPC: skill `ipc-feature`. Schema change: skill `prisma-migration`, then agent `migration-reviewer`. Main/preload/renderer security-relevant edits: agent `electron-security-reviewer`. Domain logic touching stock, orders or money: agent `prisma-reviewer`.
- Before finishing: `/check`. When corrected or when something surprising bites, add a line to `tasks/lessons.md`.
- Stock and money logic (`orders/`, `payments/`, `sessions/`, `residuals/`, `shared/utils/order-line.ts`): read the module and its tests fully before editing and describe before/after behaviour in the summary.
