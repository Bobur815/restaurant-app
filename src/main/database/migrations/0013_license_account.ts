// Feature F7: the restaurant's balance and bill, and how to pay it, as of the last licence
// check-in, so the subscription screen still shows them after a restart or while offline.
// Additive: two nullable text columns (JSON) on the single license_state row.
export const sql = `
-- AlterTable
ALTER TABLE "license_state" ADD COLUMN "account" TEXT;
ALTER TABLE "license_state" ADD COLUMN "payment" TEXT;
`;
