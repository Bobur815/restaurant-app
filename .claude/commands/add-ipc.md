---
description: Add a renderer-to-main IPC capability through preload.js
argument-hint: <channel name and what it does>
---

Add an IPC capability: $ARGUMENTS

1. Read `preload.js` (the `api` object) and the matching handlers in `main.js` to follow the existing naming (`kebab-case` for invoke channels like `open-session-window`, `namespace:action` for newer ones like `setup:submit`).
2. Add one narrow function to `api` in `preload.js`. Use `ipcRenderer.invoke` when the renderer needs a result, `ipcRenderer.send` for fire-and-forget. Never expose `ipcRenderer` or generic "send anything" helpers.
3. Register the handler in `main.js`. Validate every argument from the renderer (types, allowed values, path containment). For file paths, resolve against a known base dir and reject anything that escapes it.
4. If the call opens a window, create it via a factory (`*-window.js`) with `contextIsolation: true`, `nodeIntegration: false` and `preload: getPreloadPath()`.
5. Use it from the renderer as `window.electronAPI.<fn>(...)`.
6. Verify by running `npm run dev` if a display is available; otherwise say that it was not run and list what to click to test it.
