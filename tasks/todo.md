# SavdoChef → posgro architecture, without React

Goal: rebuild SavdoChef (restaurant POS) on the same foundations as posgro (TypeScript, electron-vite, Prisma + SQLite, typed IPC, tests, electron-builder, `.claude/` setup), with a **framework-free renderer** (no React, styled-components, zustand, react-router, react-i18next, recharts, lucide-react).

## Decision: backend = Electron IPC (not embedded Express)

posgro's POS terminal does not run an HTTP server for its own UI. The chain is `renderer → api client → preload (window.electronAPI) → src/main/ipc/*-handlers.ts → SQLite`. Its only HTTP pieces are the cloud NestJS API (VPS) and a small optional `local-server` for LAN terminals. SavdoChef is a single-machine, offline app, so it should use the IPC chain.

| | Embedded Express (current) | Electron IPC (target) |
|---|---|---|
| Network surface | TCP port 3000 on localhost, no auth, `cors({ origin: true })`: any local page/process can call it | None. Only the app's own windows, via `contextBridge` |
| Port conflicts | Hard-coded 3000 in `main.js` and ~10 renderer files | Not applicable |
| Types end to end | None (JSON over fetch) | One shared channel map in `src/shared`, compile-checked on both sides |
| Auth/roles | None today | Enforced in the main-process handler (`getCurrentUser()`), as in posgro |
| Startup | Boot server, poll `/api/setup/status`, 15 s timeouts | `initializeDatabase()` then open the window |
| Error handling | `CustomError` status bug, HTTP codes | Typed result via `ipcSafe()`, no status codes |
| Packaging | Ships `backend/` as extraResource + asarUnpack | Bundled by electron-vite into `dist-electron/main` |
| Multi-device (waiter phones, kitchen screen) | Possible | Needs a LAN server later (see Phase 10) |

Rules that make this safe to grow:

- Business logic lives in plain TS modules in `src/main/<domain>/` that take a Prisma client and return plain data. IPC handlers are thin: validate, check role, call the module, `ipcSafe()`.
- If LAN access is ever needed, add an HTTP adapter that calls the **same** modules (posgro's `local-server` pattern). Don't duplicate logic.
- No NestJS inside Electron. NestJS only makes sense later as a cloud/sync server, if ever.

## Target stack

| Concern | Now | Target (posgro-equivalent) |
|---|---|---|
| Language | JS (ESM) | TypeScript, `strict` |
| Build | none / forge | electron-vite (main, preload, renderer) |
| Backend | Express 5 in main process | IPC handlers + domain modules |
| DB | Prisma 6 + SQLite, ad-hoc | Prisma + SQLite, `schema.sqlite.prisma`, generated client in `src/generated/` (gitignored), in-place idempotent upgrades |
| Validation | Joi | zod (as in posgro) at the IPC boundary |
| Passwords | plaintext | bcryptjs |
| Renderer | multi-page HTML + scripts | single window, hash router, vanilla TS |
| State | globals/DOM | small typed store module (~50 lines) |
| Styling | Bootstrap + per-page CSS | CSS files with design tokens (custom properties), light/dark |
| i18n | hard-coded Uzbek | i18next core (framework-free), `uz.json` + `ru.json` |
| Charts | none | Chart.js (or uPlot) |
| Icons | none | `lucide` (static, framework-free) |
| Tests | none | jest, same setup as posgro; in-memory/temp SQLite for module tests |
| Lint/format | none | eslint + prettier, same config as posgro |
| Packaging | forge, zip only | electron-builder + electron-updater, NSIS installer |

## Target layout

```
src/
  main/
    index.ts                 app lifecycle, windows
    preload.ts               window.electronAPI (namespaced, typed)
    window.ts
    database/                sqlite-client.ts, migrations.ts, seed.ts
    ipc/                     handlers.ts + <domain>-handlers.ts, ipc-safe.ts
    auth/  menu/  orders/  payments/  sessions/  residuals/  expenses/  reports/  settings/
    printing/                receipt HTML builder + silent print
    logger.ts                electron-log
  shared/
    ipc.ts                   channel map: name -> { args, result }
    types/  constants/  utils/   (money, rounding, portions)
  renderer/
    index.html
    main.ts                  boot, router, i18n
    api/                     typed wrappers over window.electronAPI
    store/                   session user, cart, open session
    views/                   login, setup, tables, order, menu, sessions, checks, reports, settings
    components/              alert, confirm, modal, table, receipt-preview
    ui/                      html`` helper (auto-escaping), dom helpers
    styles/                  tokens.css, base.css, views/*.css
    i18n/locales/            uz.json, ru.json
prisma/
  schema.sqlite.prisma
  seed/
tests/ (or colocated *.test.ts)
.claude/  CLAUDE.md  tasks/
```

## Phase 0: before touching code

- [x] Decide: is any SavdoChef install live? **No** (2026-10-18). No importer, no upgrade-from-legacy test. In-place additive migrations are still needed for future versions of the new app.
- [x] Tag the current state `legacy-js-express` and keep the branch. Work on `rewrite/ts-ipc`. (local `main` was 7 commits behind `origin/main`; fast-forwarded first, tag at `46542d8`; tag not pushed yet)
- [x] Remove tracked DBs from git (`backend/prisma/data/app.db`, `backend/prisma/savdochef.db`), add `*.db`, `*.db-journal` to `.gitignore`. Untracked (staged, not committed). **Found:** `app.db` holds real-looking data (restaurant "Shoxona", address, phone, 9 orders, plaintext admin password) and the GitHub repo is public. It is in history since `4bb70f4`.
  - [x] Purged `backend/prisma/data/app.db` from all history with `git filter-repo` and force-pushed `main` (`46542d8` → `c0ded87`, tree otherwise identical). Repo is private again. Other clones made before 2026-10-18 still hold the old history; re-clone them.
- [x] `git rm --cached .claude/settings.local.json` and gitignore it.
- [x] Write the feature inventory from the existing code → `tasks/inventory.md` (includes 10 legacy stock/consistency quirks to characterize in Phase 3).

## Phase 1: foundation

- [x] Scaffold electron-vite + TypeScript (`strict` + `noUncheckedIndexedAccess`, aliases `@main`/`@renderer`/`@shared`), no React. Two tsconfigs: `tsconfig.node.json` (main/preload/shared, no DOM) and `tsconfig.web.json` (renderer/shared, no Node types). Legacy app moved to `legacy/` (`git mv`, still runnable with its own `package.json`). Versions: Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6 (posgro's Electron 40 / Vite 5 have high-severity advisories; Vite 7 also removes posgro's `as any` config cast).
- [x] Copy eslint + prettier config from posgro, remove react rules/plugins. Added renderer rules: no `innerHTML`/`outerHTML`/`insertAdjacentHTML`, no `electron`/Node/`@main` imports.
- [x] jest 30 + ts-jest; `src/main/security.test.ts` (navigation policy). `npm run check` = typecheck + lint + test, green locally. `.github/workflows/ci.yml` also runs `format:check`. (CI not yet observed on GitHub: needs a push.)
- [x] Security baseline: one `createWindow()` (`src/main/window.ts`) with fixed webPreferences (`sandbox: true`, `contextIsolation`, no node, devTools off when packaged); `src/main/security.ts` blocks navigation outside the app, `window.open`, `<webview>`, permission prompts; single-instance lock. Verified on the built app: no `require`/`process` in renderer, navigation to an external URL blocked.
- [x] CSP in `src/renderer/index.html` (`default-src 'none'`, no `unsafe-inline`/`unsafe-eval`); verified an injected inline script is blocked. Dev server only adds the HMR websocket + inline styles (`devCsp` plugin, `serve` only). CSS is loaded via `<link>`, not JS imports, so it needs no inline styles.
- [x] Electron fuses in `electron-builder.config.js` (RunAsNode, NODE_OPTIONS, inspect off; asar integrity; only load from asar). Not yet exercised: `npm run dist:win` waits for icons (Phase 8) and Prisma (Phase 2).

## Phase 2: database

- [x] Schema ported to `prisma/schema.sqlite.prisma` (Prisma **6.19.3**; 7.x needs a better-sqlite3 driver adapter, a native module rebuilt per Electron version). Client generated to `src/generated/prisma-sqlite` (gitignored, `postinstall`), loaded at runtime from `app.getAppPath()` (`database/open.ts`, posgro pattern). Verified in a packaged `--dir` build: engine loads from `app.asar.unpacked`.
- [x] `RecieptSettings` → `ReceiptSettings` (singleton row id 1). Model/table names now `MenuItem`/`menu_items` etc.; `nameUz` + `nameRu` on categories and menu items; `imageFile` (file name only, no paths).
- [x] Money: **keep `Decimal`** (decided 2026-10-18). `src/shared/utils/decimal.ts` (decimal.js): strict parsing, money 2 dp / quantities 3 dp, ROUND_HALF_UP, strings over IPC; tested.
- [x] Upgrades in place: numbered migrations in `src/main/database/migrations/` (0001 generated by `prisma migrate diff`), tracked with `PRAGMA user_version`, each in one transaction; `VACUUM INTO` backup (newest 10 kept in `userData/backups`) before upgrading an existing DB; a DB from a newer app is refused. `database.test.ts` builds a DB from the migrations and asserts **no drift** vs the Prisma schema, printing the SQL for the next migration (checked by adding a field: it prints the `ALTER TABLE`). Replaces posgro's regex-based column test.
- [x] Seed in code (`database/seed.ts`), every start, never overwrites: settings defaults (`setup_complete`, `table_count` (was localStorage), `language`, `theme`, `click_sound`, `lan_enabled`), `orders` counter; legacy default categories (uz + ru) on a fresh DB only. Receipt settings row is created by the setup wizard (Phase 3), not the seed.
- [x] One-time importer from the old `app.db` (asked for after all, 2026-10-19): `src/main/database/legacy-import.ts` (tested), CLI `npm run import:legacy -- --legacy <app.db> --images <img dir> [--replace] [--dry-run]`. Rehashes passwords, keeps recorded money as-is, assigns orders to the shift that contains them, computes stock use, copies pictures, all in one transaction, refuses a non-empty target.
  - Ran 2026-10-19 on this machine (`--replace`): previous database + pictures moved to `%APPDATA%/SavdoChef/backups/pre-legacy-import-2026-10-19T08-47-32-652Z/`; imported 10 dishes (+10 pictures), 1 admin, 1 shift, 9 orders / 18 lines, 8 payments (401 000), 6 pending carried leftovers, receipt settings. Verified independently (counts, sums, FK and integrity checks) and in the built app.
- [x] Constraints, enforced by SQLite (tests in `database.test.ts`):
  - one open session: `sessions.openGuard` (1 while open, NULL when closed, UNIQUE);
  - one pending order per table: `orders.pendingTable` (same trick; matters once phones write too);
  - residuals unique per `(sessionId, menuItemId, action)` (fixes legacy quirk 5; regression test);
  - FKs: order items cascade with their order; payments, sessions with history, and menu items in use are `Restrict` (menu items soft-delete via `isActive`). Expense ↔ residual is 1:1.
  - `openGuard` is maintained by SQLite triggers from `status` (migration 0002, tested: close releases it, reopening while another shift is open is refused, direct writes cannot drop it). Code never writes `openGuard`; create sessions as `open`.
  - Phase 3 must still clear `orders.pendingTable` when an order leaves `pending` (or get the same trigger treatment).
- [x] Also added for later phases: `OrderItem.stockQuantity` (stock taken by the line, so update/cancel give back exactly that: fixes quirk 1 by design), `Order.sessionId`, `Order.version` (optimistic locking, Phase 8.5), `createdById`/`openedById` audit columns, `User.passwordHash`/`failedLoginCount`/`lockedUntil`. Dropped the unused legacy `Permission` table.
- [x] Startup: DB opens before any window; failure shows an Uzbek error dialog with the file path and exits. Hardware acceleration disabled (as posgro): first paint went from ~19 s to ~1 s on this machine.

## Phase 3: domain modules + IPC (backend)

Done 2026-10-18. Domain modules in `src/main/<domain>/` take `(db, actor, input)` and return DTOs (`src/shared/types.ts`, money as decimal strings); inputs are zod schemas in `src/shared/schemas.ts`; every channel is in `src/shared/ipc.ts` and implemented in `src/main/ipc/handlers.ts` (a missing channel fails to compile). 180 tests.

- [x] `auth`: bcrypt (cost 10), lock for 5 min after 5 wrong passwords, same answer and timing for unknown user / wrong password, inactive refused after the password check. Login is **per caller** (per window now, per device token in 8.5); every non-public call re-reads the user, so deactivation and role changes apply on the next action.
- [x] `users`: list/create/update/reset password (admin), own profile + password (user); the last active admin cannot be demoted or deactivated, nobody deactivates themselves. Plaintext never stored or returned.
- [x] `settings` + `setup`: typed settings over the key/value table (corrupt value -> default); receipt settings; first-run wizard in one transaction, public only until an admin exists.
- [x] `menu` + `category`: CRUD, unique names -> CONFLICT, search across uz/ru ignoring case and apostrophe variants; dishes with history are hidden, not deleted; switching pieces/portions/kg refused while in the open shift or an unpaid order. Images: picked by a dialog in main, checked by magic bytes and size, stored as `<random>.jpg|png|webp` in `userData/img`, served by `savdochef-img://img/<name>` with a containment check (CSP allows it).
- [x] `sessions`: open (one only, DB-enforced), edit (not below sold), close in one transaction with carry / write-off, pending carry list for pre-fill, delete only when unused.
- [x] `orders`: server-side pricing from the menu (`shared/utils/order-line.ts`, tested), stock deltas applied in the same transaction, all-or-nothing with every shortage listed, optimistic `version` check, `YYYY-NNNNN` numbers from the counter in the transaction. Migration 0003: `orders.pendingTable` kept by triggers (one unpaid order per table, released on pay/cancel); two devices creating the same table: one wins, one CONFLICT (tested).
- [x] `payments`: pay in full in one transaction (debt -> `pending`, legacy parity), checks list with legacy filters/sorting, admin edit/delete.
- [x] `residuals` + `expenses`: legacy filters, pagination, totals; note search works on SQLite.
- [x] `reports`: per-day payments by method + expenses by type; dishes per day with legacy unit counts plus stock used and revenue. Rows selected by range in SQL, summed in main with exact decimals (SQLite sums DECIMAL as float).
- [x] `ipcSafe` (`main/ipc/ipc-safe.ts`): access `public`/`user`/`admin`, zod parse, error codes `NOT_AUTHENTICATED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `LOCKED`, `INTERNAL` (unexpected errors logged in main, never sent). Access list is snapshot-tested; every protected channel is tested against an anonymous caller and every admin channel against STAFF.
- [x] Behaviour changes vs legacy (all deliberate, each tested):
  - stock: one formula for create/edit/cancel; stock + order + payment in one transaction (quirks 1, 2);
  - totals computed on the server, client prices ignored (quirk 3);
  - shift close in one transaction; refused while unpaid orders exist; an unassigned leftover carries over instead of vanishing;
  - cancelled orders are kept as `cancelled` (legacy deleted them; order numbers are never reused);
  - pending carry is returned with exact quantities (legacy UI pre-filled `quantity - 1`);
  - reports add `stockQuantity` and `revenue` per dish (quirk 7); note search fixed (quirk 6).
- [x] Decided 2026-10-18:
  - deleting a check cancels its order (`checks:delete` -> `cancelPaidOrder`): payments removed, order `cancelled`, stock back to the shift only while that shift is open (closed shifts stay final); unpaid orders are cancelled from the table (fixes quirk 9);
  - optional `MenuItem.costPrice` (migration 0004, nullable); write-offs use it, else the sale price;
  - opening a shift keeps applying all pending carries, whatever dishes the new shift lists (legacy parity).
- [ ] Not yet: `waste`/`breakage` expenses can only be listed (legacy had no UI to add them either); orphaned image files are not cleaned up when a dish's picture changes.


## Phase 4: preload and typed API client

Done 2026-10-18. Verified in the built app: `window.electronAPI` has only the channel namespaces + `events`; an anonymous protected call returns NOT_AUTHENTICATED; setup broadcasts `settings-changed` + `users-changed` to the page; login sticks to the window.

- [x] `shared/ipc.ts`: channel map (input/result types) + runtime `IPC_CHANNELS`; the compiler rejects a list that misses a channel (checked by removing one: TS2322 names it). `ElectronAPI` / `ApiClient` types are derived from the map (`'orders:save'` -> `api.orders.save(input)`).
- [x] `preload.ts` -> `createElectronApi(ipcRenderer)` (`main/preload-api.ts`, tested): one function per channel invoking exactly that channel with one argument; no raw `ipcRenderer`/`invoke`/`send`; `events.subscribe()` returns an idempotent unsubscribe and drops malformed events.
- [x] `renderer/api`: `api` from `createApiClient` (`shared/api-client.ts`, tested): resolves to data or throws `ApiError { code, message, details, channel }`; `onApiError()` hook for global handling (NOT_AUTHENTICATED -> login in Phase 5). Lint forbids `window.electronAPI` outside `src/renderer/api`.
- [x] One `app:event` broadcast replaces `session-updated` / `menu-updated` / `reload-menu`: `main/ipc/events.ts` declares what each successful change announces (`orders-changed` with table, `session-changed`, `menu-changed`, `settings-changed`, `users-changed`); a test requires every channel to be read-only or declare its events.


## Phase 5: renderer without React

### 5a: foundation + core POS flow (done 2026-10-18)

Verified by driving the built app at 1366x768 and 1280x720 (screenshots): setup (incl. password mismatch on the form), tables without/with a shift, order with plain/portion/weight dishes, save, pay with change, cancel guard, theme and language switch, logout. A dish named `<img src=x onerror=...>` renders as text.

- [x] Single window, hash router (`renderer/router`): route table, guard by setup/login/role (`routes.ts`, tested), views `(ctx) => { el, destroy, canLeave }`, shell kept across shell routes; `canLeave` vetoes navigation (unsaved order).
- [x] `ui/html.ts`: escapes every interpolation, quoted attributes only, no `on*` interpolation, `javascript:` URLs neutralised, nodes/arrays slotted; the only `innerHTML` in the renderer (lint). Tests include a bug found by the UI run (quote state across chunks) and listener preservation.
- [x] `store/`: `createStore` (get/set/subscribe); `appStore` with setup, user, settings, receipt, open shift, per-machine language/theme (localStorage, defaults from shop settings).
- [x] Styling: Bootstrap gone; `tokens.css` (light/dark, manual toggle system/light/dark), `components.css`, `layout.css`, `views.css`; icon-only sidebar at <=1300 px.
- [x] i18n: i18next core, `uz.json` + `ru.json` (key parity tested); dish/category names via `localName` (ru falls back to uz). Numbers and dates are formatted by our own code: Electron's ICU has no Uzbek data (showed "5,000" and "Sun").
- [x] Views: setup, login, tables (busy/free, no-shift banner), order (lines with steppers, portion select, weight modal with kg <-> unit price, dish cards with live availability, search + Enter to add, save/pay/cancel, stale-version banner when another device edits, leave guard), payment modal (method, cash received -> change, debt note).
- [x] Components: `<dialog>` modal (focus in/out, Escape, busy state; tested), confirm, toasts, form field errors from VALIDATION paths.
- [x] UX from legacy: click sound (setting), keyboard quantity entry, weight entry, portion selector.
- [x] Every API failure: NOT_AUTHENTICATED anywhere returns to login; change events refresh settings, open shift, current user, tables, the open order.

### 5b: remaining screens (done 2026-10-18)

Verified by a second UI harness on the built app (fresh DB, 1366x768 and 1280x720, screenshots): dish modal, menu, open shift via modal, checks + details, close refused while a table is unpaid, close with linked carry/write-off (17,5 -> write off 2 -> carry 15,5), next shift pre-filled with exactly 15,5, reports (all tabs, chart over 7 days), users, settings, profile, STAFF sees only Buyurtma/Smenalar/Cheklar and is bounced from /reports.

- [x] Shifts: open (all dishes, pre-filled from pending carry, exact), edit (not below sold, cannot remove), close with carry/write-off kept in step + bulk buttons + notes, history with details, admin delete of unused shifts.
- [x] Menu + categories (admin): categories list with counts, create/edit/delete; dishes table with search and hidden toggle; dish modal with uz/ru names, category, sale type (piece/portion/kg), price, cost price, picture via main-process dialog; delete hides dishes with history.
- [x] Checks: date range (default today), method/status/table filters, sort, totals; details modal (lines, payments); admin edit and delete (cancels the order).
- [x] Reports (admin): range presets, KPI tiles, stacked daily revenue chart by method (Chart.js, dataviz spec: palette validated in both themes on our surfaces, <=24px columns, rounded top segment, 2px surface gap, legend, cap totals, tooltip; daily table is the table view), dishes over the range, residuals and expenses tabs with filters/totals/paging.
- [x] Users (admin): list, create, edit role/active, reset password. Profile (everyone, from the user chip): login name, full name, password.
- [x] Settings (admin): table count, default language/theme, click sound; receipt layout fields. Printer is a text field until Phase 7.
- [x] Polish found by the runs: decimal comma in editable fields, Chromium UI locale `ru` for day-first native date inputs (Chromium has no Uzbek locale), chart tooltip dates, form button layout.
- [ ] Not done: per-day dish breakdown (legacy showed dishes per day; the range total is shown), waste/breakage expense entry (no legacy UI either), reprint from checks (done in Phase 7).

## Phase 6: security and correctness fixes (carry-over from the audit)

Done 2026-10-18 (items already delivered by Phases 1-4 verified rather than redone).

- [x] Passwords and PINs hashed (bcryptjs) everywhere; no hash ever returned over IPC: `main/ipc/secrets.test.ts` calls every read-only channel plus login, PIN login and user management as admin on a database with passwords, PINs, orders and payments, and fails on any bcrypt hash or `passwordHash`/`pinCode` key. (No importer: no live installs.)
- [x] Every handler checks the caller and role in main (`ipc-safe.ts`, Phase 3): access list snapshot-tested, every protected channel tested anonymous, every admin channel tested as STAFF. UI hiding is cosmetic only.
- [x] No `file://` paths from the renderer: pictures only via `savdochef-img:` with a name pattern + containment check (Phase 3); the only `file://` in `src/` is the navigation guard comparing against the app's own index.html.
- [x] Logger: electron-log to `app.getPath('logs')/main.log` (5 MB rotation), uncaught errors and renderer/child crashes captured, no renderer logging channel exposed, request inputs never logged (`main/logger.ts`). Verified in the built app.
- [x] Deleted the legacy app from the branch (`git rm -r legacy`, 186 files: Express, cors, Joi, winston, Mongoose models, SetupGate, `/health` probing, `config.env.js`); it stays in tag `legacy-js-express`. Its `node_modules` folders were removed from disk. **Left on disk on purpose** (untracked, ignored): `legacy/backend/prisma/data/app.db` (the database with real-looking restaurant data), `legacy/backend/prisma/savdochef.db`, `legacy/backend/utils/errors.log`. Delete them yourself once you no longer need that data.
- [x] Correctness: unused dish pictures are deleted at startup (only our file names, only older than 24 h, so a picture picked but not yet saved survives; tested).
- [x] Receipt HTML escaping and a print window without preload: done in Phase 7.
- [ ] Root `.env` is the legacy app's (untracked, ignored); the new app does not read it, but the Prisma CLI prints "Environment variables loaded from .env". Remove it when convenient.

## Phase 7: printing

Done 2026-10-19 (dev machine: XP-80C over USB, EPSON, virtual printers; no paper printed by the automated run).

- [x] Receipt HTML (`main/printing/receipt.ts`) escapes every value with the shared `escapeHtml` (`shared/utils/escape-html.ts`, also used by `ui/html.ts`), carries its own CSP (`default-src 'none'`, inline styles only, no scripts). The renderer never sends receipt content: `printing:printReceipt` takes an order id and main builds the document from the database (cancelled orders refused).
- [x] Print window: hidden, `sandbox: true`, `contextIsolation`, no node, no preload, loads only a `data:` URL of the generated document, window.open and navigation denied (`receiptWindowOptions`, tested).
- [x] **Decision: Chromium silent print, not ESC/POS.** The site printer (XP-80C) has a Windows driver and legacy already printed through it; HTML keeps one builder for print and preview, Cyrillic and Uzbek apostrophes without code pages, and no native USB deps to package. `@node-escpos/*` were never added to the new app. Revisit only if a till has no driver.
- [x] Page is 80 mm wide and as long as the receipt (measured body height, no blank paper); 20 s timeout; errors as `CONFLICT` with `reason` `NO_PRINTER` / `PRINT_FAILED` / `TIMEOUT` / `NO_RECEIPT_SETTINGS`.
- [x] Printer choice (`pickPrinter`, tested): name from settings (loose match, "XP-80C" finds "XP-80C (copy 1)"), else the XP-80/thermal family preferring USB and never XPS/OneNote/PDF/fax, else the Windows default, else the first.
- [x] UI: auto-print after payment (setting `printAfterPayment`, default on, like legacy) and a print button on completed checks; both fire-and-forget with a toast, a printer failure never blocks or undoes the sale. Settings: printer dropdown (live list + "Avtomatik", a saved offline printer stays selectable), receipt language, "Namunani ko'rish" (PNG of the same document with unsaved form values, rendered by the same window) and "Sinov cheki".
- [ ] Not verified: paper output on the XP-80C (the automated run only rendered the preview; press "Sinov cheki" once on the till). Electron 44 reports no default-printer flag here, so the "Windows default" fallback is a hint only.
- [ ] Kitchen ticket (optional): same pipeline, second template.

## Phase 8: packaging and release

Started 2026-10-19.

- [x] electron-builder config (`electron-builder.config.js`): NSIS x64 installer (`npm run dist:win` -> `dist/SavdoChef-Setup-<version>.exe`, 119 MB), fuses (no runAsNode, no NODE_OPTIONS/inspect, asar integrity, app only from asar). Verified: `app.asar` is 1.2 MB (main/preload/renderer bundles, no `node_modules`); `app.asar.unpacked` is the generated Prisma client, 24 MB, of which 21 MB is the native engine (trimming the 3 MB wasm/edge files is not worth a custom filter). The packaged exe on an empty profile creates the database and runs migrations v0 -> v5 in about 4 s, with no errors in `main.log`. Linux targets stay in the config, unbuilt.
- [x] Branding (posgro structure, vanilla): `src/shared/branding/brand.ts` is the single source (colors, name, uz/ru/en taglines, Icon / Wordmark / Horizontal / Square as SVG trees, chef-hat artwork redrawn as vectors from the original icon, transparent outside the tile). `src/renderer/branding/` renders them as DOM SVG. `npm run build:icons` writes `build/icons/*.svg`, `savdochef.ico` (16-256), 1024 px PNGs and `src/renderer/public/favicon.svg`; `brand.test.ts` fails if they are stale. Wired into window icon, NSIS installer/uninstaller, Linux, favicon, boot screen. UI tokens: `--color-brand` #F8901F; `--color-primary` #B4530B in light (AA with white text), brand orange in dark.
  - [ ] Wordmark renders in Segoe UI (no Poppins-like font installed); bundle a font under `font-src 'self'` if the original look matters.
- [ ] Cold start right after an install/update (2026-10-19 silent installs: 0.7 s and 1.9 s from start to database open; earlier dev-build runs: 7-26 s) (first load of freshly written files, likely antivirus scanning; warm start ~0.1 s to DB). Measure on a real till after installing an update; consider fewer/larger files if it reproduces.
- [x] **Decision: no auto-updater** (tills are offline, the repo is private; a GitHub updater would embed a token). An update means installing the newer `SavdoChef-Setup-x.y.z.exe` over the old one. `publish: null`, `deleteAppDataOnUninstall: false` (data in `%APPDATA%\SavdoChef` survives uninstall and upgrade).
- [x] `npm run release -- patch|minor|major` (`scripts/release.mjs`): clean tree check -> `npm run check` -> `npm version` (commit + tag) -> installer -> `release/vX.Y.Z/` with a `.sha256`. Version rule in the script header: patch = fixes without migration, minor = features or any migration, major = something the operator must be told before installing. Pushing stays manual.
- [ ] Code signing: the installer is unsigned (SmartScreen warns "unknown publisher" on first run). Needs a certificate; electron-builder picks it up from `CSC_LINK`/`CSC_KEY_PASSWORD` without config changes.
- [ ] Parity pass against the Phase 0 inventory on a Windows machine with a real receipt printer; fill the checklist item by item.
- [x] Upgrade test between two versions of the **new** app (2026-10-19): installed 0.1.0 silently into a scratch folder, ran it with `--user-data-dir` on a copy of the real data (1 user, 10 dishes, 9 orders, 8 payments, 2 sessions, schema v5), installed 0.1.1 over it, ran again: log shows 0.1.1, same schema, identical counts; silent uninstall removed the program, shortcuts and registry entry and left the data. The real `%APPDATA%\SavdoChef` was never opened. Not covered: an upgrade that carries a migration (no v6 yet; the migration path itself is tested in `database.test.ts`). Repeat with the first real migration.

## Phase 9: `.claude/` and docs

Done 2026-10-19.

- [x] `CLAUDE.md` rewritten for the new stack: commands, layout, IPC chain, database/migrations, printing, hard rules (Decimal, additive DB changes, back up before data operations, security model, `html` helper, uz+ru, dependency pinning, git), workflow pointers.
- [x] Ported from posgro and rewritten for the vanilla chain: `rules/electron.md` (src/main, renderer, shared), `rules/prisma.md` (prisma/, src/main/database), skills `ipc-feature` and `prisma-migration` (numbered migrations + drift test instead of `prisma migrate`), commands `/check` and `/plan`, agent `migration-reviewer`; `electron-security-reviewer` and `prisma-reviewer` rewritten for the TS code.
- [x] Hooks (`.claude/hooks/`, run with `node --experimental-strip-types`, Node 22): `guard-bash` blocks destructive SQL, `prisma migrate`/`db push`/data-loss flags, deleting/moving or opening `%APPDATA%\SavdoChef` with sqlite, force push, hard reset, forced clean, staging `.db`/`.env`, recursive deletes (11 allow/block cases checked by hand); `format` runs Prettier on edited `src/**/*.{ts,css,html,json}` (checked with a Windows backslash path). `settings.json`: allow/ask/deny for the new scripts, hooks wired. Both took effect immediately in the session that wrote them.
- [x] Removed the Express-era `/new-endpoint`, `/add-ipc`, `/schema-change` and `rules/backend.md`.
- [x] `tasks/lessons.md` started with this rewrite's real lessons (data safety, Electron/Chromium quirks, harness pattern, Windows/Git Bash editing). `tasks/todo.md` stays the plan.
- [ ] Known false positive: `guard-bash` matches the whole command text, so a heredoc or commit message that merely mentions a blocked command is blocked too. Workaround: put such text in a file. Tighten only if it gets in the way.

## Feature F1: halls, takeaway/delivery, split payment, debt, settings pages (planned 2026-10-19, awaiting approval)

Decided with the user 2026-10-19: restaurant-wide unique table numbers grouped into halls; delivery with fee + status; debt as a tender (whole or part of a check) on a named customer; any user records debt and repayments, only an admin forgives/adjusts/voids. Delivered in three steps, each its own commit and version bump (minor: each carries a migration).

Design rules for all three steps:
- Additive migrations only (0006-0008). `orders.tableNumber` stays NOT NULL: takeaway/delivery orders store 0 and every DTO exposes `tableNumber: number | null` (null when not dine-in). Reason: making the column nullable needs an `orders` table rebuild, and inside our migration transaction `PRAGMA foreign_keys=OFF` is ignored, so dropping the old table would cascade-delete every order line.
- The pending-table triggers from 0003 are replaced in 0006/0007 so `pendingTable` is set only for pending **dine-in** orders (any number of open takeaway/delivery orders).
- Money stays Decimal; every new figure is computed in main and tested with exact values. Stock logic is unchanged: all order types use the same line pricing and shift stock.

### F1-A: settings pages + halls and tables (migration 0006) - done 2026-10-19, not committed

- [x] Schema + migration 0006 (`halls`, `dining_tables`; orders untouched, no FK: they keep the number). Seed creates "Asosiy zal" with tables 1..max(table_count, highest used number) once (`halls_seeded`); the setup wizard sets tables 1..N on a database without orders; the legacy import adds a table for every number its orders use (`ensureTablesForOrders`).
- [x] `main/halls/halls.ts` + channels `halls:list` (user; hidden halls only for admins), `halls:create/update/reorder/delete`, `tables:create/createRange/update/delete` (admin), event `halls-changed`. Rules: numbers unique incl. hidden; renumber/hide refused under an unpaid order; delete only without history (else hide); hall hidden only without active tables, deleted only without any; reorder atomic and refused on a stale list.
- [x] Security review fix: a **new** order needs an active table in an active hall (`TABLE_UNAVAILABLE`), checked inside the order transaction; an unpaid order already on a hidden number can still be edited and paid. `tableCount` dropped from `settings:update` (halls are the source of truth).
- [x] Settings `/settings/:section`: Tizim, Zallar va stollar, Chek (content + layout + live preview), Printer (printer, refresh, width, auto-print, test), Foydalanuvchilar (old `/users` redirects with history replace; nav item removed). Narrow screens: the section list becomes a tab strip.
- [x] Tables screen: hall tabs (remembered per device, forced to "Hammasi" with one hall), hall headings, table labels; orders on numbers outside every hall shown under "Boshqa stollar" in every view.
- [x] Russian plurals (`_few`/`_many`) for the new strings; the i18n parity test now treats plural forms as one key and checks every plural has `_other`.
- [x] Tests: `halls.test.ts` (13), access snapshot, staff vs admin `halls:list`, fresh-database hall. `secrets.test.ts` fixed: it passed `{}` to channels without input, so about half the read channels never ran (they failed validation and the check passed on the error); now every read channel must succeed.
- [x] Reviews: migration-reviewer SAFE TO APPLY (both optional fixes done); electron-security-reviewer: no high findings, mediums/lows fixed except the `/users` redirect via `setTimeout` (constant target, cosmetic).
- [x] Verified: harness on a copy of the real data (upgrade v5 -> v6, every section, dialogs, reorder, tabs, uz/ru, dark, narrow); installer upgrade 0.1.0 -> 0.2.0 on a data copy: backup written, migrated v5 -> v6, identical counts; silent uninstall clean.
- [ ] Version bump to 0.2.0 at release (`npm run release -- minor`), not done yet.

### F1-B: takeaway and delivery (migration 0007) - done 2026-10-19, not committed

- [x] Migration 0007, **hand-written**: `customers` table + ADD COLUMN on `orders` (orderType, customerId FK, customer/delivery snapshots, deliveryFee, deliveryStatus, courierName). Prisma's own diff was a `RedefineTables` rebuild of `orders`, which inside our migration transaction would cascade-delete every order line (`PRAGMA foreign_keys=OFF` is ignored in a transaction); the drift test proves the ADD COLUMN version yields the identical schema. Pending-table triggers replaced: only pending DINE_IN orders hold a table. Test: a v6 database with orders, lines and payments upgrades with nothing lost.
- [x] `shared/utils/phone.ts` (posgro): mask `+998 (90) 123-45-67`, stored `998XXXXXXXXX`, a complete number is exactly 9 or 998+9 digits (never cut to fit).
- [x] Domain: `priceAndReserve` shared by table and open orders (same pricing and stock), `saveOpenOrder` (create/edit with version; delivery needs phone + address; fee rounded once, default from settings on create, kept on edit when omitted, max 2 dp and 10 mln), `cancelOpenOrder`, `setDeliveryStatus` (PREPARING -> ON_THE_WAY -> DELIVERED + courier), payment marks a delivery DELIVERED, `listOpenOrders`, busy tables dine-in only. A switched-off type refuses new orders and switching into it; open ones can finish. Customers upserted by phone (given fields win, missing ones never erase).
- [x] Channels (all `user`): `orders:get/openList/saveOpen/cancelOpen/setDeliveryStatus`, `customers:findByPhone` (returns only name, address, landmark: it is a reverse lookup any user can make; re-review before Phase 8.5 LAN). `orders-changed` carries orderId.
- [x] UI: tables screen start buttons + open-order strip; order screen for all types (routes `/orders/new/:type`, `/orders/:id`) with the customer panel (type switch, masked phone with autofill, address, landmark/remark, fee, delivery status + courier); settings section "Buyurtma turlari"; checks type column + filter + customer details; reports by order type with delivery fees; receipt type/customer/address/landmark-or-remark/fee.
- [x] Reviews: migration-reviewer (SQL safe; release item = version bump + upgrade test, done below), prisma-reviewer and electron-security-reviewer: all findings fixed (type switch into disabled type, fee omitted on edit, fee size/decimals and rounding, smaller lookup DTO, strict phone, Prisma errors logged without query arguments, takeaway remark label, neutral cancel message, exact-decimal tests, secrets test with a real open delivery).
- [x] Verified: harness on a copy of the real data (v6 -> v7; delivery through the UI incl. phone mask backspace, save -> `/orders/:id`, status + courier, autofill, takeaway, strip, pay -> DELIVERED, checks, reports, settings, ru); installer upgrade 0.2.0 -> 0.3.0 on a data copy: backup, v6 -> v7, identical counts; uninstall clean.
- [ ] Not done (by design): courier list/management, delivery zones or per-zone fees, kitchen ticket, SMS. Version bump at release.

### F1-C: split payment, debt (nasiya), debtors (migration 0008) - done 2026-10-20, not committed

- [x] Migration 0008, hand-written (Prisma again proposed a `payments` rebuild): `debt_repayments` (PAYMENT / WRITE_OFF, voided not deleted) + `payments.customerId/dueDate/settledAt`; `mixed` order method. Test: a v7 database with payments upgrades intact (legacy debt stays open, customer-less).
- [x] `shared/utils/split-payment.ts` (posgro rules, Decimal): lines cover the total, only cash goes over (change, not stored), card + Click + debt never over; a free (0) check is one 0 line. The modal and main run the same code.
- [x] Payments: `writeTenders` shared by pay and the admin check edit: one row per method, debt on a customer (by phone; an existing customer is never renamed or re-activated, a new one needs a name; or the order's own customer), due date a real date, at most a year ahead, not in the past for new debt. Settings "To'lov": split and debt switches (a check edit keeps what the check had).
- [x] Debt ledger (`main/debts`): balance computed, never stored; repayments cover debt in the order it was written (`reallocate`, settledAt = the repayment that completed it); repay (any user) and write-off (admin) never above the balance (checked again after the write); void (admin) keeps the row struck through; legacy customer-less open debt listed as "Noma'lum mijoz" and assignable once; paid legacy debt stays out. Cancelling or editing a check is refused when it would leave a customer having repaid more than they owe.
- [x] Privacy: staff see debtors' name, phone and ledger (they take repayments); address, landmark and note only admins; the ledger refuses customers without debt history; "show settled" only admins.
- [x] Checks: one row per order (methods, open debt), status filter on the shown status; check edit with version check, keeps the cashier, refuses legacy-settled/refunded checks. Receipt: a row per method, debt with name and due date.
- [x] Reports: orders, dishes, fees once per order on the day of its first payment (any range); "Kassaga tushgan" = cash + card + Click + repayments; debt sold, repayments by method, write-offs.
- [x] UI: tender editor (single method with change, split with "Qolgan", debt customer with masked phone autofill and due date), Qarzdorlar page (totals, search, overdue, ledger, repay / write-off / void / edit / assign), settings "To'lov", reports tiles. Shared `components/phone-field.ts` (the customer panel uses it too).
- [x] Reviews: migration-reviewer SAFE TO APPLY; prisma-reviewer (3 bugs: legacy-settled check edit re-opening debt, free orders unpayable, checks status filter; plus write-order coverage, report double counting, edit version/cashier/switches) and electron-security-reviewer (high: `debts:get` read any customer by id with address and note; medium: settled-debtor directory, empty secrets coverage) - all fixed and tested. Known: a voided repayment leaves the totals of the day it was entered (documented).
- [x] Verified: harness on a copy of the real data (v7 -> v8; pay with cash change, split card + debt to a new customer via "Qolgan", partial repayment on the Qarzdorlar page, checks, reports, settings, ru); installer upgrade 0.3.0 -> 0.4.0 (final build) on a data copy: v7 -> v8, identical counts; uninstall clean.
- [ ] Not done: debt limits per customer, SMS reminders, printing a repayment receipt, a customers page beyond debtors. Version bump at release.

### Verification and release (each step)

- [ ] `npm run check`, `migration-reviewer` on each migration, `prisma-reviewer` on payments/debt, `electron-security-reviewer` on new channels.
- [ ] Harness on a copy of the real data: screenshots of every new screen in uz and ru, light and dark.
- [ ] Upgrade test with the migrations: install the previous build, run it on a data copy, install the new build over it, compare counts and open the new screens.
- [ ] Version: 0.2.0 (A), 0.3.0 (B), 0.4.0 (C), or one 0.2.0 if released together.

## Feature F2: PIN-only login, phone instead of username, CASHIER role, permissions (2026-10-20)

Decided with the user 2026-10-20: login is a 4-digit PIN only (no user list, no username, no password); PINs are unique and set only by users with the "users" permission; till lockout after 5 wrong PINs; every user has a name and a unique phone; recovery code for a forgotten admin PIN; roles ADMIN / CASHIER / STAFF are templates for per-user permission checkboxes. Replaces the uncommitted "remember me" work (no passwords left to remember).

- [x] Migration 0009 (destructive by request, backed up first like every migration): drop `username` (+ its unique index), `passwordHash`, `failedLoginCount`, `lockedUntil`; add `phone` (unique, required by the app; existing users fill it in on first edit), `pinHash` (unique HMAC-SHA256 of the PIN with a per-install key, so a PIN can be looked up and kept unique), `permissions` (JSON list); `fullName` back-filled from the old username. The old bcrypt `pinCode` stays as `legacyPinCode` for one transition: an old PIN still works once and is converted.
- [x] Permissions (checked in main on every call; the UI only hides): `orders` (take and edit orders), `payments` (close an order: payment), `debt` (sell on debt, take repayments), `checks` (view and reprint checks), `shifts` (open, edit, close shifts), `menu`, `reports`, `corrections` (edit and delete paid checks, delete closed shifts), `debtsAdmin` (forgive, void, assign, edit debtors), `settings`, `users` (users, PINs, recovery code). Defaults: ADMIN all; CASHIER orders, payments, debt, checks, shifts; STAFF orders. The last active user with `users` cannot lose it.
- [x] Login: keypad only; 5 wrong PINs lock the keypad 5 min (doubling, kept across restarts); "PIN unutildimi?" = recovery code + new PIN for the owner admin (a new code is shown once). If no user with `users` can log in (upgrade with no PIN), a one-time "set the administrator PIN" step, like first-run setup.
- [x] Setup wizard: admin name, phone, PIN; shows the recovery code once. Users screen: name, phone, role, permission checkboxes (role sets the defaults), PIN set/change/remove, active. Profile: name and phone. Lock = log out to the PIN keypad.
- [x] Legacy import: users come in without PIN or phone (an admin sets them).
- [x] Tests: auth (PIN lookup, uniqueness, lockout, legacy PIN transition, recovery, bootstrap), permissions on every channel (snapshot), users (last `users` holder), migration 0009 on a database with users, secrets (no pin key, PIN hash or recovery hash leaves main). Harness (fresh setup, users modal, staff vs cashier, recovery, lockout) and a copy of the real 0.4.0 data (migration 9, old admin PIN still valid, no bootstrap step). Installer upgrade test still to do with the release build.
- [ ] Release: major version (operators log in differently).

## Feature F3: receipt layouts per order type, top and bottom images (2026-10-20)

Decided with the user 2026-10-20: three receipt layouts, General (dine-in tables), Delivery, Takeaway. Restaurant name, address, phones, language and separator stay shared (`receipt_settings`). Per type: show/hide switches (address, phone, date/time, order number, customer block for delivery/takeaway), footer note, an optional top image and an optional bottom image (e.g. logo on top, Telegram/Instagram QR at the bottom), each with a width in % of the 72 mm paper. Delivery and Takeaway start as copies of General.

- [x] Migration 0010 (additive): table `receipt_layouts` (`orderType` unique: DINE_IN / TAKEAWAY / DELIVERY; the switches; `footerNote`; `topImage`, `topImageWidth`, `bottomImage`, `bottomImageWidth`). No rows seeded: a missing type falls back to General, a missing General to the old `receipt_settings` switches and footer (so existing installs and the legacy import keep printing exactly as now). The old `printShow*` / `footerNote` columns stay (additive rule), read only as that fallback.
- [x] Images: picked in main with the file dialog and copied into the existing image store (`userData/img`, random names, sniffed JPG/PNG/WEBP, 5 MB), like dish pictures; the renderer only ever holds the file name and shows it through `savdochef-img:`. The receipt document embeds the image as a `data:` URL (its CSP already allows only that), centred, at the chosen width, grayscale for the thermal head. A missing or unreadable file is skipped, never fails a print.
- [x] IPC: `receipt:layouts` (read), `receipt:updateLayout` (settings), `receipt:pickImage` (settings); `printing:preview` and `printing:test` take the order type (and unsaved layout values for the preview). Printing an order picks the layout by `order.orderType`. Events: layout changes emit the existing settings event.
- [x] Sample orders per type for preview/test (delivery with customer, phone, address, fee; takeaway with a name).
- [x] Settings > Chek: shared restaurant card, then tabs General / Yetkazib berish / Olib ketish, each with its switches, footer, top and bottom image (choose, remove, width slider) and its own live preview.
- [x] Tests: migration drift; layout fallback chain; HTML per type (switches, customer block, images embedded with width, missing image skipped, escaping); print picks the order type's layout; access snapshot and events; image name validation (only names the store issued).
- [ ] Verify: build and harness done (fresh install: pictures picked through a stubbed dialog, General saved, Delivery inherits then saved with its own footer and no bottom picture, Takeaway follows General, drafts survive tab switches; copy of the real data: migration v9 -> v10). Still to do: one real test print per type by the user.

## Feature F4: deploy:pos to panel.posgro.uz and in-app software update (approved 2026-10-20; built, not committed, nothing deployed)

Like posgro: `npm run deploy:pos` builds the installer and uploads it over sftp to the posgro VPS; the till's updater (electron-updater, generic feed) reads `latest.yml`. Replaces the 2026-10-19 decision "manual installers, no auto-updater". Answers: feed + a SavdoChef card on the panel; check quietly at start + a button, download and install only when an admin presses.

**Where it lives (checked on the VPS, read-only):** `/home/bobur/releases/` is aliased by nginx at `https://panel.posgro.uz/releases/` (no cache). SavdoChef goes in its own subfolder `/home/bobur/releases/savdochef/` → feed `https://panel.posgro.uz/releases/savdochef/latest.yml`. No nginx change, POSGRO's own `latest.yml` untouched.

### SavdoChef repo
- [x] `electron-updater` 6.8.10 (exact; 2026-09-26) as a dependency, bundled into main by electron-vite (check it bundles; else `files`/externals).
- [x] `electron-builder.config.js`: `publish: { provider: 'generic', url: 'https://panel.posgro.uz/releases/savdochef/' }` so the build writes `latest.yml` + `.blockmap`.
- [x] `scripts/upload-release.mjs` (posgro `upload-release.js` pattern): find `dist/SavdoChef-Setup-<version>.exe`, refuse if that version is already on the server (no overwriting a live release), `mkdir -p` the folder, upload exe → blockmap → `latest.yml` **last** (the moment it goes live). Uses Windows OpenSSH `sftp`/`ssh` with host `posgro-vps` (Git Bash's ssh cannot use the key agent). Prints the feed and download URLs.
- [x] `package.json`: `"deploy:pos": "npm run dist:win && node scripts/upload-release.mjs"`. Version bump stays `npm run release -- patch|minor|major` (check, tag); `release.mjs` header and CLAUDE.md commands updated.
- [x] `main/updater/updater.ts`: one state machine `idle | checking | available{version, notes?} | not-available | downloading{percent} | downloaded{version} | error{message (Uzbek)} | unsupported` (dev build / not packaged). Feed URL hard-coded in main; `autoDownload = false`, `autoInstallOnAppQuit = false`; logs into electron-log. Quiet check 15 s after start (errors there are only logged: tills are often offline).
- [x] IPC (skill `ipc-feature`): `updater:status` (read-only), `updater:check`, `updater:download`, `updater:install`; access `need('settings')`; nothing passed from the renderer but the call. New change event `update-changed` (progress throttled to whole percents) so the section re-reads status.
- [x] Install: `quitAndInstall(isSilent=true, forceRunAfter=true)` like posgro, after the database is closed cleanly; confirm dialog in the UI first ("dastur yopiladi va qayta ochiladi"). Data in `%APPDATA%\SavdoChef` is untouched by the installer; the new version backs the database up before migrating (existing behaviour).
- [x] Settings → new section "Dastur yangilanishi": current version, last check, status line, buttons Tekshirish / Yuklab olish (progress bar) / O'rnatish va qayta ishga tushirish. A dot on the Settings nav item when an update is available (for users with the `settings` permission). uz + ru strings.
- [x] Tests: updater state machine with a fake autoUpdater (events → status, errors → Uzbek message, unsupported in dev), access snapshot + events, upload script's pure parts (find exe, latest.yml names, version-exists refusal) unit-tested.
- [x] Verify (done): check 440 tests; installer built (latest.yml, blockmap, app-update.yml with the feed); real electron-updater against a local copy of the feed: found 99.0.0, downloaded, sha512 OK (installed nothing); UI harness through every state (fake handlers on ipcMain); `upload-release.mjs --dry-run` against the VPS (reachable, nothing live yet). Security review: install sequence fixed (destroying windows quit the app before quitAndInstall), receipt window own session + leftover temp cleanup, version validated, sha512 of exe checked against latest.yml, deploy:pos runs check.
- [ ] Still to do: first real deploy (`npm run deploy:pos`, only when the user says), then a real update on a till: install N, deploy N+1, update from Settings.
- [ ] Decision for the user: installers are not code-signed, so update integrity rests on the VPS (same as POSGRO). Options: Authenticode certificate + publisherName, or an own ed25519 signature checked before install.

### posgro repo (panel card), on a feature branch from `dev`, not merged or deployed by me
- [x] `DownloadsService.latestApp(app)`: `app` in `posgro | savdochef` (whitelist, no path from the query), reads `releases/savdochef/latest.yml`, url `/releases/savdochef/<file>`. `GET /downloads/latest-app?app=savdochef`; default stays POSGRO. Test in `downloads.service.test.ts`.
- [x] Panel `App.tsx`: a second card "SavdoChef — restoran va kafe uchun" with version, size, download button, hidden when there is no feed. uz/ru strings.
- [x] posgro has an unrelated uncommitted `prisma/seed.ts` change on `dev`: I'll work in a separate worktree so it is not touched. Merge/deploy through your normal posgro pipeline when you choose.

## Feature F5: restaurants as tenants of the posgro server: trial, plans, 14-day check-in (approved 2026-10-20; committed 2026-10-21)

The till stays offline-first with no data sync and no owner web dashboard. posgro's server is the licence authority
and the super admin's control panel. **Server side: `C:\Users\user\posgro\tasks\todo.md`, top section** (branch
`feat/savdochef-tenants`); this list is the till side and follows it.

**Decisions (user, 2026-10-20):**
- A restaurant is a posgro `Store` with `product = SAVDOCHEF`.
- Onboarding: self-signup in the setup wizard (phone confirmed by a one-time code) starts a **14-day trial**; an
  existing restaurant links with phone + activation code from the super admin.
- Plans: **Start / Pro / VIP** = number of tills + feature flags, set in the dashboard.
- When blocked or overdue: **read-only** (warning, grace, then no new orders or shifts; open orders can be finished,
  the shift closed, reports read).
- Check-in at least every **14 days**.

**Server contract (built in posgro):**
- `GET /savdochef/plans`
- `POST /savdochef/signup/start`, `POST /savdochef/signup/complete`
- `POST /savdochef/activate`
- `POST /savdochef/licenses/renew`
- Base URL `https://api.posgro.uz/api` (fixed in main, like the update feed).
- Licence = Ed25519 `<payload>.<sig>` signed with a **SavdoChef-only key**: `storeId`, `storeName`, `plan`,
  `expiresAt`, `warnFrom`, `blockAt`, `issuedAt`, `checkinBy`, `terminals`, `seats`, `features`, `trialEndsAt`,
  `product: 'SAVDOCHEF'`.

### Till side
- [x] **Schema (additive, migration 0011):** `license` singleton: `storeId`, `token`, `terminalId`, `lastCheckinAt`,
      `lastError`, `clockMark`. Terminal id = random UUID made once, stored there and in userData.
- [x] **`main/license/`:**
  - port posgro's `license.ts` verification and the **trusted clock** (`trusted-clock.ts`: mark in SQLite + a
    safeStorage file; max of the two; monotonic while running);
  - embedded public key;
  - `licenseState(now)` → `active | warning | grace | blocked | checkin-required | unlicensed`;
  - `features()`, `holdsSeat()`;
  - background renew: on start, then every 6 h while online, silent when offline, plus a "Check now" call.
  - Tests with fake clocks: winding the clock back gains nothing; 14 days without a check-in → `checkin-required`.
- [x] **Read-only enforcement in main (not the UI):**
  - one guard in `invokeHandler` by channel class: new order, `sessions:open`, menu and price edits refused with an
    Uzbek message;
  - still allowed: paying and closing **existing** orders, `sessions:close`, reports, checks, settings → Obuna,
    login, printing;
  - write down the list next to the channel map, and add a test that every mutating channel is classified.
- [x] **Feature flags in main + UI:** takeaway/delivery, debt, reports detail, receipt logos, extra halls; a
      channel whose feature is off is refused in main; the UI hides it and shows "Pro tarifida".
- [x] **Setup wizard** (online once), new first steps:
  - **Yangi restoran:** plans from `/savdochef/plans` (Start / Pro / VIP, prices, what each includes, "14 kun
    bepul"), then name, owner and phone.
  - **Phone check through Telegram:** the wizard shows the bot link + QR ("Telegramda oching va raqamingizni
    yuboring"). The bot sends a 6-digit code; it is typed into the wizard. Then the licence comes back.
  - **Mavjud restoran:** phone + activation code → licence + store name.
  - Then today's steps (admin PIN, receipt, tables). Offline at setup: show "Internetga ulaning" and retry; no
    offline way past it.
- [x] **Existing installs (0.5.0, no licence):** on upgrade, a "Restoraningizni ulang" screen for the admin.
      14 days of unlicensed allowance from first run with F5 (trusted clock), then read-only until linked.
- [x] **Settings → Obuna section:**
  - plan, status badge, days left, trial end, last check-in, next required check-in;
  - payment details from the server; "Hozir tekshirish";
  - the till's id and its slot.
  - Banner in the shell during warning, grace and read-only (admins see payment info; cashiers see "Administratorga
    murojaat qiling").
- [x] **Seats:** a till without a slot (more tills than the plan) is read-only with "Tarifdagi kassalar soni
      tugagan".
- [x] **Privacy:** only the store id, terminal id, app version and machine name go to the server; no orders,
      customers or money figures. Say so in the wizard.
- [x] **Tests and verification:** done 2026-10-20: `npm run check` 457 tests (licence state matrix, refusals, trusted clock, service with a fake server, licence channel access). Real app against a stand-in server signing with the real key pair: setup link card + plans, setup refused before linking, Telegram step with QR, wrong code, linked -> details prefilled, Obuna section; Start plan refuses delivery/takeaway/debt/long report, allows a table order; blocked: new order and shift refused, paying an open order works, red banner. Copy of the real data: v10 -> v11 with backup, 14-day unlinked allowance, activation before login. Still to do: against posgro staging once it is deployed.
  - licence state matrix, guard classification, feature gating, wizard flows against a local fake server;
  - harness against **posgro staging** (self-signup, activation code, block/unblock from the dashboard, 14-day
    check-in with a shifted clock);
  - `electron-security-reviewer` + `prisma-reviewer`.
- [x] Controls outside the plan are hidden (2026-10-21, `licensed()` in `store/app.ts`): takeaway/delivery start buttons and type switch, debt as a payment method, report ranges longer than a day (per-day picker + note), a second hall (add / show hidden), receipt pictures (note; saved without them). Main still refuses each one.
- [ ] **Release:** posgro server deployed first (its todo, steps 8-11), then a SavdoChef minor release (`npm run release -- minor`, `npm run deploy:pos`). Tills on 0.5.0 update in-app and get the 14-day unlinked allowance.

**Answered (2026-10-20):**
- code through the existing posgro Telegram bot (no SMS for now);
- VIP like posgro (bought once, never expires);
- prices and features as suggested in the posgro section (editable in the dashboard);
- one trial per phone.

QR: `qrcode-generator` 2.0.4 (exact, 2025-08), drawn as SVG nodes (`renderer/ui/qr.ts`).

## Feature F6: unlimited (∞) dishes in a shift, and the shift's cash drawer like posgro (approved and built 2026-10-21, committed 2026-10-21)

**Decided (2026-10-21):** ∞ is set per shift and remembered; cash in/out is drawer only (like posgro, not an expense); anyone with the `shifts` permission handles cash; X/Z reports print on the receipt printer.

**Before / after (stock):** today every dish in a shift has a starting quantity and sales stop at zero (`sessions/stock.ts`, all-or-nothing). After: a dish can be **∞** in a shift. It is still listed in the shift and its sold quantity still counts (reports, Z-report), but there is no upper limit and it has no leftover at close (nothing to carry or write off). Limited dishes behave exactly as today.

**Before / after (cash):** today a shift knows nothing about money in the drawer. After, as in posgro:
- opening cash counted at open (0 allowed);
- cash in (kirim) / cash out (chiqim) during the shift, each with an amount and a note, never edited or deleted (a mistake is corrected with the opposite movement, as posgro);
- expected cash = opening + cash payments of the shift's orders + cash debt repayments taken while the shift was open (not voided) + cash in − cash out;
- at close the counted cash is entered: expected, counted and shortage/overage (kamomad / ortiqcha) shown live, stored on the shift. Expected is frozen at close, so a later check correction does not change a closed shift's figures;
- X-report (any time while open) and Z-report (printed at close, reprint from history).

Steps:
- [x] **Migration 0012 (additive)** via `prisma-migration`, then `migration-reviewer`:
  - `session_items.unlimited` Boolean default false;
  - `sessions.openingCash` Decimal default 0, `sessions.countedCash` Decimal? and `sessions.expectedCash` Decimal? (set at close);
  - new table `cash_movements` (id, sessionId → sessions RESTRICT, type `PAY_IN | PAY_OUT`, amount > 0, note, createdById, createdAt), index on sessionId.
  - Shifts closed before F6: opening 0, counted/expected null → history shows "—".
- [x] **Stock (main):** `applyStockDeltas` skips the upper limit for ∞ items (sold still tracked, never below 0). `openSession` / `updateOpenSession` take `unlimited` per item (quantity ignored, stored 0); switching ∞ off in the open shift needs a quantity ≥ sold (same rule as today). `closeSession` skips ∞ items (no leftover). New read-only `sessions:lastUnlimited` (dish ids that were ∞ in the last closed shift) for the pre-tick. Tests for each.
- [x] **Cash (main):** `openSession` takes `openingCash`; new `sessions:addCashMovement` (`shifts`, emits `session-changed`, open shift only, amount > 0, note ≤ 200); new read-only `sessions:cashSummary` (opening, cash / card / click / debt sales, cash debt repayments, cash in, cash out, expected, counted, difference, movements); `closeSession` takes `countedCash` (required) and stores counted + expected in the same transaction. Decimal throughout. Tests: expected-cash formula (split tenders, debt, repayments in and outside the shift window, voided repayment), close snapshot, movement on a closed shift refused.
- [x] **X/Z reports:** `printing:shiftReport({ sessionId, kind: 'X' | 'Z' })` (`shifts`). Main builds the document from the database like the receipt (escaped, own CSP, hidden sandboxed window, same printer and paper width): restaurant, shift number, opened/closed by and when, sales by method, orders count, cash in/out lines, expected / counted / difference (Z), sold quantities per dish. X only for the open shift, Z only for a closed one. Close offers "print Z-report" (on by default; printing never blocks the close: failure is a toast).
- [x] **UI, open/edit shift window:** opening cash field (open only); per dish an ∞ switch next to the quantity (quantity disabled while on); pre-ticked from the last shift; search unchanged.
- [x] **UI, current shift card:** cash tiles (opening, cash sales, card, click, debt repayments, cash in, cash out, expected) for `shifts` users; buttons Kirim, Chiqim, X-hisobot; movements list; ∞ shown in the stock table instead of initial/remaining.
- [x] **UI, close window:** counted cash with live expected and shortage/overage, the leftovers table (∞ dishes not listed), "print Z-report" checkbox.
- [x] **UI, history:** columns expected / counted / difference; details show the cash summary, movements, and Z-report reprint.
- [x] **Order screen:** ∞ dishes never show "sold out" and show no remaining count (`draft.ts available()` returns unlimited).
- [x] uz/ru strings; `npm run check`; `prisma-reviewer` (stock + money) and `electron-security-reviewer` (new channels, print window); harness on a copy of real data: open with ∞ + opening cash, sell past any number on an ∞ dish, cash in/out, X-report to a virtual printer (PDF), close with a shortage, Z-report, history; migration v11 → v12 on the copy.
- [x] Review fixes (2026-10-21): drawer figures on `sessions:get/list/getOpen` only for `shifts` users; a closed shift shows "corrections after close" so its lines still add up; a cash debt repayment needs an open shift (else it lands in no drawer); payments, check edits and cash repayments refresh the shift view; expected may go negative after a correction (documented); ∞ takes in a carried leftover (documented).
- Verified on a copy of the real data (v11 → v12): edit shift #2 → Bishteks ∞, sold 300 past any limit, Kirim 50 000 / Chiqim 20 000 through the buttons, expected 6 243 000 = 0 + 6 155 000 + 58 000 + 50 000 − 20 000, X-report, close counted 6 238 000 → Kamomad −5 000, Z-report (both prints captured as pictures, no paper), history + details, next shift pre-ticks Bishteks ∞ and asks for opening cash.

## Phase 8.5: LAN access for waiter phones (first release, decided 2026-10-18)

- [ ] HTTP adapter in main (posgro `local-server` pattern: plain `node:http` + its small `router.ts`, `pairing.ts`, `auth.ts`, `serve-policy.ts`; copy those and their tests, **no** Express/Fastify) over the **same** domain modules; binds to the LAN only when enabled in settings; device pairing (QR/code) → per-device token; every request resolves a user + role exactly like the IPC path.
- [ ] Waiter UI: same vanilla renderer views served to the phone browser (tables, order, send to kitchen); no payments/reports/settings on phones unless the role allows it.
- [ ] Phase 3 consequence: auth is **per caller**, not one global `currentUser` in main. Handlers receive an `actor` (from the IPC window or the LAN token) and pass it to domain modules.
- [ ] Concurrency: two devices editing one table → optimistic version check on `Order` (`version` column), conflict error surfaced in the UI; broadcast changes to all clients (IPC `app:event` + SSE/WebSocket for LAN).

## Phase 10: later, only if needed

- [ ] **Cloud sync / multi-branch**: separate NestJS + PostgreSQL service with an idempotent sync endpoint (dedupe on `(branchId, orderNumber)`), POS queues writes locally. Keep N-1 client compatibility from day one.
- [ ] Reports export (xlsx/PDF), Telegram daily summary bot (posgro already has `telegraf` plumbing).

## Not doing

- React or any UI framework; styled-components, zustand, react-router, react-i18next, recharts, lucide-react.
- Express, Fastify or NestJS inside the Electron process.
- A second state/validation library alongside zod and the small store.
- Big-bang cut-over: ship behind the Phase 8 parity checklist, keep the legacy tag until it passes.

## Decisions (2026-10-18)

1. Live installs: none.
2. Money: keep `Decimal` (string over IPC, decimal.js helper).
3. Menu/category names: Uzbek + Russian.
4. Printer: XP-80/XP-80C 80 mm thermal via the Windows driver (from the legacy code); keep Chromium silent print, ESC/POS optional later.
5. Bootstrap: dropped entirely.
6. Waiter phones: needed in the first release → Phase 8.5.

## Order flow changes (2026-10-21, committed with F6)

- [x] Saving any order returns to the tables screen.
- [x] A delivery order prints its receipt on every save (background, like after payment).
- [x] Payment window: "Chekni chop etish" checkbox; starts from the print-after-payment setting, unticked for delivery (already printed at save).
- [x] Open-order cards: status on its own line, total + number on the bottom row (the number was clipped next to "Tayyorlanmoqda").
- [x] Move a table's unpaid order to a free table (`orders:moveTable`): ⇄ button on busy grid cards and "Stolni almashtirish" on the order page; only free, shown tables; version-checked; the pendingTable trigger moves the one-order-per-table lock. No migration. prisma-reviewer: no bugs; its test and stale-dialog suggestions applied.
- Verified on a data copy (harnesses smoke-save, smoke-cards, smoke-move); `npm run check` 486 tests.

## Feature F7: restaurant balance and paying the monthly bill on the till (approved and built 2026-10-21, not committed; posgro on branch `feat/savdochef-billing`)

**Answered:** top-up stays manual like posgro (the restaurant pays by QR/link with its store ID in the note; the super admin records the top-up in the dashboard, which already renews the month at once); SavdoChef gets its own payment details (fallback: posgro's); the till shows balance + next charge, a pay window with QR, and the last balance movements.

**Already there (posgro):** `Store.balance` + `BalanceTransaction` ledger, `BillingService` charging STARTER/PRO SavdoChef restaurants from the balance at expiry (negative → grace → block; a top-up renews), dashboard SavdoChef store page with balance, ledger and top-up. The grant already carries `payment {qrPayload, paymentUrl, supportPhone}`, but from posgro's settings, and production's are empty. The till keeps only paymentUrl/supportPhone, in memory.

### posgro (branch `feat/savdochef-billing` off `dev`; additive, behind `SAVDOCHEF_ENABLED` like all SavdoChef routes)
- [x] `savdochef_config.payment {qrPayload, paymentUrl, supportPhone}` (defaults empty, normalized, lengths capped); SavdoChef settings page in the dashboard edits them. Grant and `/savdochef/plans` use them, each field falling back to posgro's; `{storeId}` substituted in the link.
- [x] Grant adds `account`: `balanceUzs`, `monthlyFeeUzs`, `nextChargeAt`, `owedUzs` (from `BillingService.nextCharge`; null fields for TRIAL/VIP), `asOf`, and the last 10 movements `{type: TOPUP|SUBSCRIPTION|ADJUSTMENT, amountUzs, balanceAfterUzs, at}` (no admin notes, no AI scans). Only to the restaurant's own licensed till (activate/complete/renew).
- [x] Tests (config normalize + fallback, account in grant, no admin notes, wizard support phone); posgro full suite 1603 passed, server + web typecheck clean.
- [ ] Staging deploy and a till against staging before main.

### SavdoChef (0.7.0: has a migration)
- [x] Migration 0013 (additive): `license_state.account` and `license_state.payment` (nullable JSON text), so the last known balance and pay details survive restarts and offline days.
- [x] `license-service`: grant schema accepts `payment.qrPayload` (≤ 512) and `account` (all optional, an older server still works); stored on accept; `LicenseStatusDto.account` + `payment.qrPayload`.
- [x] Settings → Obuna: balance card (balance, monthly fee, next charge date/amount, owed in red, "holat: <time>" since it may be offline) and the movements table; "To'lash" button.
- [x] Pay window: QR of `qrPayload` (else of the pay link), the link as text, the amount to pay (owed, else the monthly fee), "To'lov izohiga yozing: <storeId>", support phone, and "after paying press Tekshirish" (top-ups are recorded by hand; the till checks every 6 h, at start and on Tekshirish).
- [x] Banner (warning/grace/read-only) gets a "To'lash" link for users with `settings`; others keep "Administratorga murojaat qiling".
- [x] Main never opens the link (no shell.openExternal): shown and as QR only. Strings escaped, QR drawn by our code. Reviews: migration-reviewer, electron-security-reviewer.
- [x] Tests (account + QR persisted across restart, same licence with a newer bill, broken account ignored without losing the licence); `npm run check` 487. Harness `smoke-bill.cjs` on a copy of the café data (v12 -> v13) against a stand-in server signing with the real key: grace + 75 000 owed -> banner "To'lash", pay window (amount, QR drawn, ID 1001, link, phone), Obuna card; after a top-up -> renewed 30 days, balance 25 000, movements; uz and ru. Fixed: a past charge date was shown as "next charge" while owed.
- [x] Reviews: migration-reviewer SAFE TO APPLY. electron-security-reviewer, all fixed: `license:status` and `license:checkNow` now hide ids, bill and pay details from the lock screen and staff alike (one `statusFor` in handlers.ts; the fixture carries real values so the test can fail); pay fields held to shape on the till and in posgro's config (https link, phone characters, no control/bidi characters; a bad field dropped alone); the bank QR's text shown under it; QR text encoded as UTF-8 (Cyrillic payee). `npm run check` 489, posgro 1603.
- [ ] Against staging.

**Before it is useful in production:** you fill in SavdoChef's payment details (QR string / pay link / support phone) in the dashboard. Order: posgro to staging → test → main; then SavdoChef 0.7.0 release + deploy.
