// Hand-written. Same pattern as 0002 for orders: orders.pendingTable = tableNumber while
// status = 'pending', NULL otherwise, maintained by the database. Its UNIQUE index then allows
// one unpaid order per table, and paying or cancelling releases the table without code having
// to remember it. Two devices opening the same table at once: the second insert fails (P2002).
export const sql = `
UPDATE "orders" SET "pendingTable" = CASE "status" WHEN 'pending' THEN "tableNumber" ELSE NULL END
WHERE "pendingTable" IS NOT (CASE "status" WHEN 'pending' THEN "tableNumber" ELSE NULL END);

CREATE TRIGGER "orders_pending_table_insert"
AFTER INSERT ON "orders"
FOR EACH ROW
WHEN NEW."pendingTable" IS NOT (CASE NEW."status" WHEN 'pending' THEN NEW."tableNumber" ELSE NULL END)
BEGIN
  UPDATE "orders" SET "pendingTable" = CASE NEW."status" WHEN 'pending' THEN NEW."tableNumber" ELSE NULL END
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "orders_pending_table_update"
AFTER UPDATE OF "status", "tableNumber", "pendingTable" ON "orders"
FOR EACH ROW
WHEN NEW."pendingTable" IS NOT (CASE NEW."status" WHEN 'pending' THEN NEW."tableNumber" ELSE NULL END)
BEGIN
  UPDATE "orders" SET "pendingTable" = CASE NEW."status" WHEN 'pending' THEN NEW."tableNumber" ELSE NULL END
  WHERE "id" = NEW."id";
END;
`;
