// Feature F1-C: split payment and debt (nasiya). Additive, written by hand: Prisma's own diff
// rebuilds `payments` (RedefineTables), which is unsafe inside our migration transaction (see
// 0007). ADD COLUMN gives the same schema; the drift test in database.test.ts checks it.
//
// The new PaymentMethod value `mixed` and the DebtEntryKind enum need no SQL: SQLite stores
// enums as TEXT.
export const sql = `
-- CreateTable
CREATE TABLE "debt_repayments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
    "method" TEXT,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" DATETIME,
    "voidedById" INTEGER,
    "voidReason" TEXT,
    CONSTRAINT "debt_repayments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "debt_repayments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "debt_repayments_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "debt_repayments_customerId_voidedAt_idx" ON "debt_repayments"("customerId", "voidedAt");

-- CreateIndex
CREATE INDEX "debt_repayments_createdAt_idx" ON "debt_repayments"("createdAt");

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "customerId" INTEGER CONSTRAINT "payments_customerId_fkey" REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "payments" ADD COLUMN "settledAt" DATETIME;

-- CreateIndex
CREATE INDEX "payments_customerId_settledAt_idx" ON "payments"("customerId", "settledAt");
`;
