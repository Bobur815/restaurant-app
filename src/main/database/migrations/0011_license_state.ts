// Feature F5: the till's licence from the posgro server. Additive: one new table, no rows (the
// row is made on the first start with this build; until a licence arrives the till runs on the
// 14-day allowance for installs from before F5).
export const sql = `
-- CreateTable
CREATE TABLE "license_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "terminalId" TEXT NOT NULL,
    "storeId" TEXT,
    "storeName" TEXT,
    "token" TEXT,
    "lastCheckinAt" DATETIME,
    "lastError" TEXT,
    "firstRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockMark" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
`;
