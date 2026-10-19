---
description: Format, typecheck, lint, test and build-check SavdoChef; fix failures
allowed-tools: Bash(npm run check*), Bash(npm run format*), Bash(npm run typecheck*), Bash(npm run lint*), Bash(npm test*), Bash(npm run build), Bash(git diff*), Bash(git status*)
---

Changed vs main:

!`git diff --name-only main...HEAD`

Uncommitted:

!`git status --short`

Run in order, stopping at the first failure (fix it, then re-run that stage):

1. `npm run format:check` (if it fails: `npm run format`, then look at the diff; only files this change touched should move)
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run build` if anything under `src/`, `prisma/` or the vite/builder configs changed.

Also confirm:
- a schema change has a matching migration (the drift test covers it) and the `migration-reviewer` agent ran;
- new UI strings exist in both `uz.json` and `ru.json`;
- no `.db` file, `.env`, or anything under `legacy/` is staged.

Finish with 3 lines: what passed, what you fixed, what is left (including anything only a run in the real app can confirm).
