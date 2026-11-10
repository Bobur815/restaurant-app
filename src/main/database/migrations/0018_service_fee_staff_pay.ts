// Feature F17: service fee on orders (xizmat haqi), the guest count, and waiter earnings.
// Additive only: three new order columns (fee 0, no guest count, no percent on every existing
// order) and one user column (0 % for everyone). Nothing existing changes value; the service fee
// stays off until an admin turns it on (settings key `service_fee_type`, seeded as "off").
export const sql = `
ALTER TABLE "orders" ADD COLUMN "serviceFee" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "guestCount" INTEGER;
ALTER TABLE "orders" ADD COLUMN "waiterPercent" DECIMAL;
ALTER TABLE "users" ADD COLUMN "earningsPercent" DECIMAL NOT NULL DEFAULT 0;
`;
