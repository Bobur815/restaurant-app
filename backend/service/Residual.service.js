import mongoose from "mongoose";
import ResidualModel from "../models/Residual.model.js";

const DIR = { asc: 1, desc: -1 };
const BY_WHITELIST = new Set(["createdAt", "quantity"]);

function toObjectIdMaybe(v) {
  if (!v) return undefined;
  return mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : undefined;
}

class ResidualService {
  /**
   * Query params (barchasi ixtiyoriy):
   * - start, end (sana oraliq, createdAt bo‘yicha)
   * - session_id, appliedToSession, menu_id
   * - status (pending|applied)
   * - action (CARRY_TO_NEXT|WRITE_OFF)
   * - q (note bo‘yicha qidiruv, regex)
   * - bytype = createdAt|quantity
   * - direction = asc|desc
   * - page, limit
   */
  async getToCarryResidual(query) {
    const {
      start,
      end,
      session_id,
      appliedToSession,
      menu_id,
      status,
      action,
      q,
      bytype = "createdAt",
      direction = "desc",
      page = 1,
      limit = 20,
    } = query;

    // filter build
    const filter = {};

    // Sana oraliq
    if (start || end) {
      const from = start ? new Date(start) : undefined;
      const to = end ? new Date(end) : undefined;
      if (to) to.setHours(23, 59, 59, 999);
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
    }

    // ID filterlar
    const sid = toObjectIdMaybe(session_id);
    if (sid) filter.session_id = sid;

    const aid = toObjectIdMaybe(appliedToSession);
    if (aid) filter.appliedToSession = aid;

    const mid = toObjectIdMaybe(menu_id);
    if (mid) filter.menu_id = mid;

    // Status
    if (status) {
      filter.status = status;
    }

    // Action
    if (action) {
      filter.action = action;
    }

    // Note qidiruv
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.note = rx;
    }

    // sort
    const sortField = BY_WHITELIST.has(bytype) ? bytype : "createdAt";
    const sortDir = direction === "asc" ? DIR.asc : DIR.desc;
    const sortSpec = { [sortField]: sortDir, createdAt: -1 };

    // pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * lim;

    // query + counters
    const [items, totalCount] = await Promise.all([
      ResidualModel.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(lim)
        .populate("menu_id", "name") // ixtiyoriy: mahsulot nomini olish
        .lean(),
      ResidualModel.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / lim));

    // umumiy jamlar
    const totalsAgg = await ResidualModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          sumQuantity: { $sum: "$quantity" },
        },
      },
    ]);

    const sumByAction = {};
    for (const r of totalsAgg) {
      sumByAction[r._id || "unknown"] = {
        count: r.count,
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
        sumByAction,
      },
      sort: { by: sortField, direction: sortDir === 1 ? "asc" : "desc" },
      filterApplied: filter,
    };
  }
}

export default new ResidualService();
