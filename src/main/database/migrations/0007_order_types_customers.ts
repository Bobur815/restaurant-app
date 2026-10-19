// Feature F1-B: takeaway and delivery orders, customers. Additive, written by hand.
//
// Prisma's own diff for these columns is a "RedefineTables" rebuild of `orders` (new table,
// copy, DROP, rename). That is not safe here: migrations run inside a transaction, where SQLite
// ignores `PRAGMA foreign_keys=OFF`, so dropping the old table would cascade-delete every order
// line. Plain ADD COLUMN gives the same schema (the drift test in database.test.ts checks it)
// without touching a single row. SQLite allows ADD COLUMN with a REFERENCES clause when the
// column defaults to NULL.
//
// The pending-table triggers from 0003 are replaced: only a pending DINE_IN order holds its
// table, so any number of takeaway/delivery orders (tableNumber 0) can be open at once.
export const sql = `
-- CreateTable
CREATE TABLE "customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "landmark" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'DINE_IN';
ALTER TABLE "orders" ADD COLUMN "customerId" INTEGER CONSTRAINT "orders_customerId_fkey" REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD COLUMN "customerName" TEXT;
ALTER TABLE "orders" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "orders" ADD COLUMN "deliveryAddress" TEXT;
ALTER TABLE "orders" ADD COLUMN "deliveryNote" TEXT;
ALTER TABLE "orders" ADD COLUMN "deliveryFee" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "orders" ADD COLUMN "courierName" TEXT;

-- CreateIndex
CREATE INDEX "orders_orderType_status_idx" ON "orders"("orderType", "status");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- Pending-table guard (0003), now for dine-in orders only.
DROP TRIGGER "orders_pending_table_insert";
DROP TRIGGER "orders_pending_table_update";

CREATE TRIGGER "orders_pending_table_insert"
AFTER INSERT ON "orders"
FOR EACH ROW
WHEN NEW."pendingTable" IS NOT (CASE WHEN NEW."status" = 'pending' AND NEW."orderType" = 'DINE_IN' THEN NEW."tableNumber" ELSE NULL END)
BEGIN
  UPDATE "orders" SET "pendingTable" = CASE WHEN NEW."status" = 'pending' AND NEW."orderType" = 'DINE_IN' THEN NEW."tableNumber" ELSE NULL END
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "orders_pending_table_update"
AFTER UPDATE OF "status", "tableNumber", "pendingTable", "orderType" ON "orders"
FOR EACH ROW
WHEN NEW."pendingTable" IS NOT (CASE WHEN NEW."status" = 'pending' AND NEW."orderType" = 'DINE_IN' THEN NEW."tableNumber" ELSE NULL END)
BEGIN
  UPDATE "orders" SET "pendingTable" = CASE WHEN NEW."status" = 'pending' AND NEW."orderType" = 'DINE_IN' THEN NEW."tableNumber" ELSE NULL END
  WHERE "id" = NEW."id";
END;
`;
