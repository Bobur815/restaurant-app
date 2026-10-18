// Hand-written. Keeps sessions.openGuard in step with sessions.status in the database itself,
// so no code path can close a shift and forget to release the one-open-shift guard (or reopen
// one without taking it). openGuard = 1 while status = 'open', NULL otherwise; the UNIQUE index
// on openGuard then allows at most one open shift. Reopening a shift while another is open
// fails with a UNIQUE constraint error (Prisma P2002).
//
// Triggers are invisible to `prisma migrate diff`, so they do not show up as schema drift.
export const sql = `
-- Bring existing rows in line (no-op on a fresh database).
UPDATE "sessions" SET "openGuard" = CASE "status" WHEN 'open' THEN 1 ELSE NULL END
WHERE "openGuard" IS NOT (CASE "status" WHEN 'open' THEN 1 ELSE NULL END);

CREATE TRIGGER "sessions_open_guard_insert"
AFTER INSERT ON "sessions"
FOR EACH ROW
WHEN NEW."openGuard" IS NOT (CASE NEW."status" WHEN 'open' THEN 1 ELSE NULL END)
BEGIN
  UPDATE "sessions" SET "openGuard" = CASE NEW."status" WHEN 'open' THEN 1 ELSE NULL END
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "sessions_open_guard_update"
AFTER UPDATE OF "status", "openGuard" ON "sessions"
FOR EACH ROW
WHEN NEW."openGuard" IS NOT (CASE NEW."status" WHEN 'open' THEN 1 ELSE NULL END)
BEGIN
  UPDATE "sessions" SET "openGuard" = CASE NEW."status" WHEN 'open' THEN 1 ELSE NULL END
  WHERE "id" = NEW."id";
END;
`;
