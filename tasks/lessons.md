# Lessons

Mistakes and surprises worth not repeating. One line each where possible, newest at the end of each section. Add to it when corrected or bitten.

## Data safety

- The real data is in `%APPDATA%\SavdoChef` (imported from the legacy app on 2026-10-19). Harnesses, smoke tests and upgrade tests run on a **copy** in a scratch `userData`; the real folder is only ever read to copy it. `guard-bash` blocks deleting/moving it and opening it with sqlite3.
- Before any operation that writes a real database (import, repair): back up, dry-run on a copy, then run. `legacy-import.ts --replace` moves the old database to `backups/` first.

- Never ship Prisma's `RedefineTables` SQL (new table, copy, DROP, rename) for a table others reference: our migrations run in a transaction, where `PRAGMA foreign_keys=OFF` does nothing, so the DROP cascades (order lines) or fails (payments). Write ADD COLUMN by hand (a FK column is allowed when it defaults to NULL) and let the drift test prove the schema matches (migration 0007).

## Electron and Chromium

- Electron's ICU has no Uzbek: `Intl`/`toLocaleString('uz')` silently fall back. All number/date text goes through `shared/utils/format.ts`.
- Native date inputs follow the Chromium UI locale, not the page: `app.commandLine.appendSwitch('lang', 'ru')` gives day-first dates.
- Formatted numbers use a non-breaking space (U+00A0) as the thousands separator. In tests match it with `\s` or `\u00a0`; a literal NBSP in source fails eslint `no-irregular-whitespace`.
- Electron 44's `PrinterInfo` has no `isDefault`; the hint is in `options['printer-is-default']` and is often missing.
- `webContents.capturePage()` on an `offscreen: true` window fails with `UnknownVizError`. Use a hidden normal window with `paintWhenInitiallyHidden: true` and `capturePage(undefined, { stayHidden: true })`.
- `document.documentElement.scrollHeight` is never smaller than the viewport. To size a receipt page, measure `document.body.getBoundingClientRect().bottom` (plus margin), or every receipt feeds blank paper.
- Prisma 6 requires `url = env("DATABASE_URL")` in the datasource even though the app passes the path at runtime. Don't remove it.

## Verifying in the real app

- Harness pattern (`npm run build` first): a `.cjs` script run with `npx electron harness.cjs <repo path>` that sets `app.getAppPath = () => root`, `app.setPath('userData', <scratch copy>)`, hooks `browser-window-created` -> `did-finish-load`, drives the page with `webContents.executeJavaScript`, saves `capturePage()` PNGs, and **writes its log to a file** and ends with `process.exit`. Piping Electron's stdout through `tail`/`grep` buffers everything and looks like a hang. Ignore the hidden receipt windows (first window only). Give views 3-4 s after navigation before querying them.
- The packaged exe accepts `--user-data-dir=<path>`; fuses disable runAsNode, so harness scripts only work with the dev Electron against `dist-electron`.
- Silent install for tests: `MSYS_NO_PATHCONV=1 ./SavdoChef-Setup-x.y.z.exe /S "/D=C:\win\path"` (`/D` last, Windows path, no quotes inside). Uninstall: `"Uninstall SavdoChef.exe" /S`. Without `MSYS_NO_PATHCONV`, Git Bash rewrites `/S` into a path.
- Look at the screenshots. Tests passed while the preview had a layout overflow and blank paper; only the image showed it.

## Editing on Windows / Git Bash

- Files may be CRLF. Scripts that patch by exact string must normalise `\r\n` first and write back the original line ending.
- Prettier reflows lines after the first edit; anchor later patches on the formatted text, not on what you wrote.
- Git Bash heredocs and `sed` eat backslashes (`\u00a0` became `00a0`, `\s` became `s`). For text with backslashes write a script file and build the character with `String.fromCharCode(92)` / `chr(92)`, then check the bytes (`od -c`).
- Long inline scripts in Bash calls fail unpredictably; write them to the scratchpad and run them from there.
- `guard-bash` checks the whole command text: a heredoc or commit message that mentions a blocked command (e.g. writing docs about it) is blocked. Put that text in a file and pass the file.
- `.claude/settings.json` hooks apply immediately in the running session, not only in the next one.
- `guard-bash` also blocks a line that moves a scratch folder and later copies **from** `%APPDATA%\SavdoChef`; run the move and the copy as separate commands.

## Tests

- After a review fix, run the harness again before calling it done: an early return added for 0 totals in `settleTenders` silently broke the "Qolgan" button, which used the same function to sum the other lines (caught only by the UI run, F1-C).

- A test that loops over channels must assert the call succeeded. `secrets.test.ts` passed `{}` to channels without input; they failed validation and "no secret in the result" passed on the error, so half the read channels were never checked (found in F1-A review).
