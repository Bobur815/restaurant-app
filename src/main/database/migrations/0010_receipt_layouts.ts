// Feature F3: one receipt layout per order type. Additive: a new table, no rows (a missing type
// prints like General, a missing General like the old receipt_settings switches).
export const sql = `
-- CreateTable
CREATE TABLE "receipt_layouts" (
    "orderType" TEXT NOT NULL PRIMARY KEY,
    "showAddress" BOOLEAN NOT NULL DEFAULT true,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "showDateTime" BOOLEAN NOT NULL DEFAULT true,
    "showOrderNumber" BOOLEAN NOT NULL DEFAULT true,
    "showCustomer" BOOLEAN NOT NULL DEFAULT true,
    "footerNote" TEXT NOT NULL DEFAULT '',
    "topImage" TEXT,
    "topImageWidth" INTEGER NOT NULL DEFAULT 60,
    "bottomImage" TEXT,
    "bottomImageWidth" INTEGER NOT NULL DEFAULT 40,
    "updatedAt" DATETIME NOT NULL
);
`;
