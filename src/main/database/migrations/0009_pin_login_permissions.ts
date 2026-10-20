import { PERMISSIONS, ROLE_DEFAULTS } from '@shared/permissions';

// Feature F2 (decided 2026-10-20): login is a unique 4-digit PIN only; users are a name and a
// phone; roles ADMIN / CASHIER / STAFF with per-user permissions.
//
// Not additive, by the user's request: username, passwordHash and the per-user login lock columns
// are dropped (the database is backed up before every migration). Written by hand: Prisma's own
// diff rebuilds `users` (new table, copy, DROP), and dropping a table that orders, payments and
// shifts reference is not possible inside our migration transaction. SQLite's DROP / RENAME /
// ADD COLUMN keep every row and every reference.
//
// - fullName gets the old username where it was empty (it is the user's only name now);
// - the old bcrypt PIN stays as legacyPinCode: it works once and is converted (auth.ts);
// - permissions are the role's defaults.
const json = (list: readonly string[]) => `'${JSON.stringify(list)}'`;

export const sql = `
-- The username becomes the display name where there was none.
UPDATE "users" SET "fullName" = "username" WHERE "fullName" IS NULL OR trim("fullName") = '';

-- Drop the password login.
DROP INDEX "users_username_key";
ALTER TABLE "users" DROP COLUMN "username";
ALTER TABLE "users" DROP COLUMN "passwordHash";
ALTER TABLE "users" DROP COLUMN "failedLoginCount";
ALTER TABLE "users" DROP COLUMN "lockedUntil";

-- The old PIN (bcrypt) for one transition.
ALTER TABLE "users" RENAME COLUMN "pinCode" TO "legacyPinCode";

-- New columns.
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "users" ADD COLUMN "permissions" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_pinHash_key" ON "users"("pinHash");

-- Permissions from the role.
UPDATE "users" SET "permissions" = ${json(PERMISSIONS)} WHERE "role" = 'ADMIN';
UPDATE "users" SET "permissions" = ${json(ROLE_DEFAULTS.STAFF)} WHERE "role" = 'STAFF';
`;
