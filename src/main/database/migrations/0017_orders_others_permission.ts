// Feature F13: waiters keep to their own orders. The new permission `ordersOthers` (edit, cancel
// or move an order another user opened) is ticked for every ADMIN and CASHIER user, so they keep
// doing what they did before the update; STAFF users lose it. Data only, additive: no schema
// change, a value appended to the stored JSON list, once (a list that already has it is left).
export const sql = `
UPDATE "users"
SET "permissions" = json_insert("permissions", '$[#]', 'ordersOthers')
WHERE "role" IN ('ADMIN', 'CASHIER')
  AND json_valid("permissions")
  AND json_type("permissions") = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each("users"."permissions") WHERE "value" = 'ordersOthers');
`;
