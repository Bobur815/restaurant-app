import mongoose from 'mongoose';
import ResidualModel from '../models/Residual.model.js';

const DIR = { asc: 1, desc: -1 };
const BY_WHITELIST = new Set(['createdAt', 'quantity']);
const ACTIONS = new Set(['CARRY_TO_NEXT', 'WRITE_OFF']);
const STATUSES = new Set(['pending', 'applied']);

function toObjectIdMaybe(v) {
  if (!v) return undefined;
  const s = String(v);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : undefined;
}

class ResidualService {
  /**
   * Query (hammasi ixtiyoriy):
   * - start, end (ISO yoki yyyy-mm-dd)
   * - session_id, appliedToSession, menu_id (ObjectId)
   * - status: pending|applied
   * - action: CARRY_TO_NEXT|WRITE_OFF
   * - q: note bo‘yicha regex qidiruv
   * - bytype: createdAt|quantity
   * - direction: asc|desc
   * - page, limit
   *
   * Default: action=CARRY_TO_NEXT, status=pending (ko‘chiriladiganlar ro‘yxati).
   */
  async getResiduals(query = {}) {
    const {
      start,
      end,
      session_id,
      appliedToSession,
      menu_id,
      status,
      action,
      q,
      bytype = 'createdAt',
      direction = 'desc',
      page = 1,
      limit = 20,
    } = query;

    const filter = {};

    // Sana oraliq
    if (start || end) {
      const from = start ? new Date(start) : undefined;
      const to = end ? new Date(end) : undefined;
      if (to) to.setHours(23, 59, 59, 999);
      const createdRange = {};
      if (from && !isNaN(from)) createdRange.$gte = from;
      if (to && !isNaN(to)) createdRange.$lte = to;
      if (Object.keys(createdRange).length) filter.createdAt = createdRange;
    }

    // ID filtrlari
    const sid = toObjectIdMaybe(session_id);
    if (sid) filter.session_id = sid;

    const aid = toObjectIdMaybe(appliedToSession);
    if (aid) filter.appliedToSession = aid;

    const mid = toObjectIdMaybe(menu_id);
    if (mid) filter.menu_id = mid;

    // Action/status (default: ko‘chiriladiganlar)
    if (action && ACTIONS.has(action)) {
      filter.action = action;
    }
    if (status && STATUSES.has(status)) {
      filter.status = status;
    }

    // Note regex
    if (q && q.trim()) {
      const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.note = new RegExp(safe, 'i');
    }

    // sort
    const sortField = BY_WHITELIST.has(bytype) ? bytype : 'createdAt';
    const sortDir = direction === 'asc' ? DIR.asc : DIR.desc;
    const sortSpec = { [sortField]: sortDir, createdAt: -1, _id: -1 }; // barqaror

    // pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * lim;

    // ma'lumotlar + sanash
    const [items, totalCount, totalsAgg] = await Promise.all([
      ResidualModel.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(lim)
        .select({ // keraklisini oling
          session_id: 1, menu_id: 1, quantity: 1, action: 1, status: 1,
          appliedToSession: 1, expense_id: 1, note: 1, createdAt: 1
        })
        .populate('menu_id', 'name') // ixtiyoriy
        .lean(),
      ResidualModel.countDocuments(filter),
      ResidualModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 },
            sumQuantity: { $sum: '$quantity' },
          },
        },
      ]),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / lim));
    const sumByAction = {};
    for (const r of totalsAgg) {
      sumByAction[r._id || 'unknown'] = {
        count: r.count,
        quantity: r.sumQuantity || 0,
      };
    }

    return {
      items,
      pagination: { page: p, limit: lim, totalCount, totalPages },
      totals: { sumByAction },
      sort: { by: sortField, direction: sortDir === 1 ? 'asc' : 'desc' },
      filterApplied: filter,
    };
  }

  async applyResidualsToSession(residualIds = [], targetSessionId) {
    if (!Array.isArray(residualIds) || !residualIds.length) {
      throw new Error('No residual IDs provided');
    }
    const tsid = toObjectIdMaybe(targetSessionId);
    if (!tsid) {
      throw new Error('Invalid target session ID');
    }

    // Faqat pending va CARRY_TO_NEXT larni qabul qilamiz
    const residuals = await ResidualModel.find({
      _id: { $in: residualIds.map(id => toObjectIdMaybe(id)).filter(id => id) },
      action: 'CARRY_TO_NEXT',
      status: 'pending',
    });

    if (!residuals.length) {
      throw new Error('No valid residuals found to apply');
    }    

    const bulkOps = residuals.map(r => ({
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            status: 'applied',
            appliedToSession: tsid,
          },
        },
      },
    }));

    const res = await ResidualModel.bulkWrite(bulkOps);
    return { modifiedCount: res.modifiedCount || 0 };
  }
}

export default new ResidualService();
