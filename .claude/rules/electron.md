---
paths:
  - "src/main/**"
  - "src/renderer/**"
  - "src/shared/**"
---

# Electron rules (vanilla TS, no framework)

- **IPC chain:** `shared/schemas.ts` (zod) → `shared/ipc.ts` (`IpcChannels` + `IPC_CHANNELS`) → `main/ipc/handlers.ts` (`pub`/`user`/`admin`) → domain function `(db, actor, input)` → renderer `api.<ns>.<method>()` from `@renderer/api`. Only `src/renderer/api` touches `window.electronAPI` (lint-enforced); nothing touches `ipcRenderer` except `preload.ts`. Full steps: skill `ipc-feature`.
- Every channel is either in `READ_ONLY_CHANNELS` or emits change events (`main/ipc/events.ts`); `events.test.ts` enforces it. Views refresh by subscribing, never by polling.
- Access is enforced in main (`ipc-safe.ts`) on every call. UI hiding (`isAdmin(role)`, route `access`) is cosmetic. New channels appear in the access snapshot in `ipc.test.ts`; update it deliberately.
- Domain modules take `Db` and plain inputs, contain no Electron imports, and are tested against a real temporary SQLite (`main/test-utils/db.ts`). Expected failures throw `AppError` (`notFound`, `conflict`, ...) with an Uzbek message; anything else surfaces as `INTERNAL` and is logged.
- **Decimal across IPC as strings** (`shared/utils/decimal.ts`). Round once, when stored or shown.
- **DOM:** `html\`...\`` from `renderer/ui/html.ts` (escapes every value, attribute values must be quoted) or `textContent`. No `innerHTML`; `raw()` only for markup this code wrote. Icons via `ui/icons.ts` (lucide).
- Views live in `renderer/views/<area>/`, are registered in `renderer/main.ts` (`path`, `access`, `layout`), are a `View` returning `{ el, destroy?, canLeave? }` (`views/types.ts`; `destroy` drops subscriptions and timers), and use `components/` (forms, modal, toast, page). Styling: CSS in `renderer/styles/` with the tokens on `:root` (light and dark); no inline `style=` (CSP).
- i18n: every string in BOTH `i18n/locales/uz.json` and `ru.json`; dish names via `localName()` (`nameUz`/`nameRu`). Numbers/dates only through `shared/utils/format.ts`.
- `webPreferences` stay `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The CSP in `renderer/index.html` stays strict (`devCsp()` in `electron.vite.config.ts` loosens it only for the dev server). Windows that load generated content (receipt) get no preload and deny navigation and `window.open`.
- Hardware (printers) runs in main with timeouts and never blocks a sale: the renderer fires and shows a toast.
- Packaging: no `node_modules` ship; electron-vite bundles main deps. Native or path-loaded files need `asarUnpack` and `files` in `electron-builder.config.js`. Fuses disable runAsNode, so harnesses run with `npx electron <script>` against `dist-electron`, not the packaged exe.
