---
description: Plan a task before coding - explore, ask, write tasks/todo.md, wait
argument-hint: <task description>
---

Task: $ARGUMENTS

Do NOT write or edit any code yet.

1. Explore the real code for every area this touches (shared schemas/IPC, main domain modules, database/migrations, renderer views, printing, packaging). Name the files and the existing feature you will copy. Check `tasks/lessons.md` and the behaviour reference (`tasks/inventory.md`, tag `legacy-js-express`) where relevant.
2. Ask every clarifying question you need: numbered, one line each, max 7. Design decisions are questions, not assumptions.
3. Write the plan into `tasks/todo.md` as checkable items, covering:
   - files per layer (shared → main → renderer), new IPC channels and their access (`pub`/`user`/`admin`)
   - schema changes: additive only, the migration, effect on installed databases
   - money/stock effects with exact before/after behaviour
   - uz + ru strings
   - tests to add, and how you will verify in the real app (harness on a scratch userData copy, printer, screenshots)
   - version bump (patch/minor/major per `scripts/release.mjs`)
4. Stop and wait for explicit approval.
