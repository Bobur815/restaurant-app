// backend/services/expense.service.js
import prisma from "../database/prisma.js";
import { Prisma } from "@prisma/client";

const BY_WHITELIST = new Set(["createdAt", "amount"]);

export default new (class ExpenseService {
  /**
   * Query params (all optional):
   * - start, end (YYYY-MM-DD)
   * - type (string | "csv,of,types")
   * - sessionId, menuId (numbers or numeric strings)
   * - minAmount, maxAmount (number)
   * - q (search in note)  // add 'reason' below if you have that column
   * - bytype = createdAt | amount
   * - direction = asc | desc
   * - page (default 1), limit (default 20)
   */
  async getAllExpenses(query = {}) {
    const {
      start,
      end,
      type,
      sessionId,
      menuId,
      minAmount,
      maxAmount,
      q,
      bytype = "createdAt",
      direction = "desc",
      page = 1,
      limit = 20,
    } = query;

    // ---- pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * lim;

    // ---- sorting (stable: primary + fallback by createdAt desc)
    const sortField = BY_WHITELIST.has(bytype) ? bytype : "createdAt";
    const sortDir = direction === "asc" ? "asc" : "desc";
    const orderBy = [{ [sortField]: sortDir }, { createdAt: "desc" }];

    // ---- filters -> Prisma where
    const where = {};

    // Date range on createdAt
    if (start || end) {
      const createdAt = {};
      if (start) createdAt.gte = new Date(start);
      if (end) {
        const to = new Date(end);
        to.setHours(23, 59, 59, 999);
        createdAt.lte = to;
      }
      if (Object.keys(createdAt).length) where.createdAt = createdAt;
    }

    // Type (single or CSV)
    if (type) {
      const parts = String(type)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 1) {
        where.type = parts[0];
      } else if (parts.length > 1) {
        where.type = { in: parts };
      }
    }

    // IDs (INT). If your schema uses Int, convert safely.
    const sId = Number(sessionId);
    if (!Number.isNaN(sId) && sId > 0) where.sessionId = sId;

    const mId = Number(menuId);
    if (!Number.isNaN(mId) && mId > 0) where.menuId = mId;

    // Amount range (Decimal)
    const minA = Number(minAmount);
    const maxA = Number(maxAmount);
    if (!Number.isNaN(minA) || !Number.isNaN(maxA)) {
      where.amount = {};
      if (!Number.isNaN(minA)) where.amount.gte = new Prisma.Decimal(minA);
      if (!Number.isNaN(maxA)) where.amount.lte = new Prisma.Decimal(maxA);
    }

    // Search in note (and reason if you have it)
    if (q && q.trim()) {
      const needle = q.trim();
      // If you also store 'reason' in Expense, uncomment below and add an OR:
      where.OR = [
        { note: { contains: needle, mode: "insensitive" } },
        // { reason: { contains: needle, mode: "insensitive" } },
      ];
    }

    // ---- parallel queries: items + count + totals
    const [items, totalCount, totalsAgg] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy,
        skip,
        take: lim,
        // include: { menu: { select: { name: true } } } // uncomment if needed
      }),
      prisma.expense.count({ where }),
      prisma.expense.groupBy({
        by: ["type"],
        where,
        _count: { _all: true },
        _sum: { amount: true, quantity: true },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / lim));

    // totalAmount across all types
    const totalAmount = totalsAgg.reduce((acc, r) => {
      const a = r._sum.amount ? Number(r._sum.amount) : 0;
      return acc + a;
    }, 0);

    // sumByType as a hash
    const sumByType = {};
    for (const r of totalsAgg) {
      sumByType[r.type || "unknown"] = {
        count: r._count._all || 0,
        amount: r._sum.amount ? Number(r._sum.amount) : 0,
        quantity: r._sum.quantity ? Number(r._sum.quantity) : 0,
      };
    }

    return {
      items,
      pagination: { page: p, limit: lim, totalCount, totalPages },
      totals: { totalAmount, sumByType },
      sort: { by: sortField, direction: sortDir },
      // filterApplied: where, // enable if you want to debug
    };
  }
})();