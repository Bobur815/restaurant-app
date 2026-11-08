// Feature F9: the pre-bill ("Hisob") layout, one row for every order type. Additive: a new
// table, no rows (a missing row prints with General's switches and footer, without pictures).
export const sql = `
-- CreateTable
CREATE TABLE "pre_bill_layout" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "showAddress" BOOLEAN NOT NULL DEFAULT true,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "showDateTime" BOOLEAN NOT NULL DEFAULT true,
    "showOrderNumber" BOOLEAN NOT NULL DEFAULT true,
    "footerNote" TEXT NOT NULL DEFAULT '',
    "topImage" TEXT,
    "topImageWidth" INTEGER NOT NULL DEFAULT 60,
    "bottomImage" TEXT,
    "bottomImageWidth" INTEGER NOT NULL DEFAULT 40,
    "updatedAt" DATETIME NOT NULL
);
`;
