// Feature F18: fiscal receipts through REGOS:VCR. Additive only: MXIK + package code on dishes
// (null = the settings defaults), the fiscal receipt's state and VCR's answer on orders (null on
// every existing order: paid while fiscal receipts did not exist, never sent), and the Z-report
// on shifts. Written as ADD COLUMN by hand: Prisma's diff rebuilds `orders`, which order lines and
// payments reference (tasks/lessons.md). Fiscal receipts stay off until an admin turns them on
// (settings key `fiscal_enabled`; missing reads as off, nothing is seeded).
export const sql = `
ALTER TABLE "menu_items" ADD COLUMN "mxik" TEXT;
ALTER TABLE "menu_items" ADD COLUMN "packageCode" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalStatus" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalError" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "fiscalReceiptId" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalReceiptNo" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalSign" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalQrUrl" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalTerminalId" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalAt" DATETIME;
ALTER TABLE "orders" ADD COLUMN "fiscalRefundSign" TEXT;
ALTER TABLE "orders" ADD COLUMN "fiscalRefundedAt" DATETIME;
CREATE INDEX "orders_fiscalStatus_idx" ON "orders"("fiscalStatus");
ALTER TABLE "sessions" ADD COLUMN "fiscalZReportId" INTEGER;
ALTER TABLE "sessions" ADD COLUMN "fiscalZClosedAt" DATETIME;
`;
