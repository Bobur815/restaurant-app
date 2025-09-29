import Order_itemsModel from "../models/Order_items.model.js";
import OrdersModel from "../models/Orders.model.js";

export  async function getGlobalPendingQtyByMenu(menuIds) {
  if (!menuIds?.length) return new Map();

  // 1) find pending order IDs
  const pendingOrders = await OrdersModel.find(
    { status: 'pending' },
    { _id: 1 }
  ).lean();
  if (!pendingOrders.length) return new Map();

  const orderIds = pendingOrders.map(o => o._id);

  // 2) aggregate items by menu_id
  const agg = await Order_itemsModel.aggregate([
    { $match: { order_id: { $in: orderIds }, menu_id: { $in: menuIds } } },
    { $group: { _id: '$menu_id', totalQty: { $sum: '$quantity' } } },
  ]);

  const map = new Map();
  for (const r of agg) map.set(String(r._id), Number(r.totalQty || 0));
  return map;
}