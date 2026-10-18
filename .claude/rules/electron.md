---
paths:
  - "main.js"
  - "preload.js"
  - "printing.js"
  - "*.page.js"
  - "*-window.js"
  - "renderer/**/*.js"
  - "html/**/*.html"
  - "utils/**/*.js"
---

# Electron / renderer rules

- Every `BrowserWindow` uses `contextIsolation: true` and `nodeIntegration: false`, with `preload: getPreloadPath()` from `paths.js`. Don't relax these.
- The renderer reaches the main process only through `window.electronAPI` (defined in `preload.js`). To add a capability: expose one narrow function in `preload.js`, register the handler in `main.js` (`ipcMain.handle` for request/response, `ipcMain.on` for fire-and-forget). Never expose `ipcRenderer` itself or accept file paths/URLs from the renderer without validation.
- `preload.js` is CommonJS-style (`require('electron')`) inside an ESM package. Keep it that way.
- Renderer scripts are ES modules loaded by the HTML pages in `html/`. Keep one page script per window; shared helpers live in `utils/` or `renderer/`.
- API calls from the renderer go to `http://localhost:3000/api/...`. Check `res.ok` and surface failures with `showAlert` from `utils/alert.js`, not `window.alert`.
- Child windows tell the parent to refresh via IPC events (`session-updated`, `menu-updated`/`reload-menu`). Reuse these instead of polling.
- Don't use `innerHTML` with API data (dish names, notes, usernames) without escaping; existing code has an `esc` helper pattern in `printing.js`. Prefer `textContent`.
- `html/index.html` has a Content-Security-Policy meta tag. If you add scripts, styles or remote resources, update it deliberately instead of loosening it to `unsafe-inline`/`*`.
- Receipt HTML is built in `printing.js` and must stay in visual sync with the `#checkPreview` markup in `html/payment.html`. Change both or neither.
- Uzbek (Latin) for UI text.
