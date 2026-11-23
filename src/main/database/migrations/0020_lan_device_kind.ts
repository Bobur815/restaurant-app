// Feature F20: waiter phones pair with the main till like satellite tills do, but may call fewer
// channels. `kind` says which a paired device is: 'till' (a satellite till) or 'waiter' (a phone).
// Additive: a new column with a default, so every satellite already paired becomes 'till' and
// keeps working exactly as before. The kind comes from the pairing code, never from the device.
export const sql = `
ALTER TABLE "lan_devices" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'till';
`;
