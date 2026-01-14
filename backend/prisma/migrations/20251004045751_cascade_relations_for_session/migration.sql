/*
  Warnings:

  - You are about to drop the column `menu_id` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `session_id` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `image_url` on the `Menu` table. All the data in the column will be lost.
  - You are about to drop the column `order_date` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `order_number` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `table_number` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `total_amount` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `update_date` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `menu_id` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `order_id` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `total_price` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `unit_price` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `weight_kg` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `order_id` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `payment_date` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `expense_id` on the `Residual` table. All the data in the column will be lost.
  - You are about to drop the column `menu_id` on the `Residual` table. All the data in the column will be lost.
  - You are about to drop the column `session_id` on the `Residual` table. All the data in the column will be lost.
  - Added the required column `menuId` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orderId` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orderId` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `menuId` to the `Residual` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sessionId` to the `Residual` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER,
    "menuId" INTEGER,
    "type" TEXT NOT NULL,
    "note" TEXT DEFAULT '',
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    "unitCost" DECIMAL NOT NULL DEFAULT 0,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Expense_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Expense" ("amount", "createdAt", "id", "note", "quantity", "type", "unitCost", "updatedAt") SELECT "amount", "createdAt", "id", "note", "quantity", "type", "unitCost", "updatedAt" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE INDEX "Expense_sessionId_idx" ON "Expense"("sessionId");
CREATE INDEX "Expense_menuId_idx" ON "Expense"("menuId");
CREATE INDEX "Expense_type_idx" ON "Expense"("type");
CREATE TABLE "new_Menu" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "price" DECIMAL NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "description" TEXT,
    "categoryId" INTEGER NOT NULL,
    "portions" BOOLEAN NOT NULL DEFAULT false,
    "soldByWeight" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Menu_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Menu" ("categoryId", "createdAt", "description", "id", "name", "portions", "price", "soldByWeight", "updatedAt") SELECT "categoryId", "createdAt", "description", "id", "name", "portions", "price", "soldByWeight", "updatedAt" FROM "Menu";
DROP TABLE "Menu";
ALTER TABLE "new_Menu" RENAME TO "Menu";
CREATE UNIQUE INDEX "Menu_name_key" ON "Menu"("name");
CREATE INDEX "Menu_categoryId_idx" ON "Menu"("categoryId");
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNumber" TEXT,
    "tableNumber" INTEGER,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmount" DECIMAL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT NOT NULL,
    "updateDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Order" ("id", "paymentMethod", "status") SELECT "id", "paymentMethod", "status" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_paymentMethod_idx" ON "Order"("paymentMethod");
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "menuId" INTEGER NOT NULL,
    "soldByWeight" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL NOT NULL DEFAULT 1,
    "units" INTEGER,
    "weightKg" DECIMAL DEFAULT 0,
    "portions" DECIMAL DEFAULT 1,
    "unitPrice" DECIMAL NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("createdAt", "id", "portions", "quantity", "soldByWeight", "units", "updatedAt") SELECT "createdAt", "id", "portions", "quantity", "soldByWeight", "units", "updatedAt" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_menuId_idx" ON "OrderItem"("menuId");
CREATE TABLE "new_Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "paymentDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "createdAt", "id", "paymentMethod", "status") SELECT "amount", "createdAt", "id", "paymentMethod", "status" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");
CREATE INDEX "Payment_paymentMethod_idx" ON "Payment"("paymentMethod");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE TABLE "new_Residual" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "menuId" INTEGER NOT NULL,
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "appliedToSession" INTEGER,
    "expenseId" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Residual_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Residual_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Residual_appliedToSession_fkey" FOREIGN KEY ("appliedToSession") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Residual_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Residual" ("action", "appliedToSession", "createdAt", "id", "note", "quantity", "status", "updatedAt") SELECT "action", "appliedToSession", "createdAt", "id", "note", "quantity", "status", "updatedAt" FROM "Residual";
DROP TABLE "Residual";
ALTER TABLE "new_Residual" RENAME TO "Residual";
CREATE INDEX "Residual_sessionId_idx" ON "Residual"("sessionId");
CREATE INDEX "Residual_menuId_idx" ON "Residual"("menuId");
CREATE INDEX "Residual_status_idx" ON "Residual"("status");
CREATE INDEX "Residual_action_idx" ON "Residual"("action");
CREATE UNIQUE INDEX "Residual_sessionId_menuId_status_key" ON "Residual"("sessionId", "menuId", "status");
CREATE TABLE "new_SessionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "menuId" INTEGER NOT NULL,
    "initialQuantity" DECIMAL NOT NULL DEFAULT 0,
    "soldQuantity" DECIMAL NOT NULL DEFAULT 0,
    CONSTRAINT "SessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SessionItem" ("id", "initialQuantity", "menuId", "sessionId", "soldQuantity") SELECT "id", "initialQuantity", "menuId", "sessionId", "soldQuantity" FROM "SessionItem";
DROP TABLE "SessionItem";
ALTER TABLE "new_SessionItem" RENAME TO "SessionItem";
CREATE INDEX "SessionItem_sessionId_idx" ON "SessionItem"("sessionId");
CREATE INDEX "SessionItem_menuId_idx" ON "SessionItem"("menuId");
CREATE UNIQUE INDEX "SessionItem_sessionId_menuId_key" ON "SessionItem"("sessionId", "menuId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
