// backend/services/residual.service.js
import prisma from "../database/prisma.js";

const DIR = { asc: "asc", desc: "desc" };
const BY_WHITELIST = new Set(["createdAt", "quantity"]);
const ACTIONS = new Set(["CARRY_TO_NEXT", "WRITE_OFF"]);
const STATUSES = new Set(["pending", "applied"]);

const toIntId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export default new (class ResidualService {
  /**
   * Query (all optional):
   * - start, end (ISO or yyyy-mm-dd)
   * - sessionId, appliedToSession, menuId (numbers as strings or numbers)
   * - status: pending|applied
   * - action: CARRY_TO_NEXT|WRITE_OFF
   * - q: search in note (case-insensitive)
   * - bytype: createdAt|quantity
   * - direction: asc|desc
   * - page, limit
   *
   * Note: your original code's comment says default action/status,
   * but the implementation only applies them when provided. We keep that behavior.
   */
  async getResiduals(query = {}) {
    const {
      start,
      end,
      sessionId,
      appliedToSession,
      menuId,
      status,
      action,
      q,
      bytype = "createdAt",
      direction = "desc",
      page = 1,
      limit = 20,
    } = query;

    // Build where
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

    // IDs
    const sid = toIntId(sessionId);
    if (sid) where.sessionId = sid;

    const aid = toIntId(appliedToSession);
    if (aid) where.appliedToSession = aid;

    const mid = toIntId(menuId);
    if (mid) where.menuId = mid;

    // Action/status filters (only if provided)
    if (action && ACTIONS.has(action)) where.action = action;
    if (status && STATUSES.has(status)) where.status = status;

    // Note search (LIKE, case-insensitive)
    if (q && String(q).trim()) {
      where.note = { contains: String(q).trim(), mode: "insensitive" };
    }

    // Sort – keep stable fallback by createdAt desc & id desc
    const sortField = BY_WHITELIST.has(bytype) ? bytype : "createdAt";
    const sortDir = direction === "asc" ? DIR.asc : DIR.desc;
    const orderBy = [
      { [sortField]: sortDir },
      { createdAt: "desc" },
      { id: "desc" },
    ];

    // Pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * lim;

    // Parallel queries
    const [items, totalCount, totalsAgg] = await Promise.all([
      prisma.residual.findMany({
        where,
        orderBy,
        skip,
        take: lim,
        select: {
          id: true,
          sessionId: true,
          menuId: true,
          quantity: true,
          action: true,
          status: true,
          appliedToSession: true,
          expenseId: true,
          note: true,
          createdAt: true,
          // populate-like:
          menu: { select: { name: true } },
        },
      }),
      prisma.residual.count({ where }),
      prisma.residual.groupBy({
        by: ["action"],
        where,
        _count: { _all: true },
        _sum: { quantity: true },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / lim));

    // Build sumByAction hash to mirror your output
    const sumByAction = {};
    for (const r of totalsAgg) {
      sumByAction[r.action || "unknown"] = {
        count: r._count?._all ?? 0,
        quantity: r._sum?.quantity ? Number(r._sum.quantity) : 0,
      };
    }

    // Match your previous items shape: include menu name under menuId?name or separate?
    // We'll keep it simple: { menuId, menuName }
    const shapedItems = items.map((it) => ({
      ...it,
      menuName: it.menu?.name ?? null,
    }));

    return {
      items: shapedItems,
      pagination: { page: p, limit: lim, totalCount, totalPages },
      totals: { sumByAction },
      sort: { by: sortField, direction: sortDir },
      // filterApplied: where, // enable for debugging if you like
    };
  }

  /**
   * Mark selected residuals as applied to a target session.
   * - Only updates residuals that are (status='pending' AND action='CARRY_TO_NEXT')
   * - residualIds: array of ids (number or string)
   * - targetSessionId: number or string (session id)
   */
  async applyResidualsToSession(residualIds = [], targetSessionId) {
    if (!Array.isArray(residualIds) || residualIds.length === 0) {
      throw new Error("No residual IDs provided");
    }

    const tsid = toIntId(targetSessionId);
    if (!tsid) {
      throw new Error("Invalid target session ID");
    }

    // Normalize & filter valid id ints
    const ids = residualIds
      .map(toIntId)
      .filter((n) => Number.isInteger(n) && n > 0);

    if (ids.length === 0) {
      throw new Error("No valid residuals found to apply");
    }

    // Single guarded update (pending + CARRY_TO_NEXT)
    const res = await prisma.residual.updateMany({
      where: {
        id: { in: ids },
        action: "CARRY_TO_NEXT",
        status: "pending",
      },
      data: {
        status: "applied",
        appliedToSession: tsid,
      },
    });

    return { modifiedCount: res.count || 0 };
  }
})();
