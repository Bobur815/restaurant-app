---
name: prisma-migration
description: Safe schema change for SavdoChef's SQLite database (Prisma schema + numbered migrations that upgrade installed tills in place). Use whenever the user wants to add or change a table, column, enum, index, relation or constraint, or says migration, schema, prisma, "add a field".
---

# Schema change workflow (installed tills upgrade in place)

1. **State the change in one sentence and classify it:** additive (new table, nullable/defaulted column, index, trigger) or breaking. Breaking → redesign as expand/contract (add new, dual-write, backfill, switch reads; never drop in the same release). Ask the user before editing the schema.
2. Edit `prisma/schema.sqlite.prisma`. New columns nullable or `@default(...)`; enum values only added; money/qty `Decimal`.
3. `npx prisma validate && npx prisma format`, then `npm run db:generate`.
4. `npm test -- database`: the drift test fails and prints the SQL. Create `src/main/database/migrations/NNNN_<snake_name>.ts` exporting `sql` (header comment: what and why, "additive"), and append `{ version: N, name, sql }` to `MIGRATIONS` in `migrations/index.ts`. Never touch earlier entries.
5. **Read the SQL.** Stop on `DROP`, table rebuilds (`CREATE TABLE "new_..."` + `INSERT ... SELECT`) that could lose data, or `NOT NULL` without default. Triggers end with a line `END;`.
6. Re-run `npm test -- database` (drift empty; upgrade, backup and rollback tests pass). Add a test for any new invariant.
7. Update shared schemas/types, domain modules, seed (insert-if-missing only), `legacy-import.ts` if the field has a legacy source, and UI. Grep for every use of changed models.
8. Run the `migration-reviewer` agent.
9. Release note: a migration means a **minor** version (`npm run release -- minor`). The upgrade test in `tasks/todo.md` Phase 8 (install previous version, run on a data copy, install new version over it, compare counts) must be repeated for the first release carrying it.
