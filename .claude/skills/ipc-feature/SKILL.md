---
name: ipc-feature
description: Build a SavdoChef feature end to end through the typed IPC chain (zod schema, channel map, main handler with access, domain module with tests, change events, renderer api call, vanilla view, uz/ru strings). Use whenever the user asks for a new screen, action, setting, report or anything that crosses renderer and main.
---

# IPC feature workflow

1. **Read first.** Pick the closest existing feature (e.g. `printing:printReceipt`, `menu:update`, `sessions:close`) and follow its chain file by file. No parallel patterns.
2. **Data:** if the schema changes, do skill `prisma-migration` first.
3. **Schema:** input in `src/shared/schemas.ts` (zod; ids via `id`, money/qty as decimal strings). DTO types in `src/shared/types.ts` (Decimal as `string`).
4. **Channel:** add `'<ns>:<action>': Channel<In<typeof S.x>, T.Result>` to `IpcChannels` and the name to `IPC_CHANNELS` in `src/shared/ipc.ts`. Preload and the renderer client pick it up automatically.
5. **Domain:** function `(db, actor, input)` in `src/main/<domain>/<file>.ts`. Multi-step writes in `db.$transaction`. Expected failures: `AppError` helpers from `main/domain/errors.ts` with Uzbek messages. No Electron imports (inject services via `HandlerServices` like `printer`).
6. **Handler:** entry in `HANDLERS` (`src/main/ipc/handlers.ts`) with `pub`, `user` or `admin`. Pick the narrowest access; admin for anything that changes settings, users, menu or money after the fact.
7. **Events:** read-only → `READ_ONLY_CHANNELS`; otherwise list the change events in `CHANNEL_EVENTS` (`src/main/ipc/events.ts`).
8. **Tests:** domain tests against `createTestDb()`; update the access snapshot in `ipc.test.ts`; if the result can contain user data, check `secrets.test.ts` still covers it. Money and stock: test the exact Decimal results.
9. **Renderer:** call `api.<ns>.<action>()`; handle `ApiError` (`toastError`, `showFormError`). View in `src/renderer/views/<area>/`, markup with `html\`\``, route in `renderer/main.ts` with matching `access`. Subscribe to change events for refresh.
10. **i18n:** every string in both `uz.json` and `ru.json`.
11. **Verify:** `/check`, then `npm run build` and an Electron harness on a scratch `userData` copy (see `tasks/lessons.md`); screenshot and look at it. Report what ran.
