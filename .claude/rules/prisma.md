---
paths:
  - "prisma/**"
  - "src/main/database/**"
---

# Database rules (SQLite on the till)

- `prisma/schema.sqlite.prisma` describes the schema; `src/main/database/migrations/NNNN_name.ts` change real databases. The app never runs `prisma migrate` or `db push`. `database.test.ts` builds a database from the migrations and fails on any drift from the schema, printing the SQL to add.
- **Additive only:** new table, nullable column, column with default, index, trigger. Never drop, rename, retype, or add NOT NULL without a default. Never edit, reorder or remove a released migration (installed databases already applied it).
- Migrations run on every start inside a transaction with the `user_version` bump, after a `VACUUM INTO` backup. A database newer than the build is refused. Multi-statement SQL is split by `splitStatements` (`CREATE TRIGGER ... END;` stays whole).
- Invariants that must hold even if the code is wrong live in the database (one open session, one pending order per table, foreign keys). Add a trigger or constraint plus a test in `database.test.ts` "database-level guarantees".
- Money/quantity columns are `Decimal`. Seed data (`seed.ts`) only inserts what is missing; it never overwrites a user's change.
- Data repair or import on a real database: back up first (the app's backups folder or a copy), dry-run on a copy, then run. `legacy-import.ts` is the pattern.
- After any schema edit: `npx prisma validate`, `npx prisma generate` (or `npm run db:generate`), `npm test -- database`. Then run the `migration-reviewer` agent.
- `npx prisma migrate reset`, `db push`, `--force-reset` and `--accept-data-loss` are blocked by hook.
