// Feature F12: satellite tills paired with this (main) till. Additive: a new, empty table. A till
// with no rows serves nothing on the network (lan/serve-policy.ts).
export const sql = `
-- CreateTable
CREATE TABLE "lan_devices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "pairedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "lastIp" TEXT,
    "revokedAt" DATETIME
);
`;
