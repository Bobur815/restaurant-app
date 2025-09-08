import mongoose from "mongoose";
import ExpensesModel from "../models/Expenses.model.js";

const BY_WHITELIST = new Set(["createdAt", "amount"]);
const DIR = { asc: 1, desc: -1 };

function toObjectIdMaybe(v) {
  if (!v) return undefined;
  return mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : undefined;
}

class ExpenseService {
  /**
   * Query params (barchasi ixtiyoriy):
   * - start, end (YYYY-MM-DD)
   * - type (string | csv)
   * - session_id, menu_id
   * - minAmount, maxAmount (number)
   * - q (search in note/reason)
   * - bytype = createdAt | amount
   * - direction = asc | desc
   * - page (default 1), limit (default 20)
   */
  async getAllExpenses(query) {
    const {
      start,
      end,
      type,
      session_id,
      menu_id,
      minAmount,
      maxAmount,
      q,
      bytype = "createdAt",
      direction = "desc",
      page = 1,
      limit = 20,
    } = query;

    // ---- filter build
    const filter = {};

    // Sana (createdAt) oraliği
    if (start || end) {
      const from = start ? new Date(start) : undefined;
      const to = end ? new Date(end) : undefined;
      if (to) to.setHours(23, 59, 59, 999);
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to)   filter.createdAt.$lte = to;
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
    }

    // Tip (bitta yoki CSV ro‘yxat)
    if (type) {
      const parts = String(type)
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      if (parts.length === 1) filter.type = parts[0];
      else if (parts.length > 1) filter.type = { $in: parts };
    }

    // IDlar
    const sId = toObjectIdMaybe(session_id);
    const mId = toObjectIdMaybe(menu_id);
    if (sId) filter.session_id = sId;
    if (mId) filter.menu_id = mId;

    // Summaga ko‘ra filter
    const minA = Number(minAmount);
    const maxA = Number(maxAmount);
    if (!Number.isNaN(minA) || !Number.isNaN(maxA)) {
      filter.amount = {};
      if (!Number.isNaN(minA)) filter.amount.$gte = minA;
      if (!Number.isNaN(maxA)) filter.amount.$lte = maxA;
      if (Object.keys(filter.amount).length === 0) delete filter.amount;
    }

    // Qidiruv (note/reason)
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ note: rx }, { reason: rx }];
    }

    // ---- sort
    const sortField = BY_WHITELIST.has(bytype) ? bytype : "createdAt";
    const sortDir = direction === "asc" ? DIR.asc : DIR.desc;
    const sortSpec = { [sortField]: sortDir, createdAt: -1 }; // barqarorlik uchun 2-darajali

    // ---- pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * lim;

    // ---- parallel query: items + counters
    const [items, totalCount, totalsAgg] = await Promise.all([
      ExpensesModel.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(lim)
        .lean(),

      ExpensesModel.countDocuments(filter),

      ExpensesModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            sumAmount: { $sum: "$amount" },
            sumQuantity: { $sum: "$quantity" },
          },
        },
      ]),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / lim));
    const totalAmount =
      totalsAgg.reduce((s, r) => s + (r.sumAmount || 0), 0) || 0;

    // hash ko‘rinishida sumByType
    const sumByType = {};
    for (const r of totalsAgg) {
      sumByType[r._id || "unknown"] = {
        count: r.count,
        amount: r.sumAmount || 0,
        quantity: r.sumQuantity || 0,
      };
    }

    return {
      items,
      pagination: {
        page: p,
        limit: lim,
        totalCount,
        totalPages,
      },
      totals: {
        totalAmount,
        sumByType,
      },
      sort: { by: sortField, direction: sortDir === 1 ? "asc" : "desc" },
      filterApplied: filter, // debug uchun foydali; prod’da o‘chirishingiz mumkin
    };
  }
}

export default new ExpenseService();
