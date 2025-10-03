// backend/services/payment.service.js
import prisma from "../database/prisma.js";
import CustomError from "../utils/CustomError.js";    // if you prefer to reuse changeStatus; else update directly here
import sessionService from "./Session.service.js";   // keep your existing API

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const normalizeMethod = (m) => {
  const x = String(m || "").toLowerCase();
  if (x === "klik") return "click";
  if (x === "nasiya" || x === "credit") return "debt";
  return x; // cash | card | click | debt
};

const dayKey = (d) => {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

export default new (class PaymentService {
  /**
   * Filters:
   *  - startDate, endDate (YYYY-MM-DD)
   *  - paymentMethod ('all' to ignore)
   *  - status ('all' to ignore)
   *  - tableNumber
   * Sorting:
   *  - orderByType: 'tableNumber' | 'payment_date' | 'amount'
   *  - orderDirection: 'asc' | 'desc'
   */
  async getChecksByQuery(filter = {}) {
    const start = new Date(filter.startDate);
    const end = new Date(filter.endDate);
    end.setHours(23, 59, 59, 999);

    const where = {
      paymentDate: { gte: start, lte: end },
    };

    if (filter.paymentMethod && filter.paymentMethod !== "all") {
      where.paymentMethod = String(filter.paymentMethod);
    }
    if (filter.status && filter.status !== "all") {
      where.status = String(filter.status);
    }

    const tableNum =
      filter.tableNumber != null ? toInt(filter.tableNumber) : null;
    if (tableNum != null) {
      where.order = { tableNumber: tableNum };
    }

    // Sorting
    const orderDir = filter.orderDirection === "asc" ? "asc" : "desc";
    let orderBy = [{ paymentDate: orderDir }];

    if (filter.orderByType === "tableNumber") {
      // Prefer tableNumber, then date desc to stabilize
      orderBy = [{ order: { tableNumber: orderDir } }, { paymentDate: "desc" }];
    } else if (filter.orderByType === "amount") {
      orderBy = [{ amount: orderDir }, { paymentDate: "desc" }];
    } else if (filter.orderByType === "payment_date") {
      orderBy = [{ paymentDate: orderDir }];
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        order: { select: { orderNumber: true, tableNumber: true } },
      },
      orderBy,
    });

    // Project flat fields (match your old $project)
    return payments.map((p) => ({
      orderNumber: p.order?.orderNumber ?? null,
      tableNumber: p.order?.tableNumber ?? null,
      amount: Number(p.amount ?? 0),
      paymentMethod: p.paymentMethod,
      status: p.status,
      payment_date: p.paymentDate,
    }));
  }

  /**
   * Build reports for a date range:
   * - productsByDate: [{ date, products: [{ productName, quantitySold }] }]
   * - daily: [{ payment_date, numberOfOrders, totalSumOfEachDay, cashSum, cardSum, clickSum, plasticSum, creditSum, expense* fields }]
   *
   * Sort controls:
   *  bytype: 'payment_date' | 'amount'
   *  direction: 'asc' | 'desc'
   */
  async getReports(query = {}) {
    const { start, end, bytype = "payment_date", direction = "asc" } = query;
    if (!start || !end)
      throw new CustomError("start and end required", 400, "BadRequest");

    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    // --- Pull all payments in range, with order + order.items + menu
    const payments = await prisma.payment.findMany({
      where: { paymentDate: { gte: startDate, lte: endDate } },
      include: {
        order: {
          select: {
            id: true,
            items: {
              select: {
                menuId: true,
                quantity: true,
              },
            },
          },
        },
      },
      orderBy: { paymentDate: "asc" },
    });

    // --- PRODUCTS BY DATE (aggregate in JS)
    // Build: { 'YYYY-MM-DD': { menuId: qty, ... } }
    const productDayMap = new Map(); // day -> Map(menuId -> qty)
    for (const p of payments) {
      const day = dayKey(p.paymentDate);
      if (!productDayMap.has(day)) productDayMap.set(day, new Map());
      const bucket = productDayMap.get(day);
      for (const it of p.order?.items || []) {
        const mid = it.menuId;
        const prev = bucket.get(mid) || 0;
        bucket.set(mid, prev + Number(it.quantity || 0));
      }
    }

    // Resolve menu names for all involved menuIds
    const allMenuIds = new Set();
    for (const bucket of productDayMap.values()) {
      for (const mid of bucket.keys()) allMenuIds.add(mid);
    }
    const menuIdList = [...allMenuIds];
    const menus = menuIdList.length
      ? await prisma.menu.findMany({
          where: { id: { in: menuIdList } },
          select: { id: true, name: true },
        })
      : [];
    const menuNameById = new Map(menus.map((m) => [m.id, m.name]));

    const productsByDate = [...productDayMap.entries()]
      .map(([date, bucket]) => {
        const products = [...bucket.entries()].map(([menuId, quantitySold]) => ({
          productName: menuNameById.get(menuId) ?? `#${menuId}`,
          quantitySold,
        }));
        return { date, products };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // --- DAILY (payments breakdown) ---------------------------------
    const dailyMap = new Map(); // day -> accum
    const accDay = (d) => {
      if (!dailyMap.has(d)) {
        dailyMap.set(d, {
          payment_date: d,
          numberOfOrders: 0,
          totalSumOfEachDay: 0,
          cashSum: 0,
          cardSum: 0,
          clickSum: 0,
          creditSum: 0,
          // expenses to be attached later:
          expenseSum: 0,
          residualWriteoffSum: 0,
          wasteSum: 0,
          breakageSum: 0,
          expenseQtyTotal: 0,
        });
      }
      return dailyMap.get(d);
    };

    for (const p of payments) {
      const d = dayKey(p.paymentDate);
      const row = accDay(d);
      row.numberOfOrders += 1;
      const amt = Number(p.amount || 0);
      row.totalSumOfEachDay += amt;
      switch (p.paymentMethod) {
        case "cash":
          row.cashSum += amt;
          break;
        case "card":
          row.cardSum += amt;
          break;
        case "click":
          row.clickSum += amt;
          break;
        case "debt":
          row.creditSum += amt;
          break;
        default:
          break;
      }
    }

    // --- EXPENSES (range) with menu fallback price -> attach per day
    const expenses = await prisma.expense.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      include: { menu: { select: { price: true } } },
    });

    for (const e of expenses) {
      const d = dayKey(e.createdAt);
      const row = accDay(d);

      // Effective unit cost
      const unitCost =
        Number(e.unitCost || 0) > 0
          ? Number(e.unitCost || 0)
          : Number(e.menu?.price || 0);

      // Effective amount
      const amountEff =
        Number(e.amount || 0) > 0
          ? Number(e.amount || 0)
          : unitCost * Number(e.quantity || 0);

      row.expenseSum += amountEff;
      row.expenseQtyTotal += Number(e.quantity || 0);

      // Type breakdowns
      if (e.type === "residual_writeoff") row.residualWriteoffSum += amountEff;
      else if (e.type === "waste") row.wasteSum += amountEff;
      else if (e.type === "breakage") row.breakageSum += amountEff;
    }

    // Calculate plasticSum, build array, sort
    const daily = [...dailyMap.values()].map((r) => ({
      ...r,
      plasticSum: r.cardSum + r.clickSum,
      // normalize numbers to two decimals if you want:
      // totalSumOfEachDay: Math.round(r.totalSumOfEachDay * 100) / 100,
      // cashSum: Math.round(r.cashSum * 100) / 100,
      // ...
    }));

    // Sorting (same idea as your sortSpec)
    const byWhitelist = new Set(["payment_date", "amount"]);
    const sortBy = byWhitelist.has(bytype) ? bytype : "payment_date";
    const dir = direction === "desc" ? -1 : 1;

    const sortField = sortBy === "amount" ? "totalSumOfEachDay" : "payment_date";
    daily.sort((a, b) => {
      const aa = sortField === "payment_date" ? a.payment_date : a.totalSumOfEachDay;
      const bb = sortField === "payment_date" ? b.payment_date : b.totalSumOfEachDay;
      if (aa < bb) return -1 * dir;
      if (aa > bb) return 1 * dir;
      // secondary by date asc
      if (sortField !== "payment_date") {
        if (a.payment_date < b.payment_date) return -1;
        if (a.payment_date > b.payment_date) return 1;
      }
      return 0;
    });

    return { daily, productsByDate };
  }

  /**
   * Update payment by orderNumber.
   * data: partial { amount?, paymentMethod?, status?, payment_date? }
   */
  async updatePayment(orderId, data) {
    const order = await prisma.order.findUnique({
      where: { orderNumber: String(orderId) },
      select: { id: true },
    });
    if (!order) {
      throw new CustomError(`Order ${orderId} not found`, 404, "NotFoundError");
    }

    const res = await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: {
        amount:
          data.amount != null ? Number(data.amount) : undefined,
        paymentMethod:
          data.paymentMethod != null ? String(data.paymentMethod) : undefined,
        status:
          data.status != null ? String(data.status) : undefined,
        paymentDate:
          data.payment_date != null ? new Date(data.payment_date) : undefined,
      },
    });

    if (res.count === 0) {
      throw new CustomError(`Payment for order ${orderId} not found`, 404, "NotFoundError");
    }

    // return updated row (fetch one)
    const updated = await prisma.payment.findFirst({
      where: { orderId: order.id },
    });
    return updated;
  }

  async createPayment(data = {}) {
  // --- Resolve orderId from several shapes the UI may send ---
  
  let orderId =
    toInt(data.orderId) ??
    toInt(data.order?.orderId);

  if (!orderId && data.orderNumber) {
    const o = await prisma.order.findUnique({
      where: { orderNumber: String(data.orderNumber) },
      select: { id: true },
    });
    orderId = o?.id ?? null;
  }
  if (!orderId && data.order?.orderNumber) {
    const o = await prisma.order.findUnique({
      where: { orderNumber: String(data.order.orderNumber) },
      select: { id: true },
    });
    orderId = o?.id ?? null;
  }
  if (!orderId) {
    throw new CustomError("Order not found for payment", 404, "NotFoundError");
  }

  // --- Validate/normalize fields ---
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new CustomError("Invalid amount", 400, "BadRequest");
  }
  const paymentMethod = normalizeMethod(data.paymentMethod);
  if (!["cash", "card", "click", "debt"].includes(paymentMethod)) {
    throw new CustomError("Invalid payment method", 400, "BadRequest");
  }
  const status = String(data.status ?? "paid");
  if (!["paid", "pending", "refunded"].includes(status)) {
    throw new CustomError("Invalid payment status", 400, "BadRequest");
  }
  const paymentDate = data.payment_date ? new Date(data.payment_date) : new Date();

  // --- One transaction: create payment + complete order ---
  const result = await prisma.$transaction(
    async (tx) => {
      // ensure order exists (and optionally guard against already-completed)
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true },
      });
      if (!order) {
        throw new CustomError("Order not found", 404, "NotFoundError");
      }

      const p = await tx.payment.create({
        data: {
          orderId,
          amount,
          paymentMethod, // Prisma enum
          status,        // Prisma enum
          paymentDate,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "completed",
          paymentMethod,       // persist final method on the order too
          updateDate: new Date(),
        },
      });

      return p;
    },
    { timeout: 15000, maxWait: 10000 }
  );

  return result;
}

  /**
   * Delete payment by orderNumber.
   */
  async deletePayment(orderNumber) {
    const order = await prisma.order.findUnique({
      where: { orderNumber: String(orderNumber) },
      select: { id: true },
    });

    if (!order) {
      throw new CustomError(`Buyurtma topilmadi: ${orderNumber}`, 404, "NotFoundError");
    }

    const res = await prisma.payment.deleteMany({
      where: { orderId: order.id },
    });

    if (res.count === 0) {
      throw new CustomError("To‘lov topilmadi yoki allaqachon o‘chirilgan", 404, "NotFoundError");
    }

    return "✅ Check muvaffaqqiyatli o'chirildi";
  }
})();
