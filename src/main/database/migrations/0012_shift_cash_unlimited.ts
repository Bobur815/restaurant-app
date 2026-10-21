// Feature F6: dishes not counted in a shift (∞) and the shift's cash drawer (opening, counted and
// expected cash, cash in/out). Additive: three defaulted/nullable columns on sessions, one
// defaulted column on session_items, one new table. Written as ALTER TABLE ADD COLUMN rather than
// Prisma's table rebuild, which would drop the open-shift guard triggers of migration 0002.
export const sql = `
-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "openingCash" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "countedCash" DECIMAL;
ALTER TABLE "sessions" ADD COLUMN "expectedCash" DECIMAL;

-- AlterTable
ALTER TABLE "session_items" ADD COLUMN "unlimited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "cash_movements_sessionId_idx" ON "cash_movements"("sessionId");
`;
