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

## Feature F7: restaurant balance and paying the monthly bill on the till (built 2026-10-21; committed: SavdoChef `3830df9`, posgro `cbdaa7f` merged into dev `aa29ea8`, staging deployed)

**Answered:** top-up stays manual like posgro (the restaurant pays by QR/link with its store ID in the note; the super admin records the top-up in the dashboard, which already renews the month at once); SavdoChef gets its own payment details (fallback: posgro's); the till shows balance + next charge, a pay window with QR, and the last balance movements.

**Already there (posgro):** `Store.balance` + `BalanceTransaction` ledger, `BillingService` charging STARTER/PRO SavdoChef restaurants from the balance at expiry (negative → grace → block; a top-up renews), dashboard SavdoChef store page with balance, ledger and top-up. The grant already carries `payment {qrPayload, paymentUrl, supportPhone}`, but from posgro's settings, and production's are empty. The till keeps only paymentUrl/supportPhone, in memory.

### posgro (branch `feat/savdochef-billing` off `dev`; additive, behind `SAVDOCHEF_ENABLED` like all SavdoChef routes)
- [x] `savdochef_config.payment {qrPayload, paymentUrl, supportPhone}` (defaults empty, normalized, lengths capped); SavdoChef settings page in the dashboard edits them. Grant and `/savdochef/plans` use them, each field falling back to posgro's; `{storeId}` substituted in the link.
- [x] Grant adds `account`: `balanceUzs`, `monthlyFeeUzs`, `nextChargeAt`, `owedUzs` (from `BillingService.nextCharge`; null fields for TRIAL/VIP), `asOf`, and the last 10 movements `{type: TOPUP|SUBSCRIPTION|ADJUSTMENT, amountUzs, balanceAfterUzs, at}` (no admin notes, no AI scans). Only to the restaurant's own licensed till (activate/complete/renew).
- [x] Tests (config normalize + fallback, account in grant, no admin notes, wizard support phone); posgro full suite 1603 passed, server + web typecheck clean.
- [x] Staging deploy (dev `aa29ea8`, CI + deploy green) and a till against staging: restaurant 1002 checked in, got its account (trial, balance 0) and the support phone from POSGRO's settings (SavdoChef's own still empty).

### SavdoChef (0.7.0: has a migration)
- [x] Migration 0013 (additive): `license_state.account` and `license_state.payment` (nullable JSON text), so the last known balance and pay details survive restarts and offline days.
- [x] `license-service`: grant schema accepts `payment.qrPayload` (≤ 512) and `account` (all optional, an older server still works); stored on accept; `LicenseStatusDto.account` + `payment.qrPayload`.
- [x] Settings → Obuna: balance card (balance, monthly fee, next charge date/amount, owed in red, "holat: <time>" since it may be offline) and the movements table; "To'lash" button.
- [x] Pay window: QR of `qrPayload` (else of the pay link), the link as text, the amount to pay (owed, else the monthly fee), "To'lov izohiga yozing: <storeId>", support phone, and "after paying press Tekshirish" (top-ups are recorded by hand; the till checks every 6 h, at start and on Tekshirish).
- [x] Banner (warning/grace/read-only) gets a "To'lash" link for users with `settings`; others keep "Administratorga murojaat qiling".
- [x] Main never opens the link (no shell.openExternal): shown and as QR only. Strings escaped, QR drawn by our code. Reviews: migration-reviewer, electron-security-reviewer.
- [x] Tests (account + QR persisted across restart, same licence with a newer bill, broken account ignored without losing the licence); `npm run check` 487. Harness `smoke-bill.cjs` on a copy of the café data (v12 -> v13) against a stand-in server signing with the real key: grace + 75 000 owed -> banner "To'lash", pay window (amount, QR drawn, ID 1001, link, phone), Obuna card; after a top-up -> renewed 30 days, balance 25 000, movements; uz and ru. Fixed: a past charge date was shown as "next charge" while owed.
- [x] Reviews: migration-reviewer SAFE TO APPLY. electron-security-reviewer, all fixed: `license:status` and `license:checkNow` now hide ids, bill and pay details from the lock screen and staff alike (one `statusFor` in handlers.ts; the fixture carries real values so the test can fail); pay fields held to shape on the till and in posgro's config (https link, phone characters, no control/bidi characters; a bad field dropped alone); the bank QR's text shown under it; QR text encoded as UTF-8 (Cyrillic payee). `npm run check` 489, posgro 1603.
- [x] Against staging (above). Still open: a top-up on staging seen on the till (needs the super admin in the staging dashboard); then posgro to main, SavdoChef payment details in production, SavdoChef 0.7.0 release + deploy.

**Before it is useful in production:** you fill in SavdoChef's payment details (QR string / pay link / support phone) in the dashboard. Order: posgro to staging → test → main; then SavdoChef 0.7.0 release + deploy.

## Feature F8: card transfer as the second way to pay (approved 2026-10-22 with the recommendations; built, not committed, nothing deployed; posgro on branch `feat/payment-card`)

**Asked:** in the posgro dashboard, "Payment Details" (Subscription Plans page, POSGRO grocery tills) and "How restaurants pay" (SavdoChef page) get a second option: a card picture (e.g. Hamkorbank Humo) with the card number and owner's full name written on it, and the note to put the store / restaurant ID in the transfer comment.

**Answered:** the dashboard bakes number + name into one picture (browser canvas) on save; both tills show it (posgro POS login dialogs and SavdoChef's To'lash window); the pay window shows two numbered blocks side by side: "1. QR / havola" and "2. Kartaga o'tkazma", each only when filled in.

**Copied from:** F7 pay details end to end (`savdochef-config.ts` `paymentFor` fallback, `paymentAnswer` in `license-service.ts`, `pay-bill.ts`); the dashboard's existing `POST /site-config/upload-image` + `siteConfig.uploadImage` (login banners); posgro POS `subscription-handlers.ts` cache, which already stores the QR as a ready data URL for offline opens; SavdoChef `images/image-store.ts` (`sniffImage`, random names in `userData/img`, shown via `savdochef-img:`).

### Design

- New payment fields (both configs): `cardNumber` (16 digits, stored without spaces), `cardHolder` (max 60, Latin/Cyrillic letters, space, `.'-`), `cardBaseImage` (the bare picture you uploaded, `/uploads/<name>`, dashboard only, so number/name can be changed later and re-baked), `cardImage` (the baked JPEG, `/uploads/card-<time>.jpg`). All default `''`. The card counts only when number + baked image are both set.
- Fallback stays as in F7 but **per block, not per field**: SavdoChef uses its own card if it has one, else POSGRO's whole card (never SavdoChef's number on POSGRO's picture).
- Dashboard: in each section a "Karta orqali" block: pick an image (JPEG/PNG ≤ 5 MB) → uploaded at once as the base; inputs for number and name; a live preview (canvas: number centred at ~60 % height in `0000 0000 0000 0000` groups, name bottom-left at ~88 %, font size relative to the picture's width, colour black or white per Q2). Save bakes the canvas to JPEG (quality 0.9, max 1200 px wide), uploads it, then saves the config with `cardImage`. "Remove card" clears all four.
- Image to tills (Q1): the server sends only the path `/uploads/card-….jpg` plus number and name. Each till downloads the picture **only when the path changes**, from its own configured server URL (never a host the answer names: path must match `^/uploads/card-[0-9]+\.jpg$`), checks the first bytes are JPEG and the size ≤ 1 MB, and keeps it. Offline the last picture keeps showing. A failed download leaves the number + name as text, no picture.
- Number and name are also shown as plain text under the picture (number in groups, copyable) so the cashier can type them into a bank app.
- Under the card block: "Izohda do'kon/restoran ID sini yozing: **1002**" (same strong ID as block 1).
- No money or stock logic changes: payments stay manual (super admin records the top-up); nothing on the till computes with these fields.

### posgro server (branch `feat/payment-card` → `dev` → staging; `main` only after your OK)

- [x] `site-config.service.ts` `SubscriptionPayment` + `DEFAULT_PAYMENT`: the four card fields, normalized on read and write (old stored JSON without them → `''`). `SubscriptionPaymentDto`: four `@IsOptional() @IsString()` fields (the global `whitelist` would strip undecorated ones). Absent in a PUT = keep the stored value (an older dashboard tab must not wipe the card).
- [x] `savdochef-config.ts` `SavdochefPayment` + `PAYMENT_LIMITS` + validators (`cardNumber` `^\d{16}$`, `cardHolder` letters, image paths `^/uploads/[\w.-]+\.(jpg|jpeg|png|webp)$`, baked `^/uploads/card-\d+\.jpg$`); `paymentFor` falls back per block.
- [x] Upload: `upload-image` gets an optional `?kind=card` naming the file `card-<time>.jpg` (and accepting only image/jpeg for it); everything else unchanged.
- [x] Out to tills (additive only, N-1 safe): `store-config.controller.ts` `payment` gains `card_number`, `card_holder`, `card_image` (posgro POS, snake_case like its siblings); SavdoChef grant `payment` gains `cardNumber`, `cardHolder`, `cardImage`. `cardBaseImage` never leaves the server. Old tills ignore the extra keys (posgro POS reads named keys; SavdoChef's zod object strips unknown keys).
- [x] Tests: `savdochef-config` normalize + per-block fallback + bad values dropped; `site-config` round trip with and without card fields (old JSON); grant carries the card and never `cardBaseImage` (store-config: no controller test exists; covered through `tillCard`); full suite + `npx tsc --noEmit` + lint.

### posgro web dashboard

- [x] `api/client.ts`: types for the four fields; `uploadImage(file, kind?)`.
- [x] New `components/PaymentCardEditor.tsx` (one component for both pages): upload, inputs, canvas preview, `bake()` → Blob. Same-origin `/uploads` image, so the canvas is not tainted.
- [x] `SubscriptionPlansPage.tsx` "Payment Details" and `SavdochefPage.tsx` "How restaurants pay": add the editor as option 2; on Save bake + upload first, then save config (one Save button as now). Hints updated ("empty SavdoChef card uses the POSGRO card").
- [ ] `npx tsc` for web; check it in the browser against local/staging (screenshots of both sections, with the Hamkorbank picture).

### posgro POS (grocery till) — version 1.38.2 → 1.38.3 (`npm version patch --no-git-tag-version`)

- [x] `subscription-handlers.ts`: read `card_*`; cache gains `cardNumber`, `cardHolder`, `cardImageUrl` (the server path) and `cardImageDataUrl` (downloaded once via the existing server base URL, JPEG-sniffed, ≤ 1 MB, stored as a data URL like `qrDataUrl`, so offline opens cost nothing). Optional fields: an old cache still reads.
- [x] `StoreSubscription['payment']` (shared type, additive) gains `card: { number, holder, imageDataUrl } | null`.
- [x] `TerminalAccessBar.tsx` subscription dialog and `LicenseBlockPanel.tsx`: block "2. Kartaga o'tkazma" with the picture, number, name and "Izohda do'kon ID sini yozing: N". uz + ru keys in its locales.
- [x] Tests: handler test for the card (download once, reuse on same path, bad bytes → no picture, old server without fields → `card: null`). Compile check `npx cross-env APP_MODE=pos electron-vite build`. Installer + deploy stay yours.

### SavdoChef (goes into 0.7.0 with F7: minor, no migration)

- [x] **No schema change:** the card lives in the existing `license_state.payment` JSON column (F7, migration 0013); the picture is a file in `userData/img` (existing image dir). Installed databases are untouched.
- [x] `shared/license.ts` `LicensePaymentDto` gains `card: { number: string; holder: string; image: string | null } | null` (`image` = file name for `savdochef-img://img/<name>`).
- [x] `main/license/license-service.ts`: `paymentAnswer` accepts `cardNumber`/`cardHolder`/`cardImage` (same `.catch('')` per field; card dropped as a block if the number is bad). After a successful grant, if `cardImage` differs from the stored one: fetch it with the existing `httpClient` (timeout, no redirects, base URL from config), cap 1 MB, `sniffImage` must say jpg, write under a random name via an `image-store` helper, delete the previous card file. Failures are logged and leave the card as text. Never blocks or fails the check-in.
- [x] `license:status` keeps hiding pay details from the lock screen and staff (`statusFor` in handlers.ts) — the card goes through the same gate. No new IPC channel.
- [x] `renderer/components/pay-bill.ts`: two numbered blocks side by side (`.pay-bill-option`), card block = picture (`<img src="savdochef-img://img/…">`), number in groups, name, "write the ID" note; stacks on narrow windows. CSS in `styles/` (no inline style, CSP).
- [x] Strings uz + ru: `bill.optionQr` ("1. QR yoki havola orqali" / "1. По QR или ссылке"), `bill.optionCard` ("2. Kartaga o'tkazma" / "2. Перевод на карту"), `bill.cardNumber`, `bill.cardHolder`, `bill.cardWriteId` ("O'tkazma izohiga restoran ID sini yozing:" / "В комментарии к переводу укажите ID ресторана:").
- [x] Tests: `license.test.ts` card persisted across restart, downloaded once, re-downloaded on a new path, refused when not JPEG / too big / path not `/uploads/card-…` (no request made), check-in still succeeds when the download fails; `secrets.test.ts`/access fixture carries a card so hiding it is tested. `npm run check`.
- [x] Real app: `npm run build`, harness `smoke-card.cjs` on a scratch copy of the café data against the stand-in server (as `smoke-bill.cjs`), serving the Hamkorbank picture baked with a test number: screenshots of the To'lash window uz + ru, with and without QR, offline after a restart (picture from disk).
- [x] Reviews: electron-security-reviewer (main now downloads a file from the server and the renderer shows it).

### Order

posgro server + dashboard → `dev` → staging; you upload the card in the staging dashboard and check both tills against staging → your OK → `main`. Then the posgro POS installer (yours) and SavdoChef 0.7.0 release + deploy (with F7).


### Done so far (2026-10-22)

- Answers taken: download once per change; black/white switch (preset from the picture's brightness); 16 digits; fixed spots; holder in capitals; QR/link and card side by side when both exist.
- posgro: server tsc + web tsc clean, lint 0 errors, full jest 1616 passed (before the review fixes; POS handler suite 28 after them), POS compile check `APP_MODE=pos electron-vite build` OK, version 1.38.3. Not done: a store-config controller test (no existing harness for it), the dashboard editor not opened in a browser yet (needs staging or a local server).
- SavdoChef: `npm run check` 495 tests. Harness `smoke-card.cjs` on a copy of the café data against a stand-in server: the Hamkorbank picture baked with the dashboard's drawing, downloaded once, reused on the next check-in, shown in To'lash card-only and beside the QR, uz and ru; after a restart with no server the picture comes from disk and the startup orphan cleanup keeps it.
- electron-security-reviewer: no high findings. Fixed: download cap counted while streaming + `Accept-Encoding: identity` (also in the posgro POS), replaced card picture deleted at once, picture re-downloaded when number/holder change under the same path, JPEG-only error text. Left as a design note: the card number travels beside the signed licence (TLS only), like the F7 pay fields.
- Open: confirm `https://api.posgro.uz/uploads/card-*.jpg` is served (the tills fetch the picture from the API host, the dashboard uses `/uploads` on its own host).

### Open questions (answered)

1. Picture to the tills: download once per change from `/uploads` (recommended, above), or inline the JPEG (~100 KB) in every check-in/store-config answer (simpler, no download code, heavier on every call)?
2. Text colour on the card: a black/white switch in the editor (recommended; black reads on the green Hamkorbank card), or always black?
3. Card numbers: 16 digits only (Humo/Uzcard/Visa), or allow other lengths?
4. Should the editor also let you drag the number/name to other spots, or are the fixed spots (number centre, name bottom-left, like a real card) enough?
5. Owner name: shown in capitals like an embossed card (e.g. `BOBURMIRZO ERGASHEV`), or as typed?
6. When the card is set, should option 1 (QR/link) still show if it is also filled in, i.e. both side by side (assumed yes)?

## Feature F9: amount in words under money fields, pre-bill ("Hisob") print (approved 2026-10-22 with the recommendations; built, not committed)

Two independent parts; A needs no schema change, B adds one table.

### A. Amount hint (posgro `amountHint`, `src/shared/utils/transformers.ts`, used under every cash field of `SmenaPage.tsx`)

Under a money input, live as it is typed: `1 250 000 so'm — bir million ikki yuz ellik ming` (ru: `1 250 000 сум — один миллион двести пятьдесят тысяч`). Empty or 0 shows nothing. Display only: values sent to main are unchanged.

- [x] `src/shared/utils/amount-words.ts`: `amountInWords(value: DecimalString, lang)` ported from posgro `numberToWordsUz/Ru` (whole so'm; tiyin dropped as the till never takes them), Decimal input, no float math; amounts above 999 999 999 999 show digits only.
- [x] `amount-words.test.ts`: 0, 1, 11, 21, 100, 101, 1 000 (uz `ming`, ru `одна тысяча`), 2 000 / 5 000 (ru plural `две тысячи` / `пять тысяч`), 1 250 000, 12 000 000, `1 250 000,50`, spaces and comma typed.
- [x] `renderer/components/forms.ts`: `withAmountHint(input)` adds a `<p class="amount-hint" aria-live="polite">` after the input and updates it on `input` (and when code sets `.value`, through an `update()` it returns); `field({ ..., amount: true })` uses it. Text via `formatMoney` + `amountInWords`, through `textContent`.
- [x] CSS `.amount-hint` in `renderer/styles/` (small, muted, italic, fixed min-height so the form does not jump), tokens only.
- [x] Wire every money input (13 places): menu price + cost price (`menu-modals.ts`); weight modal price (`weight-modal.ts`, set by code from kg -> `update()`); delivery fee (`customer-panel.ts`); default delivery fee (`settings/orders-section.ts`); payment received + each split line (`tender-editor.ts`, set by "Qolgan" -> `update()`); debt repay + write-off (`debtors-view.ts`); shift opening cash (`quantities-modal.ts`); cash in/out (`cash-panel.ts`); counted cash at close (`close-modal.ts`). Not quantities, PIN, table numbers, phone.

### B. Pre-bill ("Hisob" / "Счёт"): the guest asks for the total, nothing is paid

Behaviour: prints the saved pending order with a clear "HISOB · TO'LOV CHEKI EMAS" heading, lines and total, no payment block, time = now. Changes no order, money, stock or shift data (before = after for every table). A completed or cancelled order is refused (completed already has its receipt in Cheklar).

- [x] Schema (skill `prisma-migration`, then agent `migration-reviewer`): new singleton table `pre_bill_layout` (`id` = 1, `showAddress`, `showPhone`, `showDateTime`, `showOrderNumber`, `footerNote` default '', `topImage`/`topImageWidth`, `bottomImage`/`bottomImageWidth`, `updatedAt`), migration `0014_pre_bill_layout.ts`. Additive: installed databases get an empty table; no row = General's switches with **no pictures** (so the logo is off until the owner turns it on). Why a table and not a 4th `receipt_layouts` row: its key is the `OrderType` enum and Prisma would fail reading an unknown value.
- [x] `shared/schemas.ts`: `preBillLayoutValues` (same rules as `receiptLayoutValues` minus `showCustomer`), `updatePreBillLayoutInput`, `printPreBillInput { orderId }`, preview input gains `kind: 'receipt' | 'preBill'` (default receipt).
- [x] `shared/types.ts`: `PreBillLayoutDto`.
- [x] `shared/ipc.ts` + `IPC_CHANNELS`: `receipt:preBillLayout` (read, `settings`), `receipt:updatePreBillLayout` (`settings`, emits SETTINGS), `printing:printPreBill` (`user`, same as `printing:printReceipt`; read-only list). Access snapshot in `ipc.test.ts` updated.
- [x] `main/printing/layouts.ts`: `getPreBillLayout`, `updatePreBillLayout` (pictures refused without the `receiptLogos` plan feature, as now); `receiptImageNames` includes its pictures so the image cleanup keeps them.
- [x] `main/printing/receipt.ts`: `buildReceiptHtml(..., { preBill: true })`: heading + "not a payment receipt" line, payment block left out, `printedAt` = now; labels uz/ru in `LABELS`.
- [x] `main/printing/printing.ts`: `printPreBill(db, printer, orderId, image)` (pending only, refuses `Bekor qilingan…` / `To'langan buyurtma uchun hisob chiqarilmaydi`), `printTestReceipt`/`previewReceipt` handle the pre-bill kind with the sample order.
- [x] `main/ipc/handlers.ts`, `events.ts` entries.
- [x] Renderer `views/order/print-receipt.ts`: `printPreBill(orderId)`, fire-and-toast like `printReceipt`.
- [x] Table grid (`views/tables.ts`): printer icon button beside the move button on busy cards (same `table-cell`, shown to any logged-in user; move stays `orders`-only). Takeaway/delivery cards in the open strip get it too? (question 3)
- [x] Order page (`views/order/order-view.ts`): "Hisob" button in the actions with a printer icon; disabled while unsaved or stale, like Pay/Move, title "save first".
- [x] Settings → Receipt (`settings/receipt-section.ts`): fourth tab "Hisob" with its switches, footer, pictures, test print and live preview (same form, no customer switch); notice that it starts without pictures.
- [x] Icon `printer` in `ui/icons.ts` if not there (lucide).
- [x] i18n uz + ru: `preBill.button`, `preBill.printed`, `preBill.tab`, `preBill.hint`, `preBill.noPicturesDefault`, `preBill.saveFirst`, table-card aria label.

### Tests

- [x] `printing.test.ts`: pre-bill of a pending order prints heading, lines, total, no payment block; completed/cancelled refused; order, payments, session quantities identical before/after; layout defaults (no row -> General switches, no pictures); pictures refused without the plan feature; `receiptImageNames` keeps pre-bill pictures.
- [x] `layouts.test.ts`: save/read the pre-bill layout.
- [x] `database.test.ts` drift check passes with 0014; upgrade of a v13 copy keeps data.
- [x] `ipc.test.ts` access snapshot, `events.test.ts`, `secrets.test.ts` cover the 3 channels.
- [x] `amount-words.test.ts` (above). `npm run check`.

### Verify in the real app

- [x] `npm run build`, harness on a scratch copy of the café data: amount hints in the payment window (single + split, after "Qolgan"), shift open/close, cash in, menu dish, uz + ru screenshots.
- [x] Busy table -> printer icon -> pre-bill printed to the default printer (or "Microsoft Print to PDF" and look at the file); same from the order page; button disabled with unsaved lines.
- [x] Settings -> Receipt -> Hisob tab: preview without logo by default, with logo after turning it on; test print.
- [x] Migration on the copy: v13 -> v14 with backup in `backups/`.
- [x] Reviews: `migration-reviewer`, `electron-security-reviewer` (new print channel, settings form), `prisma-reviewer` (printing reads orders).

### Version

0.7.0 -> **0.8.0** (minor: new features + a migration). Commit/release only when asked.

### Open questions (answered: 1 one layout, 2 log only, 3 tables only (order page covers takeaway/delivery), 4 any user, 5 wording as proposed, 6 split lines too)

1. Pre-bill layout: one for all order types (recommended), or one per type like the receipt (General / takeaway / delivery)?
2. Should each pre-bill print be counted on the order (shown in Cheklar, e.g. "Hisob 2 marta chiqarildi"), to spot a guest paying cash on a bill that is later cancelled? That adds a column; recommended: not now, log only.
3. Printer icon also on takeaway/delivery cards in the open-orders strip, or tables only (delivery already prints on every save)?
4. Who may print it: any logged-in user (recommended, as receipts now), or only users with `orders` / `payments`?
5. Heading text: "HISOB · To'lov cheki emas" / "СЧЁТ · Не является чеком оплаты" — OK, or your wording?
6. Amount hint for the split payment lines too (four inputs in a row, the hint makes the window taller), or only the single "Olingan" field?

### Verified (2026-10-22)

- `npm run check`; harness `smoke-f9.cjs` on a copy of the café data (scratch userData, prints intercepted as PNG): start migrated v13 -> v14 with a `savdochef-v13-*` backup; table card printer -> pre-bill printed (HISOB · To'lov cheki emas, lines, total, no payment block, no logo); order page Hisob button -> printed, order unchanged after both; hints in payment received, split lines (also after Bo'lib to'lash), Kirim (1 001 000 -> bir million bir ming); Settings -> Chek -> Hisob tab with notice, no customer switch, preview and test print; ru: Счёт button, `5 000 сум — пять тысяч`.
- Not exercised in the harness: Hisob disabled with unsaved lines (same condition as To'lov), takeaway/delivery order page. Still to do at release: install 0.7.0, run on a data copy, install 0.8.0 over it, compare counts (`npm run release -- minor`).
- Reviews: migration-reviewer safe; electron-security-reviewer no high/medium (pre-bill request now logged before printing, refused ones too); prisma-reviewer no bugs (allow-list on pending, exact total asserted, `bir million bir ming`). Left: layout save not in a transaction (same as receipt layouts, one till).

## F10 category pictures + image switches, F11 kitchen printers, F12 satellite till (approved 2026-11-08)

Builds on F9 (built, not committed, 0.8.0). Three separate commits, two releases: F10 + F11 together (one migration, 0015), then F12 (migration 0016). Answers: every (R) recommendation accepted **except question 2: a satellite's receipt and pre-bill always print on the main printer** (no local printing on satellites).

### F10. Category pictures and image switches

Copied from: the dish picture (`MenuItem.imageFile`, `menu:pickImage`, preview/remove in `menu-modals.ts`, `thumb()` in `order-view.ts`, orphan cleanup in `main/index.ts`).

- [x] Schema: `categories.imageFile TEXT NULL` (a file name in userData/img, never a path), in migration `0015_kitchen_printers.ts` (shared with F11). Installed databases: every category gets NULL, so no picture and the same look as today.
- [x] Settings (key/value, so no migration): `show_category_images` and `show_menu_images`, both defaulting to `true` in `seed.ts DEFAULT_SETTINGS`. Add `AppSettings.showCategoryImages / showMenuImages`, `SETTING_KEYS`, `updateSettingsInput`. One setting for the whole restaurant (R, question 5).
- [x] `shared/schemas.ts`: `categoryFields.imageFile` (same rule as dishes). `shared/types.ts`: `CategoryDto.imageFile`.
- [x] `main/menu/categories.ts`: read and write `imageFile`. No new channel: the picker is `menu:pickImage` (it only stores the file; access `menu`).
- [x] `main/index.ts` orphan cleanup also keeps `categories.imageFile`.
- [x] Renderer: the category modal in `menu-modals.ts` gets the picture block (pick/remove/preview) and the menu-view category list shows the thumb. Order screen (`order-view.ts`): category chips show picture + name when `showCategoryImages` is on (fallback icon). Dish tiles and line thumbs hide pictures when `showMenuImages` is off (compact text tiles). The menu admin screen always shows pictures (R). Both views re-render on `settings-changed`.
- [x] Settings → Buyurtmalar (`orders-section.ts`): two checkboxes, "Kategoriya rasmlari" and "Taom rasmlari".
- [x] CSS: `.chip-with-image` and `.dish-tile.no-image` in `views.css`, tokens only.
- [x] i18n uz + ru: `menu.categoryImage`, `settings.showCategoryImages`, `settings.showMenuImages`, hints.
- [x] Tests: `menu.test.ts` category imageFile create/update/clear; `settings.test.ts` defaults true and round-trips; orphan cleanup keeps category pictures.
- Money/stock: none.

### F11. Main printer + extra (kitchen/bar) printers, ticket on order save

Copied from: `printing/printer.ts` (`pickPrinter`, hidden sandboxed window, timeout), `receipt.ts` (escaped HTML builder, own CSP), `printer-section.ts` (Windows printer list + refresh), fire-and-toast from `print-receipt.ts`.

**Behaviour**
- Settings → Printer: first the **main printer** (a Windows printer + optional name, e.g. "Kassa"). It prints the payment receipt, pre-bill, shift reports and test prints, as `receipt_settings.printerName` does today. Below it, a list of **extra printers** (a Windows printer from the list + optional name, e.g. "Oshxona", "Bar") with add/edit/hide and a test ticket for each.
- Dish form (create/edit): "Printer" select with none / main printer / each extra printer. A new dish defaults to none (R, question 4).
- On `orders:save` and `orders:saveOpen` (the Save button), main compares old and new lines per dish (quantity, units/kg, portion) inside the save transaction. It writes **one kitchen ticket per printer** holding only what changed: additions (+qty), plus a "BEKOR / ОТМЕНА −qty" block for lines that were reduced or removed (R, question 3). Unchanged dishes print nothing. A save with no changes prints nothing. Dishes without a printer print nothing.
- Ticket (80 mm, big font, no prices): header "YANGI BUYURTMA" on the first save, "QO'SHIMCHA" on later saves; table number + hall (takeaway/delivery: "Olib ketish" / "Yetkazish" + order number, R question 6); order number; waiter = the user who pressed Save (`actor.fullName`); time; printer name; lines such as `2 × Osh (0.7)` and `1 × Shashlik 0.450 kg`. Language = the receipt language.
- Printing runs in main after the commit, in the background, and never blocks or fails the save (hardware rule). Each ticket row records `printedAt` or `error`. A failure raises `kitchen-changed`, and the renderer shows the toast "Oshxona printeri: chop etilmadi" with a "Qayta" (reprint) action. Tickets still unprinted at a restart are not reprinted automatically, so the kitchen never cooks twice; they print only on request.
- Cancelling a whole pending order (`orders:cancel`, `orders:cancelOpen`) prints a "BEKOR" ticket to every printer that had lines on it. Moving a table prints a short "STOL O'ZGARDI 5 → 8" ticket to those printers (R, question 6).

**Schema (migration 0015, additive; then agent `migration-reviewer`)**
- [x] `printers`: `id`, `label TEXT NULL`, `windowsName TEXT NULL` (null = auto-pick, main only), `isMain BOOLEAN DEFAULT false`, `mainGuard INTEGER NULL UNIQUE` (1 on the main row, so only one main printer; same trick as `openGuard`, kept by a trigger), `isActive`, `sortOrder`, timestamps.
- [x] The migration fills in the main row from `receipt_settings.printerName` (null stays null = auto), so the upgrade changes nothing. `receipt_settings.printerName` stays and follows the main printer, so an older build after a rollback still prints to the right printer.
- [x] `menu_items.printerId INTEGER NULL REFERENCES printers(id) ON DELETE SET NULL` + index. Existing dishes: NULL = no kitchen ticket = today's behaviour.
- [x] `kitchen_tickets`: `id`, `orderId` (FK, Restrict), `printerId` (FK), `kind` (NEW/ADD/CANCEL/MOVE), `payload TEXT` (JSON header + lines, frozen at save), `createdById`, `createdAt`, `printedAt NULL`, `error NULL`. Indexes on `printedAt` and `orderId`. It is the source for reprints and the record of what the kitchen was told.
- [x] `categories.imageFile` (F10).
- [x] `database.test.ts` drift check. Upgrade test on a v14 copy: the main printer row equals the old printerName and every dish has printerId NULL.

**Shared → main → renderer**
- [x] `shared/schemas.ts`: `printerInput {label?, windowsName?}`, `updatePrinterInput`, `setMainPrinterInput`, `menuItemFields.printerId: id.nullable().optional()`, `reprintKitchenInput {ticketId}`, `testPrinterInput {printerId}`.
- [x] `shared/types.ts`: `PrinterDto {id,label,windowsName,isMain,isActive}`, `MenuItemDto.printerId`, `KitchenTicketDto` (failed list), `AppEvent 'kitchen-changed'`.
- [x] New channels in `shared/ipc.ts` + `IPC_CHANNELS`, with access:
  - `printers:list` (`user`, read-only: the dish form and the toasts need the names)
  - `printers:create`, `printers:update`, `printers:setMain` (`settings`, emit SETTINGS)
  - `printing:testPrinter` (`settings`, read-only list)
  - `kitchen:failed` (`orders`, read-only)
  - `kitchen:reprint` (`orders`, emits `kitchen-changed`)
  - Update the `ipc.test.ts` access snapshot, `events.ts` and `secrets.test.ts`.
- [x] `main/printing/printers.ts` (new domain, no Electron): list/create/update/setMain; keeps `receipt_settings.printerName` in step; `mainPrinterName(db)`, which `printing.ts` uses in place of `settings.printerName`.
- [x] `main/printing/kitchen.ts` (no Electron): pure `diffLines(oldItems, newLines)` (Decimal, keyed by dish + portion + weight); `writeTickets(tx, actor, order, diff)`; `buildKitchenTicketHtml(ticket, lang)` (escaped, own CSP, like receipt.ts); `printPendingTickets(db, printer, ids)`.
- [x] `main/orders/orders.ts`: `saveTableOrder`, `saveOpenOrder`, `cancelTableOrder`, `cancelOpenOrder` and `moveTableOrder` call `writeTickets` inside their existing transaction and return the new ticket ids next to the order (internal, not in `OrderDto`). Stock, totals and versions are untouched.
- [x] `main/ipc/handlers.ts`: after a successful save, `void printKitchen(ids)` in main (logs, records the error, broadcasts `kitchen-changed`). `PrinterService.print` gets an exact-device mode for kitchen tickets with no auto-pick fallback to the receipt printer: a ticket for a printer that is gone fails loudly (R).
- [x] Renderer: rebuild `printer-section.ts` (main printer card + table of extra printers with add/edit/test/hide); printer select in the `menu-modals.ts` dish form; `order-view.ts`/`tables.ts` subscribe to `kitchen-changed` and toast failures with "Qayta"; printer-name column in the menu list.
- [x] i18n uz + ru: `printers.*` (main, extra, label, add, test, hidden, none), `kitchen.*` (new, add, cancel, moved, failed, reprint, waiter, table), the dish form label.

**Money/stock before → after:** no change. Totals, stock reservation (`priceAndReserve`), versions and payments are byte-for-byte the same. The only new writes in the save transaction are `kitchen_tickets` rows. A test asserts that session quantities and order totals are identical with and without dish printers. Agent `prisma-reviewer` because `orders.ts` changes.

**Tests**
- [x] `kitchen.test.ts`: diff cases (new order, add qty, reduce, remove, portion change = cancel old + add new, weight change, no change = no ticket, dish without printer skipped, split across two printers); ticket HTML escapes names and shows table/waiter/time; takeaway header.
- [x] `orders.test.ts`: save writes tickets in the same transaction (rolled back on a stock shortage or a stale version, so no ticket); cancel and move tickets; stock and totals unchanged.
- [x] `printers.test.ts`: only one main (trigger); setMain keeps `receipt_settings.printerName` in step; hiding a printer leaves dishes' printerId set, its tickets fail loudly, and the select shows "(yashirilgan)".
- [x] `printing.test.ts`: receipt and pre-bill go to the main printer row; with a fake PrinterService, the handler prints kitchen tickets after save and records failures without failing the save.

### F10 + F11 built (2026-11-08, not committed)

- Changes from the plan: a **hidden** printer gets no tickets (the owner hid it on purpose) instead of failing loudly; tickets for later saves are `ADD` per printer even when that printer had no earlier ticket for the order, and CANCEL/MOVE go to the dishes' current printers (prisma-reviewer note 7, accepted and written down here); a whole portion ("1") and no portion count as the same line.
- Review fixes: exact printer match for kitchen printers (no substring, no "every printer" match for a Cyrillic name; receipts skip the loose match for such names too); the paper-out record cannot turn into "failed"; never-tried tickets (> 2 min) are listed for "Qayta"; reprint refuses printed, hidden-printer and > 12 h tickets; handlers hand tickets to the printer in `finally`; receipt printer name + main printer row written in one transaction; making another printer main is refused while dishes use a main printer without a name; the whole print job is bounded (timeout text says it may have printed); the printer-list window is locked down; secrets test sees a real failed ticket.
- Checks: `npm run check` 42 suites / 564 tests. Reviews: migration-reviewer (safe), prisma-reviewer (no stock/money change; risks fixed above), electron-security-reviewer (no high; the medium exact-match issue fixed).
- Real app (`npm run build`, harness `smoke-f11.cjs` + `smoke-f10.cjs` on a copy of the cafe data in a scratch userData, Windows printers faked and every print saved as PNG): v14 -> v15 with a `savdochef-v14-*` backup; main printer row = old receipt printer, renamed "Kassa"; Oshxona + Bar added; dishes assigned; table order through the UI -> YANGI BUYURTMA on Kitchen-80 and Bar-58 (table, hall, waiter, time); later save -> QO'SHIMCHA (+1) on the kitchen and O'ZGARISH/BEKOR on the bar; bar offline -> save succeeds, toast "Bar: 1-stol cheki chiqmadi ... Qayta", Qayta -> printed, failed list empty; pre-bill on XP-80C (main); move -> STOL O'ZGARDI 1 -> 2 on both; cancel -> BUYURTMA BEKOR QILINDI; category pictures on chips and in the menu list, both switches off/on; printer page, dish form, category form, orders settings in uz and ru (screenshots looked at).
- Not exercised: a real thermal printer (only the faked list), takeaway/delivery tickets in the UI (covered by tests).
- Version: 0.9.0 with F9 still uncommitted at 0.8.0 -> decide at release whether F9 + F10 + F11 ship as one minor.

### F12. Satellite till (posgro `src/main/lan` + `src/main/local-server`, design `posgro/tasks/LAN_MAIN_TERMINAL_PLAN.md`)

Every SavdoChef call already goes through one map (`HANDLERS` + `invokeHandler`, actor per caller), and `register.ts` already notes that "the LAN adapter will key the same thing by device token". So the satellite is a **thin client (R, question 1)**. The renderer is unchanged. On a satellite, main forwards every IPC call (channel + raw input) over HTTP to the main till, which runs the **same** `invokeHandler` with the satellite's user as actor. The satellite's database holds no business data, so there is nothing to reconcile and no double-selling. The one-open-shift and one-pending-order-per-table triggers stay the only source of truth.

**Main till**
- [x] `main/lan/server.ts`: plain `node:http` (no Express), copied from posgro `local-server/index.ts` + `router.ts` + `serve-policy.ts`. It listens only when the till is a main **and** has a paired satellite or an open pairing code (posgro §12.2: never open a port on every till just because of an upgrade). Port setting `lan_port`, default 5180, LAN interfaces only.
- [x] `POST /rpc` `{channel, input}` → `invokeHandler(channel, HANDLERS[channel], ctx, input)` with `ctx.actor` from the session token; `eventsFor` → `broadcast` (local windows) + push to satellites. Allowed channels (R, question 1): all except `setup:*`, `updater:*`, `license:signup*/activate`, `receipt:pickImage`, `menu:pickImage`, `auth:recover`, `auth:bootstrap*` and `printing:printers` (the main's Windows printers mean nothing to a satellite).
- [x] `GET /events` (SSE) pushes `AppEvent`s to satellites, so their views refresh by subscription, never by polling.
- [x] `GET /img/:file` (device token) serves the image store, so the satellite's `savdochef-img://` protocol shows dish and category pictures.
- [x] Auth (posgro `pairing.ts`, `auth.ts`, §6.10):
  - The main issues a pairing code (6 digits, CSPRNG, 10 min, in memory) in Settings → Satellitlar (`settings` permission).
  - The satellite redeems it for a device secret, stored hashed in `lan_devices`. Every request carries a device token.
  - PIN login runs on the main through `auth:pinLogin`, behind the device token, throttled per device with lockout; failed attempts are logged with the device id.
  - The session token ties user + device and is re-checked on every call (`refreshActor` already does this).
- [x] Schema (migration 0016, additive): `lan_devices` (`id`, `name`, `secretHash`, `pairedAt`, `lastSeenAt`, `revokedAt`, `lastIp`). Settings keys (no migration): `lan_role` (default `main`, so every installed till stays exactly as today), `lan_port`, `lan_lineage`/`lan_generation` (posgro §11.3: refuse a main that was replaced). The existing, unused `lan_enabled` becomes the "accept satellites" switch.
- [x] Licence: the main's licence is enforced on every forwarded call (`invokeHandler` already runs `license.refusal`). Paired devices are capped at plan `terminals − 1` (R, question 7). Satellites never talk to the posgro server.

**Satellite till**
- [x] Role and main address are chosen in the setup wizard ("Asosiy kassa" / "Satellit kassa: asosiy kassa IP manzili + juftlash kodi") and later from the login-screen gear (behind a pairing code from the main; leaving also needs a code). Stored in the satellite's own small database: `lan_role = satellite`, `lan_main_url`, and the device secret encrypted with `safeStorage`.
- [x] `main/lan/main-link.ts` (posgro `main-link.ts`): one HTTP client with timeout, device-token renewal, codes `MAIN_UNREACHABLE` / `DEVICE_UNPAIRED` / `MAIN_SUPERSEDED`, and status events.
- [x] `register.ts`: on a satellite every channel goes through `main-link`, except the local ones: `app:info` and `updater:*` (each till updates itself). The renderer still calls `api.<ns>.<method>()`. Apart from the banner, nothing in the renderer knows it is on a satellite.
- [x] Printing on a satellite (answer 2): **everything prints on the main till**. `printing:printReceipt`, `printing:printPreBill`, `printing:shiftReport` are forwarded like any other call, so the receipt and pre-bill come out of the main printer and kitchen tickets out of the kitchen printers, all installed on the main. No printer setup and no receipt window on a satellite; no new printing channel.
- [x] Degraded mode: when the main is unreachable, a full-screen notice "Asosiy kassa bilan aloqa yo'q, qayta ulanmoqda…" with retry. The open order draft stays in the renderer. No offline selling (posgro §5.9). The login screen says "asosiy kassani kuting" instead of "PIN noto'g'ri".
- [x] Hidden on a satellite (cosmetic; the main refuses these anyway): Settings → Printer (the main's printers), Satellitlar, licence/subscription, the main's updates. Users and menu editing stay available to users with the permission (R); picture upload only on the main.
- [x] Windows firewall on the **main**: no installer change (R). Settings → Satellitlar shows the main's IP and the exact PowerShell command to allow the port, as in posgro §9.
- [x] Packaging: no new dependency (node:http; SSE written by hand).

**Security (agent `electron-security-reviewer`)**
- The renderer never sends URLs to main: the main's address is typed in the wizard and validated in main as `http://<private IPv4>:<port>`.
- Every HTTP route needs a device token except `/pair` (throttled) and `/health`.
- No password or PIN hash leaves the main (`secrets.test.ts` also covers the RPC path).
- Generated HTML only in the receipt window. CSP unchanged.

**Money/stock:** the rules don't change. A satellite's sale is an ordinary `orders:save` / `payments:pay` on the main, serialised by the main's SQLite transaction and the existing `version` / `pendingTable` / `openGuard` guards. The whole restaurant shares one open shift (R, question 1). `createdById` is the user at the satellite.

**Tests**
- [x] `lan/serve-policy.test.ts`, `pairing.test.ts`, `auth.test.ts` (copied from posgro and adapted).
- [x] `lan/satellite.e2e.test.ts` (posgro pattern): a real main (HTTP server + temp DB) and a satellite client in one process. Covers: pair, PIN login, list menu, save order (tickets written on the main), pay; two satellites racing for one table (one gets STALE); a deactivated user cut off; main stopped → `MAIN_UNREACHABLE`; revoked device → `DEVICE_UNPAIRED`; PIN throttle.
- [x] The RPC path runs the same access snapshot as `ipc.test.ts` (a STAFF session cannot call `settings:update` through `/rpc`).

### F12 built (2026-11-08, not committed; F9 = `e170726`, F10+F11 = `65ec15d`)

- Naming (2026-11-08, owner): in Uzbek the satellite till is **"Yo'ldosh kassa"** (not "Satellit"); Russian stays "дополнительная касса". Code, keys and logs keep `satellite`. Firewall rule name: "SavdoChef yoldosh kassalar" (no apostrophe inside the PowerShell quotes).

- Built as planned (thin client): `src/main/lan/` (pairing, serve-policy, config, devices, server, main-link, lan-service), migration 0016 `lan_devices`, channels `lan:status/update/pairingCode/cancelPairing/revoke` (settings), `lan:link` (public), `lan:join` (public in first setup, else settings), `lan:leave` (settings); `register.ts` forwards every channel on a satellite except `app:info`, `lan:link`, `updater:*`, `lan:join/leave`; pictures come from the main till and are kept (only real pictures, size-capped); a satellite starts no licence check-ins.
- Changes from the plan: no login-screen gear: re-pairing and leaving live on the waiting overlay and in Settings -> Kassalar tarmog'i (one section: main-till view or satellite view). Settings sections are not hidden on a satellite (everything is forwarded, so Printer, Obuna etc. act on the main till; picture picking is refused there). posgro's generation counter / planned handoff (§11.3-11.4) not built: lineage only. Both tills must run the same major.minor version (checked on connect).
- Licence (answer 7): satellites allowed = licence `terminals` - 1. The cafe's licence said `terminals: 1` (0 satellites); the owner added a till on 2026-11-08, so it may pair 1 once the till has checked in (Settings -> Obuna -> check now). Development runs may override with `SAVDOCHEF_LAN_DEVICES` (ignored when packaged).
- Security review (electron-security-reviewer): no high. Fixed: sign-ins over the LAN run one at a time + per-satellite PIN lock (3 wrong -> 5 min) before the till-wide lock; unattended re-pair only to the same restaurant (lineage) and only when the main till refuses / another till answers / versions differ, never while merely unreachable; unattended leave only when the main till refuses or versions differ; 10 wrong pairing codes in all cancel the code; /health no longer gives the lineage (new authenticated /hello); body limits (/pair 4 KB, /rpc 1 MB), 64 connections, 2 event streams per satellite, slow streams dropped; foreign session tokens cannot touch another till's session; malformed picture paths are 404; stored secret records its encryption (`dpapi`/`plain`), an unreadable one shows "unpaired" instead of silently becoming a till of its own; join addresses: private only, port >= 1024, loopback only in development; firewall removal command shown.
- **Known limit, not fixed (security M2): plain HTTP on the shop network.** PINs and the device secret cross the LAN in clear, and a machine that takes the main till's IP could impersonate it. Same as posgro (§9.6). Fix later with a pinned self-signed certificate (fingerprint handed over at pairing) and HTTPS, or HMAC-signed requests. Until then: tills on cable or the staff Wi-Fi, never the guest Wi-Fi.
- Checks: `npm run check` 44 suites / 603 tests (new: `lan/satellite.e2e.test.ts` real server + clients over HTTP, `lan/lan.test.ts`, access snapshot, secrets test with a paired device).
- Real app: `npm run build`, two Electron instances on this PC (harness `smoke-main.cjs` on a copy of the cafe data, `smoke-sat.cjs` on an empty scratch profile; prints intercepted): main till enables satellites (port 5185), issues a code; satellite's setup page -> "Satellit kassa sifatida ulash" -> wrong code refused ("Kod noto'g'ri") -> right code -> restarts as a satellite, online; PIN of the main till's admin; order on table 1 through the satellite's UI -> "YANGI BUYURTMA / Oshxona" printed on the main till's kitchen printer, order 2026-00006 (50 000) on the main till; pre-bill from the satellite printed on the main till's XP-80C; picture picking refused on the satellite; main till shows the paired satellite; main till quits -> satellite overlay "Asosiy kassani kutyapmiz" with only "Qayta tekshirish". Screenshots looked at. Not done: two physical PCs on the cafe LAN, Windows Firewall prompt on a real network, packaged build (the harness shows Electron's version as the app version).
- Version: F12 -> 0.10.0 (migration 0016). Commit only when asked.

### Verify in the real app (each feature)

- [ ] `npm run build`, then the harness (pattern in `tasks/lessons.md`) on a scratch userData with a **copy** of the café data: migration v14 → v15 (→ v16) with a backup in `backups/`; screenshots in uz + ru.
- [ ] F10: add category pictures; order screen with both switches on and off.
- [ ] F11: main printer + two extra printers ("Microsoft Print to PDF", or captured as PNG). Assign dishes and save a new table order → one ticket per printer. Add a dish → ticket shows only the addition. Reduce → BEKOR block. Also: cancel an order, a takeaway order. With a printer missing, the save succeeds and shows the toast with Qayta. Receipt and pre-bill still go to the main printer.
- [ ] F12: two Electron instances on this PC (`--user-data-dir` scratch copies; main on 127.0.0.1 and the LAN IP). Pair, log in on the satellite, take an order there and watch it appear live on the main's table grid. Pay on the satellite: the receipt comes out of the main printer. Stop the main → banner; start it → recovers. If possible, a second real PC on the café LAN.
- [ ] `npm run check`. Reviews: `migration-reviewer` (0015, 0016), `prisma-reviewer` (tickets in orders.ts), `electron-security-reviewer` (printers, HTTP server, satellite routing).

### Version

F10 + F11: 0.8.0 → **0.9.0** (minor, migration 0015). F12: → **0.10.0** (minor, migration 0016). Commit and release only when asked.

### Open questions (answered 2026-11-08: all (R) except 2 = always the main printer)

1. Satellite scope: should it be a thin client (every call forwarded to the main, one shared shift, nothing works while the main is off) allowing everything the user's permissions allow (R), or only a waiter/cashier subset?
2. Should a satellite's receipt and pre-bill print on its own printer (R, like posgro) or always on the main printer?
3. Should a ticket for a later save show only the changes, with reductions shown as "BEKOR" (R), or reprint the whole order each time?
4. Should a dish without a printer print no ticket (R) or go to the main printer? Should categories have a default printer that new dishes inherit?
5. Should the image switches be one setting for the restaurant that affects only the order screen (R), or set per till (a satellite could hide pictures while the main shows them)?
6. Should takeaway/delivery orders print kitchen tickets too (R), and should cancelling an order or moving a table print a ticket (R)?
7. Does each satellite count against the plan's `terminals` limit (R: at most `terminals − 1` paired), or are satellites free?

## Release 0.8.0 (F9 + F10 + F11 + F12, 2026-11-08)

- `npm run release -- minor`: check 44 suites / 603 tests, commit + tag `v0.8.0`, `release/v0.8.0/SavdoChef-Setup-0.8.0.exe` sha256 `f21af54aea4be183a0584599b6eb6254c834d3a074592e85437a82213988b05f`. Not pushed, not uploaded.
- Upgrade test on this PC: installed 0.6.0 -> silent 0.7.0 -> ran (packaged, `--user-data-dir` = scratch copy of the v13 backup of the cafe data): schema v13, licence check-in OK -> silent 0.8.0 over it -> ran on the same copy: backup `savdochef-v13-*` written, migrated v13 -> v16 (0014, 0015, 0016). Row counts of every existing table identical before/after, orders total identical (50 000); new: printers 1 (main, auto pick as before), kitchen_tickets 0, lan_devices 0, pre_bill_layout 0, settings +2 (picture switches, on). Desktop + Start menu shortcuts point to the 0.8.0 install. This PC now has 0.8.0 installed.
- Note: the real `%APPDATA%\SavdoChef` database was migrated to v16 by `npm run dev` runs on 2026-11-08 (21:18 v14->v15, 22:55 v15->v16, backups in its backups/ folder); a dev run also switched yo'ldosh tills on there (lan_enabled).

## F13 table lock between tills + waiters keep to their own orders (approved 2026-11-09: all questions = R)

Two parts:

- **A. Table in use.** While a till has a table's order page open, every other till shows the table as "in use by <name>" and cannot open its page. Main also refuses that table's save, cancel and move from any other till, so it is not only the UI.
- **B. Own orders only.** A waiter cannot edit, cancel or move an order another user opened. The pre-bill ("Hisob") stays allowed for any signed-in user, on any order.

Copy from: F12 (`src/main/lan/server.ts` + `ipc/register.ts`: every call, local or from a satellite, already runs on the main till through `invokeHandler`, so one in-memory lock table on the main till sees every till); `orders:busyTables` + `orders-changed` (grid refresh); the `staleOrder` / `TABLE_BUSY` conflicts (refusal shape); F2 permissions (part B, if Q2 picks a permission).

### Design (recommendations, see questions)

- **Lock = a lease held in memory on the main till** (`src/main/orders/table-locks.ts`, Electron-free class, no database). Key: table number. Value: `{ terminal, userId, userName, expiresAt }`. `terminal` = who holds it: `local:<webContents.id>` for a main-till window, `lan:<deviceId>` for a satellite. Lease 45 s, renewed every 15 s by the open order page. A crashed till, a pulled network cable or a closed window frees the table within 45 s. A main-till restart frees all of them (nothing to clean up in the database).
- Released at once on: leaving the order page (`destroy`), logout / lock screen (all of that terminal's locks), window closed (`register.ts` already drops the actor there), satellite revoked or its event stream ending (`server.ts` `dropDevice` / stream close).
- Taking a lock on a table someone else holds -> `CONFLICT` `{ reason: 'TABLE_IN_USE', tableNumber, userName }`, message "5-stol hozir <ism> tomonidan ochilgan". The same terminal re-entering just renews it.
- `orders:save` / `orders:cancel` / `orders:moveTable` on a table are refused with `TABLE_IN_USE` when another terminal holds it. This main-side guard covers stale screens and the move button on the tables grid. Move also refuses a target table someone else holds, and after a move the lock follows the order to its new table.
- **Ownership (B)**: an order belongs to its `createdById`, which is already stored (the DTO only carries the name today, so add `createdById`). `orders:save` (existing order), `orders:cancel`, `orders:moveTable`, `orders:saveOpen` (existing), `orders:cancelOpen` and `orders:setDeliveryStatus` refuse with `FORBIDDEN` `{ reason: 'NOT_OWNER' }` ("Bu buyurtmani <ism> ochgan. Uni faqat o'zi o'zgartira oladi") unless the actor is the creator or may handle others' orders (Q2). An order with no creator (legacy import, deleted user) can be changed by anyone with `orders`.
- Not affected: `printing:printPreBill` (any user, any order, as now), reading orders, kitchen reprint. `payments:pay` depends on Q3.

### Files

shared
- [ ] `shared/schemas.ts`: `tableLockInput` (`{ tableNumber }`), used by take and release.
- [ ] `shared/ipc.ts`: channels `orders:lockTable` (take or renew; out `{ expiresAt, changed }`), `orders:unlockTable`, `orders:tableLocks` (read; out `TableLockDto[]`). Access: `orders` permission for all three.
- [ ] `shared/types.ts`: `TableLockDto` = `{ tableNumber, userName, mine }`; `OrderDto.createdById`; `TableSummaryDto.createdById` + `createdBy` (the grid shows whose order it is).
- [ ] `shared/permissions.ts` (only if Q2 = permission): `ordersOthers` "Boshqalarning buyurtmalari", ticked by default for ADMIN + CASHIER.

main
- [ ] `main/orders/table-locks.ts` (new): `TableLocks` class (take / renew / release / releaseTerminal / holderOf / list / move), with an injectable clock for tests.
- [ ] `main/orders/orders.ts`: `assertCanChange(order, actor)` (owner rule) used by save/cancel/move/saveOpen/cancelOpen/setDeliveryStatus, inside the existing transactions before any write; `createdById` in the DTOs. No change to pricing, stock or totals.
- [ ] `main/ipc/ipc-safe.ts`: `HandlerContext.terminal: string`; `HandlerServices.tableLocks`.
- [ ] `main/ipc/register.ts`: `terminal = local:<sender.id>`; release on window close and logout.
- [ ] `main/lan/server.ts`: `terminal = lan:<deviceId>`; release on revoke, stream close and logout over RPC.
- [ ] `main/ipc/handlers.ts`: the three channels; lock guard in `orders:save|cancel|moveTable`; `auth:logout` releases the terminal's locks.
- [ ] `main/ipc/events.ts`: lock and unlock emit `orders-changed { tableNumber }` (the grids already listen). A renewal that changes nothing emits nothing (`changed: false` in the output).
- [ ] `main/index.ts` / `lan-service.ts`: one `TableLocks` per main till, passed in services. Nothing changes on a satellite (its calls are forwarded).

renderer
- [ ] `views/order/order-view.ts`: on loading a table page, call `orders.lockTable`. On `TABLE_IN_USE`, show a toast and go back to `/tables`. Renew every 15 s (timer dropped in `destroy`) and release in `destroy`. If a renewal fails (lease lost, e.g. the main till restarted and someone else took the table), show the stale banner and disable save. Owner rule: when `order.createdById` is someone else and the user may not handle others' orders, the page opens read-only (lines, total, pre-bill, and pay per Q3), or is refused (Q4).
- [ ] `views/tables.ts`: load `orders.tableLocks` with `busyTables`. A table locked by another till shows "Band: <ism> ochgan" with a lock icon; clicking it shows a toast instead of navigating, and its move tool is hidden. The pre-bill tool stays. Others' orders: move tool hidden, creator's name on the card (`table-meta`).
- [ ] `views/order/move-table-modal.ts`: target tables locked by others are disabled.
- [ ] Takeaway/delivery strip (`tables.ts`) and `/orders/:id`: owner rule only (locks per Q5).
- [ ] `styles/`: `.table-card.is-locked` (tokens, light + dark).

### Schema / migration

- None if Q1 = in memory and Q2 = by role. If Q2 = new permission: migration `0017_orders_others_permission.ts`, data only and additive: append `ordersOthers` to the stored list of every ADMIN and CASHIER user (`json_insert`), STAFF unchanged. On installed tills, waiters are restricted right after the update and admins/cashiers keep doing everything. Skill `prisma-migration` + agent `migration-reviewer`.

### Money / stock

- No change to how totals, stock reservations, the stock given back on cancel, or moves are computed. Before: any `orders` user could save/cancel/move any pending order from any till. After: only its creator (or Q2 users) can, and only from the till holding the table. A refused call writes nothing (the checks run before any write in the same transaction). Agent `prisma-reviewer` on `orders.ts`.

### Strings (uz + ru)

`tables.inUse` ("Band: {{name}}" / "Занят: {{name}}"), `tables.inUseToast`, `tables.openedBy`, `order.inUse`, `order.lockLost`, `order.notOwner` ("Bu buyurtmani {{name}} ochgan" / "Этот заказ открыл(а) {{name}}"), `order.readOnly`. Main errors in Uzbek (`TABLE_IN_USE`, `NOT_OWNER`). Permission label if Q2 = permission.

### Tests

- [ ] `table-locks.test.ts`: take / renew / refuse / expire (fake clock) / releaseTerminal / move.
- [ ] `orders.test.ts`: owner rule for save/cancel/move/saveOpen/cancelOpen/deliveryStatus; legacy order with no creator; a refused call leaves stock and version unchanged.
- [ ] `ipc.test.ts`: access snapshot for the 3 new channels; lock guard on save/cancel/move with two terminals; pre-bill by a non-owner still prints.
- [ ] `satellite.e2e.test.ts`: main window holds table 5 -> satellite `lockTable(5)` gets `TABLE_IN_USE`; the satellite's stream closes -> its locks drop; logout drops locks.
- [ ] `events.test.ts` passes with the new channels.

### Verify in the real app

- `npm run build`, then two instances (main + satellite, separate scratch `userData`, copy of the cafe data, pattern in lessons F12). User A opens table 5 on the main till -> screenshot of the satellite grid shows "Band: A", and clicking it there is refused. A leaves -> the satellite grid frees the table within a second. Kill A's window -> freed in <= 45 s.
- Waiter B (STAFF) on the satellite: A's order opens read-only (or is refused, Q4), the pre-bill prints (fake printer), and cancel/move are hidden, and refused if forced through `api`.
- `npm run check`, agents `prisma-reviewer` + `electron-security-reviewer` (+ `migration-reviewer` if Q2 = permission).

### Version

0.8.0 -> **0.9.0** (minor: new feature, and a migration if Q2 = permission). Release only when asked.

### Open questions

1. Lock storage: in memory on the main till with a 45 s lease (R), or a database row (survives a main-till restart, needs a migration)?
2. Who may still edit/cancel/move anyone's order: a new permission "Boshqalarning buyurtmalari" ticked for ADMIN + CASHIER by default (R), simply role ADMIN/CASHIER, or only ADMIN?
3. Can anyone with `payments` (a cashier) take payment for another waiter's order (R: yes), or only its creator?
4. Another waiter's busy table: open read-only (see lines, print pre-bill, pay if allowed) (R), or not open at all (pre-bill only from the grid)?
5. Should takeaway/delivery orders also be locked while open on a till (R: no, owner rule only), or tables only?
6. Should an admin be able to take over a table another till holds ("Majburan ochish", frees that till's lock) (R: yes, ADMIN only), or always wait for the lease?
7. Same user signed in on two tills at once: refuse the second till like anyone else (R), or let the same user in?

### F13 built (2026-11-09, not committed)

- Migration 0017 (data only: `ordersOthers` for ADMIN + CASHIER, once). Lock = `main/orders/table-locks.ts` (in memory on the main till, 45 s lease renewed every 15 s, swept every 5 s, broadcasts `orders-changed` itself). Owner rule `assertMayChange` in `orders.ts`, first check in each change's transaction. Channels `orders:lockTable` / `orders:unlockTable` (`orders`), `orders:tableLocks` (`user`).
- Changed from the plan: a move frees the mover's lease instead of carrying it (both screens leave the order after a move, so a carried lease only blocked the new table for 45 s).
- Review fixes: actor required on cancel/move/cancelOpen/setDeliveryStatus (a missing actor no longer skips the rule); owner check before the version check; a PIN login by the same user keeps the till's table; recover/bootstrapPin release the till's tables; the move lease is dropped on commit (`onCommit`); `payments:pay` refused while another till has the table open; a till holds one table at most (taking one lets go of the other); renderer gives back a lock that resolves after the page was left. Satellites are one window each (`lan:<deviceId>`), documented in table-locks.ts.
- Verified 2026-11-09: `npm run check` parts (typecheck, lint, 45 suites / 623 tests; format clean except the untouched `sessions-view.ts` / `users-view.ts`), `npm run build`. Harness `f13-main.cjs` + `f13-sat.cjs` (scratch copies of the F12 main = cafe data, and of its paired satellite): v16 -> v17 with a `savdochef-v16-*` backup; admin on table 2 -> satellite grid "Band: Bobur ochgan", click and direct URL refused, `lockTable` TABLE_IN_USE; admin leaves -> lock gone, waiter opens table 2 read-only (notice, only Hisob, lines inert + dimmed), Hisob printed on the main XP-80C, forced cancel NOT_OWNER; waiter on table 3 -> admin grid shows it, take-over dialog -> "Majburan ochish" -> waiter's page "Stol boshqa kassada ochildi", save disabled; satellite quit -> its leases gone. Not done: two physical PCs; lease run-out after a crash (45 s) only in unit tests; ru screens not looked at (strings present in both files).
- Note: released migration 0009 grants admins the whole current `PERMISSIONS` list, so a pre-v9 admin gets `ordersOthers` from 0009 and 0017 skips them (migration-reviewer: acceptable).
- Committed `103b6bb` (2026-11-09).

## F14 pay per guest, payment window layout, info hints (approved 2026-11-09: 1-6 = R; 7 = every grey hint paragraph in forms becomes an (i) hint)

Three parts:

- **A. Pay per guest ("Kishilar bo'yicha").** The bill is divided between N guests; each guest pays a share with their own method (cash with their own change, card, Click). All in the one payment window, confirmed once.
- **B. Payment window layout** (user screenshot 2026-11-09 12:44): method buttons leave an empty 4th column when debt is off; "Olingan summa" sits on the buttons with no gap; "Qaytim" is lower than "Olingan summa" (the grid aligns bottoms and the amount hint pushes the input up); "Bo'lib to'lash" floats alone above the print box.
- **C. Info hints in the dish form.** An (i) button next to "Tannarx (ixtiyoriy)" and "Printer"; `menu.costHint` / `printers.dishPrinterHint` move from the paragraphs under the fields into a tooltip shown on hover, keyboard focus, and tap (the till is a touch screen).

Copy from: the tender editor (`views/order/tender-editor.ts`: method buttons, received + change, split rows with "Qolgan", debt box) and its rules `shared/utils/split-payment.ts` (`settleTenders`, the same code main runs); `components/forms.ts` `wrapField` (label) for the hint.

### Design (recommendations, see questions)

- **Main and database untouched (if Q4/Q5 = R):** the guests are a way of entering tenders. On confirm, every guest's share is added up per method and sent as today's `tenders` (one payment row per method). Cash is sent as the cash shares; each guest's change is shown on their card only. `settleTenders` checks the result as now. No new IPC channel, no migration.
- **Modes:** a segmented control at the top replaces the "Bo'lib to'lash" button: "Bitta usul" (one method) · "Usullar bo'yicha" (today's split by method) · "Kishilar bo'yicha" (per guest). The last two only when split payment is on in settings.
- **Per guest:**
  - A − / N / + stepper (2…20).
  - Equal shares in whole so'm; the remainder of the division goes to the first guests (25 000 / 3 = 8 334 · 8 333 · 8 333). Shares always add up to the total exactly (Decimal, `shared/utils/guest-split.ts`).
  - Each guest is a card: "1-mehmon", the share, method chips (Naqd / Karta / Click), and for cash "Berdi" (received, optional) and "Qaytim" (change).
  - A share can be typed over: the guest is then "fixed" (pin icon), and the rest is divided again among the guests not fixed. Over the total is refused ("Ulushlar jami summadan oshib ketdi").
  - A footer shows "Jami ulushlar / Qolgan" and per-method totals ("Naqd 16 667 · Karta 8 333"), which are what is stored.
- **Debt per guest (Q3):** at most one guest pays on debt, using the existing debt customer form.
- **Layout fixes (B):**
  - Method grid columns = the number of methods shown.
  - The single-method box gets the editor's gap.
  - "Olingan summa" and "Qaytim" are aligned at the top, with "Qaytim" styled like a field label.
  - The print checkbox sits under a divider.
  - The modal goes to `lg` only in per-guest mode, so cards sit 2 per row.
- **Info hint (C):**
  - `components/info-hint.ts`: `<button class="info-hint" aria-label="…" aria-describedby>` with an `info` icon and a `<span role="tooltip">`.
  - Shown by CSS on `:hover` / `:focus-visible`; a tap toggles `.is-open`, and Esc or a tap outside closes it.
  - Placed above the button, kept inside the modal. No inline style (CSP).
  - `field` / `selectField` get an optional `info` text that puts the button in the label.

### Files

shared
- [ ] `shared/utils/guest-split.ts` (new): `equalShares(total, n)`, `rebalance(total, guests)` (fixed shares kept, the rest divided again), `guestTenders(guests)` -> `TenderLine[]` (per method, summed). Pure Decimal, no float.

main
- [ ] Nothing (if Q4/Q5 = R).

renderer
- [ ] `views/order/tender-editor.ts`: mode control (3 modes), per-guest box built from a new `views/order/guest-split.ts` (cards, stepper, rebalance), `lines()` from `guestTenders` in that mode; debt limited to one guest.
- [ ] `views/order/payment-modal.ts`: modal size follows the mode; the done toast mentions "3 kishiga bo'lindi".
- [ ] `components/info-hint.ts` (new) + `components/forms.ts` (`info` option on `field`/`selectField`/`wrapField`).
- [ ] `views/menu/menu-modals.ts`: `info: t('menu.costHint')` on costPrice, `info: t('printers.dishPrinterHint')` on printerId; drop the two `<p class="muted small">`.
- [ ] `styles/views.css`: payment fixes, `.pay-modes`, `.guest-grid`, `.guest-card`; `styles/components.css`: `.info-hint`, tooltip (tokens, light + dark).

### Schema / migration

- None (if Q4 = R). If the receipt should say "N kishiga bo'lindi": a nullable `orders.guestCount` (additive migration 0018) plus a receipt line.

### Money / stock

- Stock: unchanged.
- Money: what is stored is unchanged in kind, still one payment row per method for the whole check.
  - Before: per-method amounts were typed by hand.
  - After: they can also come from guest shares that always add up to the total exactly.
  - Example: 25 000 split between 3 guests, guest 1 paying cash with 10 000 and the others card: stored cash 8 334 and card 16 666. The change shown is 1 666 for guest 1.
- `settleTenders` is not changed.

### Strings (uz + ru)

`payment.modeSingle` ("Bitta usul" / "Одним способом"), `payment.modeMethods` ("Usullar bo'yicha" / "По способам"), `payment.modeGuests` ("Kishilar bo'yicha" / "По гостям"), `payment.guests` ("Mehmonlar soni" / "Количество гостей"), `payment.guest` ("{{n}}-mehmon" / "Гость {{n}}"), `payment.share` ("Ulushi" / "Доля"), `payment.gave` ("Berdi" / "Дал"), `payment.sharesOver`, `payment.sharesLeft`, `payment.fixedShare`, `payment.resetShares` ("Teng bo'lish" / "Поровну"), `payment.doneGuests`, `app.moreInfo` ("Batafsil" / "Подробнее"). The existing `splitOn`/`splitOff` are dropped if unused.

### Tests

- [ ] `shared/utils/guest-split.test.ts`:
  - equal shares (25 000 / 3, 100 000 / 7, a free check, 2 decimals);
  - rebalance with fixed shares;
  - over-total refused;
  - per-method sums;
  - `settleTenders(guestTenders(...))` = none for every case.
- [ ] Tender editor DOM tests if the existing setup has them (`modal.test.ts` pattern), else covered by the harness.
- [ ] `info-hint` DOM test: aria wiring, tap toggles, Esc closes.

### Verify in the real app

- `npm run build`, harness on a scratch copy of the cafe data:
  - payment window: single mode, with and without debt (3 and 4 buttons);
  - split by method;
  - per guest: 3 guests, cash with change, card, one share typed over, then pay; check the stored payment rows and the receipt (fake printer);
  - dish form: the hint on hover and on tap.
- Screenshots in uz + ru, light + dark, looked at.
- `npm run check`; agent `electron-security-reviewer` (new component, no `innerHTML`).

### Version

Goes into the unreleased 0.9.0 (minor, already due to migration 0017). Release only when asked.

### Open questions

1. How shares are set: equal shares, each one editable, with the rest re-divided among the others (R), or also "by dishes" (tap order lines to give them to a guest)?
2. Rounding of equal shares: whole so'm with the remainder on the first guests (R), or round up to 1 000 so'm with the last guest paying the difference?
3. Debt in per-guest mode: at most one guest on debt (R), no debt at all in this mode, or any guest on debt (each with their own customer, needs a change in main)?
4. Receipt: one receipt as today, with payment methods summed (R), add a line "3 kishiga bo'lindi, har biri ~8 334" (needs a migration), or also a small slip per guest?
5. Flow: all guests settled in one window and confirmed once (R), or guest by guest, with the order staying open until the last guest pays (partial payments on an unpaid order: a bigger change in main and the shift cash)?
6. Modes as a segmented control at the top, "Bitta usul · Usullar bo'yicha · Kishilar bo'yicha", replacing the "Bo'lib to'lash" button (R)? Or keep the button and add "Kishilarga bo'lish" next to it?
7. Should the info hint also replace the other muted hint paragraphs in forms (e.g. settings pages) (R: no, only these two now), or everywhere with the same pattern?

### F14 built (2026-11-09, not committed)

- A: `shared/utils/guest-split.ts` (equal shares in whole so'm, remainder on the first guests; typed shares fixed, the rest divided again; per-method sums; per-guest change) + `views/order/guest-split.ts` (stepper 2-20, guest cards with share, method chips, "Berdi"/"Qaytim" for cash, "Teng bo'lish", footer with per-method totals). The tender editor has three modes in a segmented control (Bitta usul · Usullar bo'yicha · Kishilar bo'yicha), replacing the "Bo'lib to'lash" button; the window widens to `lg` in per-guest mode; the check edit keeps two modes (`guests: false`). Main, IPC and database unchanged: shares go as `tenders`, cash = the shares (each guest's change only shown). At most one guest on debt (debt chip disabled for the others).
- B: method buttons as many columns as methods; gap between buttons and "Olingan summa"; "Qaytim" aligned with it; print choice under a full-width line.
- C: `components/info-hint.ts` (button + role=tooltip; hover, keyboard focus, tap; Esc / tap outside / blur close; one open at a time; opens left when there is no room on the right) + `info` option on `field`/`selectField`/`textareaField`, `pinField(name, label, info)`, `pageHeader(withInfo(...))`. Converted: dish form cost price and printer; cash in/out amount; halls page; LAN main/satellite card titles; order types page + pictures subtitle; payments page; main/extra printer titles; receipt shared + pre-bill titles; system language field; update page; relink button; setup PIN; profile account title; users PIN legend. Kept visible on purpose (instructions to read while doing it, or status): LAN join steps and pairing steps, setup "join a main till" offer, privacy notice and activation-code help in restaurant linking, move-table instruction, plan notes, empty states, "checked at" lines.
- Tests: guest-split (13), info-hint DOM (4); `npm run check` parts green (47 suites / 640 tests; format clean except the untouched `sessions-view.ts`).
- Real app (harness `f14.cjs`, scratch copy of the cafe data; `npx electron-vite build` because a dev run of the app held the Prisma engine DLL): payment window single (3 equal buttons, labels aligned), by method, per guest 3 guests 8 000 -> 2 667/2 667/2 666, guest 3 typed 5 000 -> others 1 500, guest 1 cash gave 20 000 -> change shown, over the total refused, paid -> stored cash/card/Click per method, receipt printed with the methods; dish form hint on hover and tap, no horizontal overflow; settings printer and order types hints; uz light + ru dark screenshots looked at.
- Security review (electron-security-reviewer): no high findings; fixed: Esc on an open hint now `preventDefault`s so the native `<dialog>` around it stays open (verified in the app: first Esc closes the hint only, the second closes the form); a hint removed while open drops its document listeners; the "gave less" guest index comes from one helper. 47 suites / 641 tests.

## Release 0.9.0 (F13 + F14, 2026-11-09)

- `npm run release -- minor`: check 47 suites / 641 tests, commit + tag `v0.9.0`, `release/v0.9.0/SavdoChef-Setup-0.9.0.exe` sha256 `707f2e74f74a44825899c11aed7fa1793d3c45b6911a832f6fb725dae901acce`. Not pushed, not uploaded.
- Upgrade test on this PC: installed 0.8.0 -> silent 0.9.0 over it (exit 0, exe 0.9.0.0) -> ran packaged with `--user-data-dir` = scratch copy of the v16 profile from the 0.8.0 test (cafe data): backup `savdochef-v16-*` written, migrated v16 -> v17 (0017). Row counts of all 24 tables identical, orders total identical (50 000); the admin's permissions now end with `ordersOthers`. This PC now has 0.9.0 installed.

## F15 update a satellite to the main till's version (approved 2026-11-09: all questions = R)

Problem: when the main till is updated and a satellite is not (or a fresh satellite installed from an older installer joins), the versions differ in major.minor (`versionsCompatible`, serve-policy.ts). The satellite's link goes to `version`, `MainLink.rpc` refuses every call, and the waiting card (`components/lan-link.ts`) covers the app with only "Qayta tekshirish / Qayta ulash / Ajralish". The updater (Settings -> Dastur yangilanishi) is unreachable: the overlay covers it, and on a satellite `updater:*` needs a settings user asked of the main till (`register.ts` `remoteActor`), which the refused link cannot answer. So the satellite cannot be updated from the app at all. Pairing itself succeeds; the till then lands on this card.

Copy from: the unattended link actions (`lanService.mayRejoinUnattended` / `mayLeaveUnattended` in `register.ts` `satelliteCall`), the updater service and its states (`main/updater/updater.ts`, `views/settings/update-section.ts`: check -> download with progress -> install).

### Design (recommendations, see questions)

- **Waiting card, state `version`:**
  - Shows both versions: "Asosiy kassa: 0.9.0 · Bu kassa: 0.8.0".
  - Main till newer: a "Yangilash" (update) button. It checks the update feed, then downloads with a progress bar, then shows "O'rnatish va qayta ishga tushirish" (install and restart) with a confirm.
  - Satellite newer: "Asosiy kassani yangilang" (update the main till), no button.
- **Main process (satellite):** `updater:check|download|install|status` are allowed without a sign-in only while the link is `version` and the main till's version is newer (`lanService.mayUpdateUnattended`), like the unattended re-pair. Otherwise the rules stay as they are: a settings user.
- **Target version:**
  - The feed serves the newest release. If its major.minor is not the main till's, the update is refused with "Asosiy kassani ham oxirgi versiyaga yangilang" (update the main till too). Otherwise the satellite would just end up on the other side of the gap.
  - The check result gets compared before download is offered.
- No IPC channel added (reuses `updater:*`); one field on the updater status if needed (`targetMatches`). No database change.

### Files

- [ ] `main/lan/serve-policy.ts`: `compareVersions(a, b)` (semver major.minor.patch) + tests.
- [ ] `main/lan/lan-service.ts`: `mayUpdateUnattended` (satellite, state `version`, main newer).
- [ ] `main/ipc/register.ts` `satelliteCall`: updater channels pass with no actor when `mayUpdateUnattended`; download/install refused when the checked version does not match the main till's major.minor.
- [ ] `components/lan-link.ts`: versions line + update block (status, progress, buttons) on the `version` card; follows `update-changed` events.
- [ ] uz + ru strings: `lan.versions`, `lan.updateHere`, `lan.updateMainFirst`, `lan.feedMismatch`, `lan.updating`.
- [ ] Tests: `serve-policy` compare; `lan.test.ts` / register-level: unattended updater allowed only in `version` with main newer, refused otherwise (main reachable, satellite newer, state online).
- [ ] Verify: two instances (main + satellite) where the satellite reports an older version (dev override of the reported version, as the F12 harness did with `version`), screenshot of the card with the button; dev build updater is `unsupported`, so the full install path is checked by a packaged run: install 0.9.x on a satellite profile against a main showing a newer version, if Q4 allows a real feed test.

### Version

Q5.

### Open questions

1. Where does the satellite get the update: from the internet feed like any till (R), or from the main till over the shop network? The second works without internet on the satellite, but the main till must keep and serve its own installer (bigger).
2. Who can press "Yangilash" on the waiting screen: anyone at the satellite, without signing in (R)? Signing in is impossible while the versions differ, and it can only install the official signed release. Or should it need something else?
3. Flow: one button that checks and downloads with progress, then a second press "O'rnatish" with a confirm (R)? Or download and install in one go?
4. If the feed's newest version is not the main till's major.minor (the main till skipped updates): refuse with "update the main till first" (R), or install the newest anyway?
5. Version: 0.9.1 (patch), so it stays compatible with 0.9.0 main tills (R)? Or 0.10.0 (minor; every 0.9 satellite then needs this very update)? Note: satellites already on 0.8/0.9 do not have the button yet; they need one manual install (or the Settings updater while still compatible).

### F15 built (2026-11-09, not committed)

- `shared/utils/version.ts` (`compareVersions`, `versionsCompatible`, moved from serve-policy which re-exports it); `LanService.mayUpdateUnattended` (satellite, link `version`, main newer) + `mainVersion`; `register.ts` `satelliteCall`: `updater:*` pass without a sign-in in that state, `download`/`install` refused unless the checked release is in the main till's major.minor (`UPDATE_MISMATCH`). Waiting card (`lan-link.ts`): both versions; main newer -> hint + "Bu kassani yangilash" (check, then download with progress, then "O'rnatish va qayta ishga tushirish" with confirm), feed release of another series or none -> message; satellite newer -> "update the main till". No IPC channel, no schema change.
- Tests: version (2), lan.test F15 (real main + satellite over HTTP: main newer -> `version` + may update; satellite newer -> may not; same series -> online). 48 suites / 644 tests.
- Real app (harness `f15-main.cjs` + `f15-sat.cjs`, `app.getVersion` patched, scratch F12 profiles): main 0.10.0 / satellite 0.9.0 -> card with versions and hint, `updater:status/check` answer with nobody signed in, `download` refused (no matching release), other channels still refused; main 0.8.0 / satellite 0.9.0 -> "update the main till", updater still needs a sign-in. Not exercised: a real download + install (a dev run's updater is `unsupported`); needs a packaged 0.9.1 satellite and a newer main release on the feed.
- Version: 0.9.1 (patch, compatible with 0.9.0 main tills). Satellites already on 0.8/0.9 need one manual install to get the button.
- Security review (electron-security-reviewer) fixes: the satellite now checks who answers (`/hello`, its credential, lineage) BEFORE believing the main till's version, so a stranger at the address claiming a newer version cannot open the update (test: another restaurant's till at the port -> `unpaired`, version not taken, no unattended update); version strings from the network must look like a release (`VERSION_RE`) or the answer counts as `superseded`; a main version change while already in `version` re-renders the card; card: `.catch` on its first load, a press downloads only from the check it started; `MainLink.stop()` wakes a retry sleep (no 30 s timer left behind). 48 suites / 645 tests; harness re-run OK.
- Follow-ups not done (outside F15): (1) the installer is not Authenticode-checked by the updater (no `publisherName` in electron-builder config): the feed host is the trust root; (2) pre-F12 behaviour: any till at the main till's address that answers 401 makes a satellite `unpaired`, which allows the sign-in-free "Alohida kassa bo'lish" (indistinguishable from a real revoke).

## Release 0.9.1 (F15, 2026-11-09)

- `npm run release -- patch`: check 48 suites / 645 tests, commit + tag `v0.9.1`, `release/v0.9.1/SavdoChef-Setup-0.9.1.exe` sha256 `760634c10aea0ef1564721cbea849e01654731d921a96236aac360e42f4f7bbc`. Not pushed, not uploaded.
- Smoke test: silent install over 0.9.0 (exit 0, exe 0.9.1.0), packaged run on the scratch v17 copy: started, schema v17 (no migration), closed normally. This PC now has 0.9.1 installed. The update feed still serves 0.8.0.

## F16 order screen layout: narrower order panel, bigger pictures, two menu layouts (2026-11-09, UI only)

The task text assumes React/NestJS; this app is vanilla TS + Electron IPC, so "components" are DOM factory functions. No IPC, schema, money or stock change: `order-view.ts` keeps every calculation (availability, badges, Enter-to-add, add/save/pay) and only hands finished values to the new factories.

- [x] `store/app.ts`: `MenuLayout = 'horizontal' | 'vertical'`, stored with the existing per-machine prefs (`savdochef.ui`, like language/theme; default `horizontal`). AppState unchanged. Test in `app.test.ts`.
- [x] `views/order/menu-browser.ts` (new): `thumb()` (moved, + `decoding=async`), `createCategoryList()` (one list, `orientation`; wheel -> horizontal scroll, mouse drag, touch swipe native; active tile scrolled into view), `menuItemCard()`, `createMenuGrid()` (`resetScroll`), `layoutToggle()`.
- [x] `order-view.ts`: panel built from those; category change resets the grid's scroll; toggle switches `data-layout` on the panel and saves the pref.
- [x] `views.css`: order panel `clamp(360px, 33%, 480px)`, menu panel the rest; header and footer wrap instead of truncating; one CSS grid on `.menu-panel` with areas (A: head / cats / grid; B: cats | head, grid); dish cards 4:3 cover image, `minmax(220px, 1fr)` (smaller on short screens); category tiles with a larger picture, text-only without one; tap targets >= 44px; tokens only.
- [x] `ui/icons.ts`: `PanelTop`, `PanelLeft`. uz + ru: `order.layoutHorizontal`, `order.layoutVertical`, `order.layout`.
- [x] Verify: check + build, harness on a scratch copy: both layouts at 1366x768 and 1920x1080 (no page scrollbar: `scrollHeight <= clientHeight` on document and frame), toggle survives a reload, add a dish by click and Enter, disabled card, dark theme.
- Version: patch (UI only).

### F16 built (2026-11-09, not committed)

- Order column `clamp(360px, 33%, 480px)`; header and footer wrap (total on its own row, three equal buttons). The unit price moved under the dish name (the separate "Narxi" column did not fit 416 px).
- `menu-browser.ts`: `createCategoryList` (one list, `orientation`), `menuItemCard`, `createMenuGrid`, `layoutToggle`, `thumb`. `menuLayout` per machine in `savdochef.ui`. Dish grid `grid-auto-rows: max-content` (auto rows squeezed the cards, which clip their pictures).
- Tests: `menu-browser.test.ts` (4), `app.test.ts` layout pref. 49 suites / 650 tests.
- Real app (harness `f16.cjs`, scratch copy of the cafe data with pictures switched on and six test categories): 1366x768 A = 4 columns, B = 3; 1920x1080 (zoom 0.8 on this 125 % screen) A = 5, B = 4; no document scroll in any; lines table fits; toggle saves and survives a reload; category change resets the grid scroll and scrolls the active tile into view; wheel scrolls the row sideways; click and Enter add lines; out-of-stock card greyed and disabled; light uz + dark ru screenshots looked at. Not exercised: a real touch swipe and a mouse drag (no touch screen in the harness; native overflow scroll).

### F16b sidebar -> pages menu in the top bar (2026-11-10, asked after F16, not committed)

- `layout/shell.ts`: the 72 px rail (hover/pin drawer) is gone; a gear button between the theme button and the profile opens the same sections and links as a drop-down (closes on a choice, Esc with focus back on the gear, a tap outside, Tab out, route change; focus goes to the current page's link). The update dot shows on the gear too. `layout.css`: one-column frame, drop-down styles; drawer tokens removed.
- The freed width (rail 72 + gap 12) goes to the order column: `clamp(444px, calc(33% + 56px), 564px)` in both menu layouts, so the menu side is exactly as wide as in F16 (1366: order 416 -> 500, menu 828; 1920: 480 -> 564, menu 1316).
- Test: `shell.test.ts` (menu replaces the sidebar, only allowed pages, open/close paths). 49 suites / 651 tests.
- Real app (harness `f17.cjs`, same scratch copy): no `.sidebar`, menu 260 px under the gear with 7 links for the admin, outside tap / Esc / link close it, link navigates; no document scroll on the order page in A and B at 1366x768 and 1920x1080, the tables page outlet now starts at x 12; light uz + dark ru screenshots looked at.

## F17 service fee, Start plan without debtors, waiter earnings + Xodimlar bo'yicha hisobot (approved 2026-11-10: all questions = R)

Copies: the delivery fee (setting `deliveryFeeDefault` -> `orders.deliveryFee`, part of `totalAmount`, own receipt row, `deliveryFees` in the sales report) for the service fee; `reports:sales` + the Reports tabs for the new report; licence gating as `licensed('takeaway')` / `featureNeeded` (license-core.ts) for debtors.

### 1. Service fee (xizmat haqi)

- Settings (Settings → Buyurtmalar, `orders-section.ts`), keys in `settings.ts` + seed defaults: `serviceFeeType` `off | percent | perGuest` (default `off`: nothing changes for anyone after the upgrade), `serviceFeePercent` (0–100, decimal), `serviceFeePerGuest` (so'm). Admin (`settings`) as today.
- Order: `guestCount` saved with a table order (stepper "Mehmonlar" in the order header, shown only when the per-guest fee is on, Q3). Main computes the fee on every save, inside the save transaction, from the settings at that moment, rounded once (`roundMoney`):
  - percent: `lines total × p / 100`; per guest: `guestCount × amount`.
  - Before: `totalAmount = lines total` (+ delivery fee). After: `totalAmount = lines total + serviceFee` (+ delivery fee). The order screen shows "Xizmat haqi" above "Jami" (renderer mirrors the formula for display only; main's number is what is stored).
  - Payment, guest split, debt and check edits use `totalAmount` as now, so the fee is paid like the rest. A settings change applies to orders saved after it; an already saved order keeps its fee until it is saved again.
- Receipt + pre-bill (`receipt.ts`): a row "Xizmat haqi (10%)" / "Xizmat haqi (3 × 5 000)" when > 0. Checks view: fee in the detail line like the delivery fee. Sales report: `serviceFees` total next to `deliveryFees`; Z/shift report: one row "Xizmat haqi".
- No stock effect.

### 2. Start plan: Debtors off

- STARTER's features are `[]` on the server (posgro `savdochef-config.ts`): selling on debt is already refused there (`payments:pay`, `checks:update`). New: the Debtors link and `/debtors` route need `licensed('debt')` (route access gains a licence check in `routes.ts`/`router.ts`), the Settings → To'lovlar "Nasiya" switch shows the plan note, and main refuses `debts:*` / `customers:update` without the `debt` feature (`featureNeeded`, Q7).

### 3. Waiter earnings + report

- `users.earningsPercent` (decimal 0–100, default 0): set per user in Xodimlar (users-view create/edit modal, "Ish haqi foizi, %"); `users:create`/`users:update` take it (access as today: `users`).
- Snapshot at payment (Q6): `orders.waiterPercent` = the opener's (`createdById`) percent when the order is paid (`payments:pay`); a later rate change does not rewrite past earnings. Check edits keep it.
- New channel `reports:staff` (`reports` permission, read-only; ranges longer than a day need the `reports` feature like `reports:sales`): per user for paid orders in the range: orders, guests, dishes total (the base, Q5), service fee, percent, earnings = Σ base × waiterPercent / 100 per order, rounded once per user; totals row.
- Reports → new tab "Xodimlar bo'yicha hisobot" (table, same range controls; print not in scope).

### Schema (migration 0018 `service_fee_staff_pay`, additive)

- `orders.serviceFee DECIMAL NOT NULL DEFAULT 0`, `orders.guestCount INTEGER NULL`, `orders.waiterPercent DECIMAL NULL`; `users.earningsPercent DECIMAL NOT NULL DEFAULT 0`. Installed databases: old orders get fee 0, no guest count, no percent (they count in the report with 0 earnings); every user 0 %. Settings keys seeded with `off`. Skill `prisma-migration`, then `migration-reviewer`; `prisma-reviewer` on orders/payments/reports.

### Files

- shared: `schemas.ts` (settings, save inputs `guestCount`, user `earningsPercent`, `staffReportInput`), `types.ts` (`OrderDto.serviceFee/guestCount`, `UserDto.earningsPercent`, `StaffReport`), `ipc.ts` (`reports:staff`), `utils/service-fee.ts` (one formula used by main and the order screen) + tests.
- main: `orders/orders.ts` (fee in table + open saves), `payments/payments.ts` (snapshot), `users/users.ts`, `settings/settings.ts`, `database/seed.ts`, `reports/reports.ts` (`staffReport`, `serviceFees`), `printing/receipt.ts` + `shift-report.ts`, `license/license-core.ts`, `ipc/handlers.ts` + `events.ts` (read-only), migration + `index.ts`, schema.
- renderer: `order-view.ts` (guest stepper, fee row), `settings/orders-section.ts`, `users/users-view.ts`, `reports/reports-view.ts` (+ `staff-report.ts`), `shell.ts` + `routes.ts` (debtors), `checks-view.ts`; uz + ru strings (fee labels, settings, guests, earnings %, report columns, plan note).

### Tests and verification

- `service-fee.test.ts` (percent rounding, per guest, off), `orders.test` (fee stored and in total, changes with lines/guests, takeaway rule per Q1, settings change only on next save), `payments.test` (snapshot), `reports.test` (staff report exact Decimal sums, legacy rows 0), `license.test` (debts refused on Start), `database.test` (drift), `ipc.test` access snapshot, `routes.test` (debtors hidden without the feature).
- Real app: build, harness on a scratch copy of the cafe data: percent fee and per-guest fee on a table order, pay, receipt + pre-bill PNG (fake printer), check in the sales report, earnings % on a waiter, report tab uz + ru light/dark; Start plan (licence state patched on the copy): no Debtors link, `/debtors` redirects, `debts:list` refused.
- Version: **minor (0.10.0)**: migration + features. 0.9 satellites need the update (F15 button on their waiting card).

### Open questions

1. Service fee only on table (dine-in) orders (R), or on takeaway/delivery too?
2. One fee type at a time, chosen in Settings: off / % / per guest (R), or both together?
3. Per guest: the waiter sets the guest count on the order screen, default 1, saved with the order (R)? Or the cashier enters it at payment?
4. May an admin take the fee off a single order (e.g. a "Xizmat haqisiz" switch on the order, `corrections` permission)? R: not in this version.
5. Earnings base: the dishes total of the waiter's paid orders, without service fee and delivery fee (R)? Or dishes + service fee, or only the service fee?
6. The waiter is who opened the order (R; moving tables keeps them), and the percent is fixed when the order is paid (R)?
7. Start plan: hide Debtors and refuse every debt call, so debts left from a Pro period cannot be collected until upgrading (R, as "off")? Or keep the page for collecting old debts only?

### F17 built (2026-11-10, not committed)

- Migration 0018 (4 x ADD COLUMN; migration-reviewer: safe). Fee in `shared/utils/service-fee.ts`, whole so'm half up; stored on every table save (`orders.ts`), 0 on takeaway/delivery; receipt + pre-bill row (guests shown for per-guest), check detail row, sales report `serviceFees` (Zalda tile note), shift summary + X/Z report row "Shundan xizmat haqi". Order screen: guest stepper (per-guest only, default 1, always sent while per-guest is on), fee row; a saved unchanged order shows the stored fee and total (what payment checks), a changed one the next save's.
- `waiterPercent` copied at `payments:pay` for every order type (a cashier with a percent earns on takeaway too; documented). `reports:staff` (`reports` permission; > 1 day needs the plan feature): orders on the day of their first payment like the sales report, refunded legacy checks left out; rounded once per user.
- Start plan: `debts:*` + `customers:update` refused in main without `debt`; `/debtors` route `feature: 'debt'` (router `inPlan`), gear-menu link hidden (re-checked on licence change), Settings → To'lov note. `reports` permission text now says it shows staff earnings.
- Reviews: migration safe; prisma-reviewer and security-reviewer findings fixed (report day rule + refunded, stored fee on screen, secrets test now really returns a row with local date, all 7 debt channels in the plan test, more fee tests). Not changed: `residuals:list`/`expenses:list` accept any range on Start (pre-F17 gap); a user with `users` can edit their own percent (same trust as permissions).
- Tests: service-fee (shared 4, domain 6), license, routes, schemas, secrets. 51 suites / 666 tests.
- Real app (harness `f17b.cjs`, fresh copy of the v17 cafe data -> migrated to v18 with a `savdochef-v17-*` backup): per-guest 5 000 x 4 guests on a 6 000 order -> 20 000 fee, 26 000 total, stored and reopened unchanged; percent 10 % on 9 000 -> 900; waiter 5 %; paid; pre-bill and receipt text show the fee rows; staff report 2 orders, 4 guests, sales 15 000, fees 20 900, earnings 750 (uz light + ru dark); shift summary fees 20 900; Start plan (licence answer patched in the window): no Debtors link, `/debtors` -> `/tables`, To'lov note. Screenshots looked at.
- Version: 0.10.0 (minor) at release; repeat the install-over-0.9.1 upgrade test then.

## Release 0.10.0 (F16 + F17, 2026-11-10)

- Commit `1dfbca0` (F16 + F17), `npm run release -- minor`: check 51 suites / 666 tests, commit + tag `v0.10.0`, `release/v0.10.0/SavdoChef-Setup-0.10.0.exe` sha256 `718effff8253a6482e4f8e7fc26a8a9a1fddb23a14f7e7cd6d4e57ccf1dd3877`. Not pushed, not uploaded.
- Upgrade test on this PC: silent install 0.10.0 over 0.9.1 (exit 0, exe 0.10.0) -> packaged run with `--user-data-dir` = scratch copy of the v17 cafe profile (`up10`): backup `savdochef-v17-*` written, migrated v17 -> v18 (0018); every table's row count identical except settings 18 -> 21 (the three service-fee keys, seeded `off`), orders total identical (50 000); closed normally. This PC now has 0.10.0 installed. The update feed serves 0.9.1.
- 0.9 satellites are not compatible with a 0.10 main till: they need this update (F15 button on their waiting card, once 0.10.0 is on the feed).
