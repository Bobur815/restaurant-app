// Features F10 + F11: category pictures, printers (one main + kitchen/bar printers), the dish's
// printer and kitchen tickets. Additive, written by hand.
//
// Prisma's own diff adds menu_items.printerId with a "RedefineTables" rebuild of `menu_items`
// (new table, copy, DROP, rename). Not safe: migrations run inside a transaction, where SQLite
// ignores `PRAGMA foreign_keys=OFF`, and order lines, session items, residuals and expenses all
// point at menu_items. Plain ADD COLUMN with a REFERENCES clause (allowed when the column defaults
// to NULL) gives the same schema without touching a row, as in 0007; the drift test checks it.
//
// The main printer row is created here from receipt_settings.printerName (NULL = pick
// automatically, as before), so receipts go to exactly the same printer after the upgrade. A
// database without receipt settings yet (setup not done) still gets the row, with NULL.
//
// printers.mainGuard = 1 while isMain, NULL otherwise; its UNIQUE index allows one main printer.
// Kept in step by triggers (same trick as sessions.openGuard in 0002); code never writes it.
// Triggers are invisible to `prisma migrate diff`, so they do not show up as drift.
export const sql = `
-- AlterTable
ALTER TABLE "categories" ADD COLUMN "imageFile" TEXT;

-- CreateTable
CREATE TABLE "printers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT,
    "windowsName" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "mainGuard" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "printers_mainGuard_key" ON "printers"("mainGuard");

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN "printerId" INTEGER CONSTRAINT "menu_items_printerId_fkey" REFERENCES "printers" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "menu_items_printerId_idx" ON "menu_items"("printerId");

-- CreateTable
CREATE TABLE "kitchen_tickets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "printerId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" DATETIME,
    "error" TEXT,
    CONSTRAINT "kitchen_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "kitchen_tickets_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "printers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "kitchen_tickets_orderId_idx" ON "kitchen_tickets"("orderId");

-- CreateIndex
CREATE INDEX "kitchen_tickets_printerId_idx" ON "kitchen_tickets"("printerId");

-- CreateIndex
CREATE INDEX "kitchen_tickets_printedAt_idx" ON "kitchen_tickets"("printedAt");

CREATE TRIGGER "printers_main_guard_insert"
AFTER INSERT ON "printers"
FOR EACH ROW
WHEN NEW."mainGuard" IS NOT (CASE WHEN NEW."isMain" THEN 1 ELSE NULL END)
BEGIN
  UPDATE "printers" SET "mainGuard" = CASE WHEN NEW."isMain" THEN 1 ELSE NULL END
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "printers_main_guard_update"
AFTER UPDATE OF "isMain", "mainGuard" ON "printers"
FOR EACH ROW
WHEN NEW."mainGuard" IS NOT (CASE WHEN NEW."isMain" THEN 1 ELSE NULL END)
BEGIN
  UPDATE "printers" SET "mainGuard" = CASE WHEN NEW."isMain" THEN 1 ELSE NULL END
  WHERE "id" = NEW."id";
END;

-- The main printer: the one receipts already went to.
INSERT INTO "printers" ("windowsName", "isMain", "updatedAt")
VALUES ((SELECT "printerName" FROM "receipt_settings" WHERE "id" = 1), 1, CURRENT_TIMESTAMP);
`;
