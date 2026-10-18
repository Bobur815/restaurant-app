# SavdoChef

> **Rewrite in progress (branch `rewrite/ts-ipc`, plan in `tasks/todo.md`).** The root is now the new TypeScript + electron-vite app (`src/`, `npm run dev`, `npm run check`). Everything below describes the **legacy** app, which now lives in `legacy/` (run it with `npm --prefix legacy start`; paths below are relative to `legacy/`). Use it as the behavior reference (`tasks/inventory.md`); don't extend it. This file gets rewritten in Phase 9.

Offline restaurant CRM + POS for small cafes/eateries (Uzbek market). Electron desktop app that embeds an Express + Prisma + SQLite API in the main process. Single machine, no cloud, no internet required.

Plain JavaScript, ES modules everywhere (`"type": "module"`). **No TypeScript, no tests, no linter.** Do not introduce TS, a bundler, or a framework unless asked.

## Commands

Two separate `package.json` files; install both.

```bash
npm install && npm --prefix backend install

npm run dev          # nodemon + electron (watches js/html/css)
npm start            # electron-forge start
npm run package      # prisma generate + forge package
npm run make:win     # prisma generate + Windows x64 zip (Squirrel is disabled)

npm --prefix backend run generate        # prisma generate
npm --prefix backend run migrate:dev     # create + apply migration (dev)
npm --prefix backend run migrate:deploy  # apply existing migrations
```

Backend alone (no Electron): `cd backend && DATABASE_URL="file:./data/app.db" node server.js` (SQLite path is relative to `prisma/`). Listens on `127.0.0.1:3000`.

There is no test/lint/typecheck. Verify changes by running the app or hitting the API with curl, and say what you actually ran.

## Architecture

```
main.js              Electron main: boots backend inline, IPC handlers, window lifecycle
preload.js           contextBridge -> window.electronAPI (only renderer<->main channel)
printing.js          Receipt HTML builder + silent print via IPC 'print-receipt'
*.page.js, *-window.js   BrowserWindow factories (login, main, category, session)
html/ css/ renderer/ Renderer pages (one HTML per window), page scripts as ES modules
utils/               Renderer-side helpers (alert, payStatuses, paymentMethods, ...)
backend/             Express 5 API + Prisma (SQLite)
```

Startup flow (`main.js`): `ensureDatabaseUrl()` sets `DATABASE_URL` to `<userData>/data/app.db` (copied from the seed `backend/prisma/data/app.db` only if missing) -> `import()` of `backend/server.js` inside the Electron main process -> wait for `/api/setup/status` -> if setup incomplete open `setup.html`, else login window.

Backend layering (keep it): `router/*.js` -> `controller/*.js` (class, `try/catch -> next(error)`) -> `service/*.js` (singleton `export default new (class ...)`, all Prisma access) -> `database/prisma.js`. Routers are registered in `router/index.routers.js` as `{ url, funk }` and mounted under `/api`. Validation is Joi in `utils/Joi.validation.js`; errors go through `CustomError` and `middleware/ErrorHandler.js`.

The renderer talks to the API with `fetch('http://localhost:3000/api/...')` and to the main process only through `window.electronAPI`. Windows are separate `BrowserWindow`s; child -> parent refresh uses IPC events (`session-updated`, `menu-updated` -> `reload-menu`).

## Domain model (backend/prisma/schema.prisma)

- **Menu / Category**: dishes; `portions` (allowed factors 1, 0.7, 0.5) and `soldByWeight` change quantity math.
- **Order / OrderItem**: one pending order per table; `orderNumber` is `YYYY-00007` from `Counter` (`nextSeqTx` inside a transaction).
- **Payment**: `cash | card | click | debt`; status `paid | pending | refunded`.
- **Session / SessionItem**: a trading day with per-dish `initialQuantity` / `soldQuantity`; remaining = initial - sold (computed, not stored). `Session.service` checks for an existing `open` session before creating one, and `recordSale` targets the open session.
- **Residual / Expense**: leftover stock at session close, `CARRY_TO_NEXT` or `WRITE_OFF`; a `Residual` can link to an `Expense` via `expenseId`.
- **User / Permission**: `ADMIN | STAFF`. **Setting**: key/value JSON (`setup_complete`). **RecieptSettings**: receipt layout singleton (`slug = "default"`).

Money and quantities are Prisma `Decimal`; convert with `Number()` and round with `roundN` (default 2 dp). Currency UZS, locale `uz-UZ`.

## Conventions

- UI text and user-facing API messages are Uzbek (Latin script). Code identifiers are English. Keep existing Uzbek strings; add new ones in the same language.
- Match the surrounding file style (mixed quotes/semicolons already exist; don't reformat unrelated code).
- Do not add `fetch` calls to hardcoded hosts other than `localhost:3000`.
- Never enable `nodeIntegration`; keep `contextIsolation: true`. New renderer capabilities go through `preload.js` + `ipcMain` in `main.js`.

## Known traps (verified in code)

1. **Dead legacy code**: `backend/models/*.js` are old Mongoose models, not imported anywhere, and `mongoose` is not a dependency. `backend/middleware/SetupGate.js` is unused and broken (`prisma.settings`, `Settings.updateOne`). Don't import or "fix" them; delete only if asked.
2. **Passwords are plaintext**: `Auth.service.js` compares `===` and `routes/setup.js` stores the raw password. There is no auth middleware on the API. Don't copy this pattern; if asked to fix, plan a migration for existing users (hash on next login).
3. **Error status bug**: `CustomError` sets `statusCode`, but `ErrorHandler` responds with `err.status || 500`, so thrown `CustomError(…, 400)` still returns 500. Set both fields or fix the handler (check the frontend for dependence first).
4. **Schema changes don't reach existing installs**: the seed DB is copied only on first run and `migrate deploy` is not called at startup (commented out in `server.js`). Any migration needs a story for already-installed databases.
5. **Tracked SQLite files**: `backend/prisma/data/app.db` (seed) and `backend/prisma/savdochef.db` are committed. Never edit them by hand or commit a DB containing real customer data.
6. **Health probe mismatch**: `server.js` exposes `/api/health`, but `waitForApi` in `main.js` probes `/health` (404) then `/api/setup/status`. Startup works only because of the second probe.
7. **`preload.js` uses `require`** while the package is `"type": "module"`; it works as a sandboxed preload. Don't convert to `import` without testing a packaged build.
8. **Packaging**: backend is shipped via `extraResource` + `asarUnpack` (Prisma needs unpacked binaries); `main.js` prefers `backend/dist/main.js` if it exists, but no build step produces it. Forge references `build/brand_logo.png`, which isn't in the repo. Winston logs to `process.cwd()/utils/errors.log`, which may be unwritable in a packaged app.
9. `Reciept` (sic) is used consistently in the model, routes, services and controllers. Keep the spelling; renaming needs a migration plus route changes in the renderer.

## When making changes

- Schema change: use `/schema-change`. New API route: use `/new-endpoint`. New renderer-to-main call: use `/add-ipc`.
- Before finishing a backend change, check that the Prisma query shape matches `schema.prisma` (field names are camelCase, e.g. `tableNumber`, not `table_number`).
- Stock logic (`Order.service.js` `effQty`, `Session.service.js` `recordSale`) affects real money and inventory; read both fully before editing and describe the before/after behavior in your summary.
