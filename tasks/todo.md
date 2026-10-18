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

- [ ] Port `schema.prisma` → `prisma/schema.sqlite.prisma`; generate to `src/generated/prisma-sqlite` (gitignored); load it the way posgro's `sqlite-client.ts` does (runtime `require` from `app.getAppPath()`, `asarUnpack` for the query engine).
- [ ] Rename the misspelled `RecieptSettings` → `ReceiptSettings` now (the rewrite is the only cheap moment).
- [x] Money: **keep `Decimal`** (decided 2026-10-18). Rule: Prisma `Decimal` stays inside main; it crosses IPC as a decimal **string** (never a JS float), and all money/quantity arithmetic goes through one helper in `shared/utils` (decimal.js, the library Prisma itself bundles). Rounding rule defined once there.
- [ ] Replace "copy seed DB on first run" with in-place idempotent upgrades: `database/migrations.ts` (`columnExists`/`ALTER`/`CREATE TABLE IF NOT EXISTS`), run on every start, additive only. This removes the old trap where schema changes never reached existing installs.
- [ ] Seed in code (`seed.ts`), not a committed `.db`: default categories, receipt-settings row, `setup_complete` flag handling.
- [-] ~~One-time importer from the old `app.db`~~: not needed, no live installs.
- [ ] Constraints worth adding while rewriting: single open session (partial unique via migration SQL or a service-level guard inside a transaction), `Residual` uniqueness behaviour reviewed, FK cascade on `OrderItem`/`Payment` decided explicitly.

## Phase 3: domain modules + IPC (backend)

For each module: pure TS in `src/main/<domain>/`, handler in `src/main/ipc/<domain>-handlers.ts`, channels in `src/shared/ipc.ts`, tests. Port order follows dependencies.

- [ ] `auth`: login (bcrypt), `getCurrentUser()`, logout, roles ADMIN/STAFF, permission check helper used by every handler. Lockout/throttle on repeated failures (posgro has `override-throttle.ts` as a pattern).
- [ ] `settings` + `setup`: first-run wizard (admin + receipt settings) in one transaction.
- [ ] `menu` + `category`: CRUD, image storage in `userData/img` via a custom protocol (posgro's `images-protocol.ts`) instead of `file://` paths from the renderer; sanitize names, enforce size/type.
- [ ] `sessions` (trading day): open/close, `SessionItem` initial/sold, remaining computed.
- [ ] `orders`: per-table pending order, `orderNumber` from `Counter` inside the same transaction, `effQty` logic (weight = qty × kg, portions = qty × factor) moved to `shared/utils` with tests.
- [ ] `payments`: cash/card/click/debt, refunds, report queries. All stock + order + payment writes in **one** `$transaction`.
- [ ] `residuals` + `expenses`: carry-to-next / write-off, linked expense.
- [ ] `reports`: aggregates done in SQL, not in the renderer.
- [ ] `users` + permissions.
- [ ] `ipcSafe()` wrapper + typed error codes (`NOT_AUTHENTICATED`, `FORBIDDEN`, `VALIDATION`, `CONFLICT`, `NOT_FOUND`); zod schemas for every handler input.
- [ ] Tests: stock math, order numbering, session close with residuals, payment totals, role enforcement. Port the stock logic with characterization tests against the old behaviour before changing any rule.

## Phase 4: preload and typed API client

- [ ] `shared/ipc.ts`: `type IpcChannels = { 'orders:create': { args: [CreateOrderInput]; result: Order } ... }`.
- [ ] `preload.ts`: one namespaced object (`electronAPI.orders.create(...)`), generated from the channel map; no raw `ipcRenderer` exposed, no listener leaks (return unsubscribe functions for events like `session-updated`).
- [ ] `renderer/api/*.ts`: thin typed wrappers; the only place that touches `window.electronAPI`.
- [ ] Replace parent/child window event juggling (`session-updated`, `reload-menu`) with a single `app:event` broadcast channel and renderer store subscriptions.

## Phase 5: renderer without React

- [ ] Single window, hash router (~40 lines: route table, `render(view)`, guard by role), views mounted into `#app`. Modals replace the old child BrowserWindows (payment, add item, session create, category).
- [ ] `ui/html` tagged template helper that **escapes interpolations by default** (fixes the old `innerHTML` XSS risk), plus `raw()` for trusted markup. Views are `(ctx) => { el, destroy }` functions.
- [ ] `store/`: typed subscribe/get/set module; keep it small, no framework.
- [ ] Styling: `tokens.css` (colors, spacing, radius, shadows) + light/dark via `prefers-color-scheme` and a manual toggle; **Bootstrap dropped entirely** (decided 2026-10-18).
- [ ] i18n: i18next core, every string in both `uz.json` and `ru.json`; Uzbek in Latin script. Menu items and categories get `nameUz` + `nameRu` (decided 2026-10-18; `nameUz` required, `nameRu` optional with fallback to `nameUz`), receipts print in the selected locale.
- [ ] Port views in this order: setup, login, tables/order screen, payment modal, menu + categories, sessions + residuals, checks, reports (Chart.js), settings, users.
- [ ] Hardware-style UX details from the current app: click sound, keyboard-friendly quantity entry, weight entry, portion selector.
- [ ] Accessibility/regression: focus management in modals, Escape to close, no layout break at 1280×720 and 1366×768 (typical POS screens).

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
- [ ] Icons in `build/icons/` (the current forge config points to a missing `build/brand_logo.png`).
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
