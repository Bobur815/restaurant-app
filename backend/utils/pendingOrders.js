// backend/utils/pendingOrders.js
import prisma from "../database/prisma.js";

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const toIntArray = (arr) =>
  (arr || [])
    .map(toInt)
    .filter((n) => Number.isInteger(n));

/**
 * Sum of quantities for each menuId across ALL pending orders.
 * @param {number[]|string[]} menuIds
 * @returns {Promise<Map<number, number>>} Map(menuId -> totalQty)
 */
export async function getGlobalPendingQtyByMenu(menuIds) {
  const ids = toIntArray(menuIds);
  if (!ids.length) return new Map();

  // 1) Find all pending order IDs
  const pendingOrders = await prisma.order.findMany({
    where: { status: "pending" },
    select: { id: true },
  });
  if (!pendingOrders.length) return new Map();

  const orderIds = pendingOrders.map((o) => o.id);

  // 2) Group order items by menuId, limited to pending orders + requested menuIds
  const grouped = await prisma.orderItem.groupBy({
    by: ["menuId"],
    where: {
      orderId: { in: orderIds },
      menuId: { in: ids },
    },
    _sum: { quantity: true },
  });

  // 3) Build Map(menuId -> totalQty)
  const map = new Map();
  for (const row of grouped) {
    map.set(row.menuId, Number(row._sum.quantity || 0));
  }
  return map;
}
