---
description: Change the Prisma schema safely, including the seed DB and existing installs
argument-hint: <describe the schema change>
---

Schema change requested: $ARGUMENTS

Context you must account for (see CLAUDE.md "Known traps" #4 and #5):

- The packaged app copies `backend/prisma/data/app.db` to the user's data folder only if no DB exists there. Existing installs keep their old schema, and `migrate deploy` is not run at startup.
- `backend/prisma/data/app.db` and `backend/prisma/savdochef.db` are tracked in git and must not contain real customer data.

Steps:

1. Read `backend/prisma/schema.prisma` and the existing migrations in `backend/prisma/migrations/`.
2. Propose the change and classify it: additive (new nullable column/table/index) vs breaking (rename, drop, type change, new required column without default). For breaking changes, write the data-migration plan before editing anything and wait for my confirmation.
3. Edit `schema.prisma`, then `npm --prefix backend run migrate:dev -- --name <snake_case_name>` (this asks for permission). Review the generated SQL; SQLite rebuilds tables for many alterations, check for data loss.
4. Run `npm --prefix backend run generate`.
5. Update every service/validator/renderer file that touches the changed fields. Grep for the old names.
6. State clearly what is needed for existing installs (e.g. startup `migrate deploy`) and what is needed for the seed DB. Don't edit `.db` files directly.
7. Money/quantity columns use `Decimal`; enum additions must also be added to the Joi enums in `utils/Joi.validation.js` and any renderer-side maps (`utils/paymentMethods.js`, `utils/payStatuses.js`).
