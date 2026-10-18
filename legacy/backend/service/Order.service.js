// backend/services/order.service.js
import prisma from "../database/prisma.js";
import CustomError from "../utils/CustomError.js";
import { roundN } from "../utils/roundN.js";
import { formatOrderNumber, nextSeqTx } from "./Counter.service.js";
import SessionService from "./Session.service.js"; // keep your existing API (recordSale)

function toIntId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const effQty = (it) => {
  const qty = Number(it.quantity ?? 0);
  if (it.soldByWeight) {
    const w = Number(it.weightKg ?? 0);
    return qty * w;
  }
  const p = (typeof it.portions === "number") ? Number(it.portions) : (it.portions ? Number(it.portions) : 1);
  return qty * (Number.isFinite(p) && p > 0 ? p : 1);
};

export default new (class OrderService {
  /**
   * Equivalent to your aggregate:
   * Returns current pending order items for a given table, flattened with menu fields.
   */
  async getOrdersOfTable(tableNumber) {
    

    
    const tableNum = Number(tableNumber);
    if (!Number.isInteger(tableNum)) return [];

    // 1) Open session → remaining per menu
    const openSession = await prisma.session.findFirst({
      where: { status: "open" },
      include: { items: true }, // SessionItem[]
    });

    const remainingByMenu = new Map();
    if (openSession?.items?.length) {
      for (const si of openSession.items) {
        // Prisma Decimal → Number
        const init = Number(si.initialQuantity ?? 0);
        const sold = Number(si.soldQuantity ?? 0);
        const remaining = Math.max(0, init - sold);
        remainingByMenu.set(si.menuId, remaining);
      }
    }

    // 2) Pending order items for the table (with menu info)
    const items = await prisma.orderItem.findMany({
      where: {
        order: { tableNumber: tableNum, status: "pending" },
      },
      include: {
        menu: { select: { id: true, name: true, imageUrl: true, price: true } },
      },
      orderBy: { id: "asc" },
    });
    
    // 3) Project + attach remainingQuantity
    return items.map((it) => {
      const menuId = it.menu?.id ?? null;
      const remainingQuantity =
        menuId != null && remainingByMenu.has(menuId)
          ? roundN(remainingByMenu.get(menuId), 2)
          : null;

      return {
        id: menuId,
        name: it.menu?.name ?? null,
        imageUrl: it.menu?.imageUrl ?? null,
        price: Number(it.menu?.price ?? 0),
        quantity: Number(it.quantity ?? 0),
        portions: it.portions != null ? roundN(it.portions) : null,
        soldByWeight: Boolean(it.soldByWeight),
        unitsPrice: it.unitPrice != null ? roundN(it.unitPrice) : null,
        totalPrice: Number(it.totalPrice ?? 0),
        units: it.units ?? null,
        weightKg: it.weightKg != null ? roundN(it.weightKg) : null,

        // ✅ new field used by the frontend stock guards
        remainingQuantity,
      };
    });
  }

  /**
   * Load one order by flexible query.
   * Accepts: { id } | { tableNumber, status } etc. (numeric ids in Prisma)
   */
  async getOrder(query = {}) {
    // Translate Mongoose-y query -> Prisma where
    const where = { ...query };
    if (query.id != null) {
      const id = toIntId(query.id);
      if (!id) return [];
      where.id = id;
    }
    if (query.tableNumber != null)
      where.tableNumber = Number(query.tableNumber);
    if (query.status) where.status = String(query.status);

    const order = await prisma.order.findFirst({
      where,
    });

    if (!order) return [];

    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      include: { menu: { select: { name: true, imageUrl: true, price: true } } },
      orderBy: { id: "asc" },
    });

    // Match previous return shape
    return {
      ...order,
      items: items.map((it) => ({
        ...it,
        menuId: it.menuId,
        weightKg: it.weightKg,
        // keep populated subset
        menu: {
          name: it.menu?.name ?? null,
          imageUrl: it.menu?.imageUrl ?? null,
          price: it.menu?.price ?? 0,
        },
      })),
    };
  }

  async createOrder(data) {
    const { tableNumber, paymentMethod, items = [] } = data || {};
    if (!Array.isArray(items) || items.length === 0) {
      throw new CustomError("❌ Mahsulotlar bo'sh!", 400, "BadRequest");
    }

    const openSession = await prisma.session.findFirst({
      where: { status: "open" },
      include: { items: true },
    });
    if (!openSession) {
      throw new CustomError("❌ Ochiq smena topilmadi", 404, "NotFoundError");
    }

    const remainingMap = new Map(
      openSession.items.map(si => [
        String(si.menuId),
        Number(si.initialQuantity) - Number(si.soldQuantity)
      ])
    );


    // 2) Aggregate requested effective qty per menu from payload
    const requestedMap = new Map(); // menuId -> total eff
    for (const it of items) {
      const mid = toIntId(it.menuId);
      if (!mid) throw new CustomError("❌ Noto‘g‘ri menuId", 400, "BadRequest");

      const add = effQty(it);
      if (!Number.isFinite(add) || add < 0) {
        throw new CustomError("❌ Noto‘g‘ri miqdor", 400, "BadRequest");
      }
      requestedMap.set(String(mid), (requestedMap.get(String(mid)) || 0) + add);
    }

    // 3) Validate stock against the OPEN session
    const shortages = [];
    for (const [mid, need] of requestedMap.entries()) {
      const left = remainingMap.get(mid);
      if (left == null) {
        shortages.push({ menuId: mid, reason: "NOT_IN_SESSION" });
        continue;
      }
      if (need > left + 1e-9) {
        shortages.push({ menuId: mid, left, need });
      }
    }

    if (shortages.length) {
      // You can enrich with menu names if you want:
      // const ids = shortages.map(s => Number(s.menuId));
      // const menus = await prisma.menu.findMany({ where: { id: { in: ids } }, select: { id:true, name:true }});
      throw new CustomError("❌ Yetarli miqdor yo‘q!", 400, "BadRequest");
    }

    // 4) Compute total & normalize order items
    const computedTotal = items.reduce((sum, it) => {
      const tp = Number(it.total_price ?? it.totalPrice ?? 0);
      return sum + (Number.isFinite(tp) ? tp : 0);
    }, 0);

    const payloadItems = items.map((it) => ({
      menuId: toIntId(it.menuId),
      soldByWeight: !!it.soldByWeight,
      quantity: Number(it.quantity ?? 0),
      portions: it.soldByWeight ? null : (typeof it.portions === "number" ? Number(it.portions) : (it.portions ? Number(it.portions) : 1)),
      unitPrice: Number(it.unitPrice ?? it.price ?? 0),
      totalPrice: Number(it.totalPrice ?? 0),
      units: it.soldByWeight ? Number(it.units ?? 1) : null,
      weightKg: it.soldByWeight ? Number(it.weightKg ?? 0) : null,
    }));

    const created = await prisma.$transaction(
      async (tx) => {
        // ✅ use tx-aware counter; keep everything *inside* this tx
        const seq = await nextSeqTx(tx, "orders");
        const orderNumber = formatOrderNumber(seq);

        const order = await tx.order.create({
          data: {
            orderNumber,
            tableNumber: Number(tableNumber),
            totalAmount: Math.round(computedTotal * 100) / 100,
            paymentMethod: String(paymentMethod),
            items: { create: payloadItems },
          },
          select: { id: true, orderNumber: true },
        });
        return order;
      });

    // 6) Update session sold quantities (outside SQL tx, same as before)
    for (const it of payloadItems) {
      const delta = effQty(it);
      if (delta > 0) {
        await SessionService.recordSale(it.menuId, delta);
      }
    }

    return { ok: true, orderId: created.id, orderNumber: created.orderNumber };
  }

  /**
   * UPDATE pending order by tableNumber. Replace items (delete+create), recalc total,
   * then apply delta to session stats.
   */
  async updateOrder(data) {
    const { tableNumber, paymentMethod, items = [] } = data || {};

    const order = await prisma.order.findFirst({
      where: { tableNumber: Number(tableNumber), status: "pending" },
    });
    if (!order) {
      throw new CustomError("❌ Buyurtma topilmadi!", 404, "NotFoundError");
    }

    const computedTotal = items.reduce((sum, it) => {
      const tp = Number(it.totalPrice ?? 0);
      return sum + (Number.isFinite(tp) ? tp : 0);
    }, 0);

    const orderId = order.id;

    const oldItems = await prisma.orderItem.findMany({
      where: { orderId },
    });

    // Prepare new items
    const newItems = items.map((it) => ({
      menuId: toIntId(it.menuId),
      soldByWeight: !!it.soldByWeight,
      quantity: Number(it.quantity ?? 0),
      portions: it.soldByWeight ? null : it.portions ?? null,
      unitPrice: Number(it.unitPrice ?? it.price ?? 0),
      totalPrice: Number(it.totalPrice ?? 0),
      units: it.soldByWeight ? Number(it.units ?? 1) : null,
      weightKg: it.soldByWeight ? Number(it.weightKg ?? 0) : null,
      // You had manual updatedAt; Prisma has @updatedAt. If you still want:
      // updatedAt: uzbekistanTime(),
    }));

    for (const it of newItems) {
      if (!it.menuId) {
        throw new CustomError("❌ Noto‘g‘ri menuId", 400, "BadRequest");
      }
    }

    // Replace items + update order in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: Math.round(computedTotal * 100) / 100,
          paymentMethod: String(paymentMethod),
        },
      });

      await tx.orderItem.deleteMany({ where: { orderId } });

      // createMany is faster but doesn't run per-row hooks (we have none here)
      // If you need the created rows back, loop tx.orderItem.create(...)
      await tx.orderItem.createMany({
        data: newItems.map((it) => ({ ...it, orderId })),
      });
    });

    // ---- Delta calc (like your code)
    const eff = (doc) => {
      const isWeight = !!doc.soldByWeight;
      const q = Number(doc.quantity ?? 0);
      const p = isWeight ? 1 : Number(doc.portions ?? 1);
      return q * p;
    };

    const oldMap = new Map(oldItems.map((i) => [String(i.menuId), eff(i)]));
    const newMap = new Map(newItems.map((i) => [String(i.menuId), eff(i)]));

    const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const id of allIds) {
      const prevEff = oldMap.get(id) ?? 0;
      const nextEff = newMap.get(id) ?? 0;
      const delta = nextEff - prevEff;
      if (delta !== 0) {
        await SessionService.recordSale(Number(id), delta);
      }
    }

    return orderId;
  }

  /**
   * Change order status by orderId.
   */
  async changeStatusofOrder(orderId, status) {
    const id = toIntId(orderId);
    if (!id) {
      throw new CustomError("❌ Buyurtma topilmadi!", 404, "NotFoundError");
    }

    try {
      const updated = await prisma.order.update({
        where: { id },
        data: { status: String(status) },
      });
      return {
        data: updated,
        message: "✅ Buyurtma muvaffaqqiyatli yangilandi!",
      };
    } catch (err) {
      if (err?.code === "P2025") {
        throw new CustomError("❌ Buyurtma topilmadi!", 404, "NotFoundError");
      }
      throw err;
    }
  }

  /**
   * Cancel pending order by tableNumber:
   * - revert session stats (delta = -quantity for each item)
   * - delete order items
   * - delete order (only if still pending)
   */
  async cancelOrder(tableNumber) {
    const tableNum = Number(tableNumber);
    if (!Number.isInteger(tableNum)) return "❌ Bekor qilinadigan buyurtma topilmadi.";

    const order = await prisma.order.findFirst({
      where: { tableNumber: tableNum, status: "pending" },
    });
    if (!order) return "❌ Bekor qilinadigan buyurtma topilmadi.";

    const orderId = order.id;
    const oldItems = await prisma.orderItem.findMany({ where: { orderId } });

    const applied = []; // for optional compensation in case of error

    try {
      // revert session stats first (like your code; no SQL tx here)
      for (const it of oldItems) {
        const delta = -Number(it.quantity ?? 0);
        await SessionService.recordSale(it.menuId, delta);
        applied.push({ menuId: it.menuId, delta });
      }

      // delete items + delete order (guard status)
      await prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { orderId } });
        const res = await tx.order.deleteMany({
          where: { id: orderId, status: "pending" },
        });
        if (res.count !== 1) {
          throw new CustomError(
            "Buyurtma holati o‘zgargan bo‘lishi mumkin",
            409,
            "ConflictException"
          );
        }
      });

      return "✅ Buyurtma muvaffaqiyatli bekor qilindi.";
    } catch (err) {
      // compensation: try to revert the revert (best-effort)
      try {
        for (let i = applied.length - 1; i >= 0; i--) {
          const { menuId, delta } = applied[i];
          await SessionService.recordSale(menuId, -delta);
        }
      } catch (revertErr) {
        console.error("cancelOrder compensation error:", revertErr);
      }

      console.error("cancelOrder (no-tx) error:", err);
      if (err instanceof CustomError) throw err;
      throw new CustomError("Bekor qilishda xatolik yuz berdi", 500, "CancelOrderError");
    }
  }
})();
