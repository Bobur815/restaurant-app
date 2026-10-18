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
- [-] ~~One-time importer from the old `app.db`~~: not needed, no live installs.
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
- [ ] Not done: per-day dish breakdown (legacy showed dishes per day; the range total is shown), waste/breakage expense entry (no legacy UI either), reprint from checks (Phase 7).

## Phase 6: security and correctness fixes (carry-over from the audit)

- [ ] Passwords hashed (bcryptjs) everywhere; importer rehashes; no password field ever returned over IPC.
- [ ] Every handler checks `getCurrentUser()` and role/permission; UI hiding is cosmetic only.
- [ ] No `file://` paths from the renderer; custom protocol with containment check.
- [ ] Receipt HTML escapes all interpolated values; print window has no preload and no node access.
- [ ] Logger writes to `app.getPath('logs')` (electron-log), not `process.cwd()`.
- [ ] Delete: Express, cors, helmet, Joi, winston, `backend/`, legacy Mongoose models, `SetupGate.js`, `/health` probing, `config.env.js` dotenv-in-production hack (settings live in DB or `userData` JSON).

## Phase 7: printing

- [ ] Move to `src/main/printing/`: receipt HTML builder (shared with the preview component so they cannot drift) + silent print. Decide between Chromium silent print (current) and ESC/POS (`@node-escpos/*` deps already declared but unused): **decision** based on the printers actually used on site.
- [ ] Printer selection stored in settings, timeouts, "printer offline" error surfaced in the UI without blocking the sale.
- [ ] Kitchen ticket (optional): same pipeline, second template.

## Phase 8: packaging and release

- [ ] electron-builder config (NSIS installer for Windows, optional AppImage/deb), `asarUnpack` for the Prisma engine only; electron-vite bundles main deps (no `node_modules` shipped), like posgro.
- [x] Branding (posgro structure, vanilla): `src/shared/branding/brand.ts` is the single source (colors, name, uz/ru/en taglines, Icon / Wordmark / Horizontal / Square as SVG trees, chef-hat artwork redrawn as vectors from the original icon, transparent outside the tile). `src/renderer/branding/` renders them as DOM SVG. `npm run build:icons` writes `build/icons/*.svg`, `savdochef.ico` (16-256), 1024 px PNGs and `src/renderer/public/favicon.svg`; `brand.test.ts` fails if they are stale. Wired into window icon, NSIS installer/uninstaller, Linux, favicon, boot screen. UI tokens: `--color-brand` #F8901F; `--color-primary` #B4530B in light (AA with white text), brand orange in dark.
  - [ ] Wordmark renders in Segoe UI (no Poppins-like font installed); bundle a font under `font-src 'self'` if the original look matters.
- [ ] Cold start right after an install/update: 7-26 s on the dev machine (first load of freshly written files, likely antivirus scanning; warm start ~0.1 s to DB). Measure on a real till after installing an update; consider fewer/larger files if it reproduces.
- [ ] electron-updater + a release script; version bump rule per change.
- [ ] Parity pass against the Phase 0 inventory on a Windows machine with a real receipt printer; fill the checklist item by item.
- [ ] Upgrade test between two versions of the **new** app (vN → vN+1 with data), not from legacy.

## Phase 9: `.claude/` and docs

- [ ] Rewrite `CLAUDE.md` for the new stack (commands, IPC chain, hard rules: additive DB upgrades, no float math on money, back up before any data operation).
- [ ] Port from posgro: `rules/electron.md` (minus React/Styled Components/Zustand lines, plus "vanilla TS, `html` helper, no innerHTML with data"), `rules/prisma.md`, skill `ipc-feature` (rewritten for the vanilla chain), skill `prisma-migration` (SQLite section), `commands/check.md` + `plan.md`, `agents/migration-reviewer.md`, hooks (`guard-bash`, `format`).
- [ ] Replace the current `/new-endpoint` and `/add-ipc` commands; they describe the Express design.
- [ ] `tasks/todo.md` for ongoing work, `tasks/lessons.md` for mistakes, as in posgro.

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
