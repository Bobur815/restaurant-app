// src/services/Session.service.js
import mongoose from "mongoose";
import ExpensesModel from "../models/Expenses.model.js";
import Order_itemsModel from "../models/Order_items.model.js";
import OrdersModel from "../models/Orders.model.js";
import ResidualModel from "../models/Residual.model.js";
import SessionModel from "../models/Sessions.model.js";
import CustomError from "../utils/CustomError.js";
import { getGlobalPendingQtyByMenu } from "../utils/pendingOrders.js";
import getProductByMenuId from "../utils/getProductByMenuId.js";

// Kutiladigan action constantlari
export const RES_ACTION = {
  CARRY: "CARRY_TO_NEXT",
  WRITE_OFF: "WRITE_OFF",
};

const toObjectId = (v) => {
  if (!v) return null;
  const s = String(v);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

class SessionService {
  constructor() { }

  /** Fetch all sessions, optionally with a Mongo filter (e.g. { status: 'open' }) */
  async getAll(filter = {}) {
    return SessionModel
      .find(filter)
      .populate({
        path: 'items.menu_id',
        select: 'name image_url soldByWeight'
      })
      .lean();
  }


  /** Fetch a single session by its _id */
  async getSingle(sessionId) {

    const session = await SessionModel.findById(sessionId);
    return session
  }

  /** Create a new session (day/period start) */
  async create({ items }) {
    const exists = await SessionModel.findOne({ status: "open" }).lean();
    if (exists) throw new Error("Another open session already exists");

    // items should be an array of { menu_id, initialQuantity }
    
    const session = await SessionModel.create({ items });

    // 2) Pending carry residuallarni olamiz (eng so‘nggi yopilgan smenalardan bo‘lishi ham mumkin)
    const toCarry = await ResidualModel.find({
      action: RES_ACTION.CARRY,
      status: "pending",
    }).lean();

    // 4) Residuallarni applied qilish
    await ResidualModel.updateMany(
      { _id: { $in: toCarry.map((x) => x._id) } },
      { $set: { status: "applied", appliedToSession: session._id } }
    );

    return session;
  }

  async updateSession(sessionId, data = {}) {
    const sId = toObjectId(sessionId);
    if (!sId) throw new Error('Invalid sessionId');

    const session = await SessionModel.findById(sId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'open') {
      const e = new Error('Session is not open');
      e.code = 'SESSION_NOT_OPEN';
      throw e;
    }

    const { items } = data;

    // If no items provided, update other fields and return
    if (items == null) {
      Object.entries(data).forEach(([k, v]) => { if (k !== 'items') session.set(k, v); });
      await session.save();
      return session;
    }

    if (!Array.isArray(items)) {
      throw new Error('Items should be an array');
    }

    // Normalize incoming items (only fields you allow to update)
    const incoming = items.map((it, idx) => {
      const mid = toObjectId(it.menu_id);
      const init = Number(it.initialQuantity);
      if (!mid) throw new Error(`items[${idx}].menu_id is invalid`);
      if (!Number.isFinite(init) || init < 0) {
        throw new Error(`items[${idx}].initialQuantity must be >= 0`);
      }
      return { menu_id: mid, initialQuantity: init };
    });

    // Build quick lookup for incoming
    const incomingMap = new Map(incoming.map(it => [String(it.menu_id), it.initialQuantity]));

    // Global pending guard for these menu_ids (until orders have session_id)
    const uniqueMenuIds = Array.from(new Set(incoming.map(x => String(x.menu_id)))).map(toObjectId);
    const globalPendingMap = await getGlobalPendingQtyByMenu(uniqueMenuIds);

    // Merge into existing items while preserving soldQuantity; validate
    const violations = [];
    const existing = session.items || [];
    const nextItems = existing.map((ex) => {
      const key = String(ex.menu_id);
      if (!incomingMap.has(key)) return ex; // not touched

      const proposedInitial = incomingMap.get(key);
      const sold = Number(ex.soldQuantity || 0);

      // 1) cannot go below what is already sold in this session
      if (proposedInitial < sold) {
        violations.push({
          menu_id: key,
          reason: 'LESS_THAN_SOLD',
          soldQuantity: sold,
          proposedInitial,
          message: `initialQuantity (${proposedInitial}) < soldQuantity (${sold})`,
        });
      }

      // 2) cannot go below globally pending orders for this menu (until session link exists)
      const pendingNeed = globalPendingMap.get(key) || 0;
      if (proposedInitial < pendingNeed) {
        violations.push({
          menu_id: key,
          reason: 'LESS_THAN_GLOBAL_PENDING',
          pendingRequired: pendingNeed,
          proposedInitial,
          message: `initialQuantity (${proposedInitial}) < global pending need (${pendingNeed})`,
        });
      }

      // merge: keep soldQuantity, only change initialQuantity (and whatever else you allow)
      return {
        ...ex.toObject?.() ?? ex,
        initialQuantity: proposedInitial,
      };
    });

    // Items present only in incoming (newly added) — add them with soldQuantity=0
    for (const inc of incoming) {
      const exists = existing.some(ex => String(ex.menu_id) === String(inc.menu_id));
      if (!exists) {
        const pendingNeed = globalPendingMap.get(String(inc.menu_id)) || 0;
        if (inc.initialQuantity < pendingNeed) {
          violations.push({
            menu_id: String(inc.menu_id),
            reason: 'LESS_THAN_GLOBAL_PENDING',
            pendingRequired: pendingNeed,
            proposedInitial: inc.initialQuantity,
            message: `initialQuantity (${inc.initialQuantity}) < global pending need (${pendingNeed})`,
          });
        }
        nextItems.push({
          menu_id: inc.menu_id,
          initialQuantity: inc.initialQuantity,
          soldQuantity: 0,
        });
      }
    }

    if (violations.length) {
      const err = new Error('❌ Ayrim mahsulotlar sotilgan yoki kutilayotgan miqdorlarga nisbatan yaroqsiz');
      err.status = 409;
      err.code = 'INITIAL_QTY_CONFLICT';
      err.details = violations;

      throw err;
    }

    // Apply non-items fields
    Object.entries(data).forEach(([k, v]) => { if (k !== 'items') session.set(k, v); });

    // Replace items with merged array (soldQuantity preserved)
    session.set('items', nextItems);
    await session.save();

    return session;
  }

  async recordSale(menuId, delta = 0, { session } = {}) {
    const s = await SessionModel
      .findOne({ status: 'open', 'items.menu_id': menuId })
      .session(session);

    if (!s) throw new CustomError("Open session not found", 404, "NotFoundError");

    const it = s.items.find(i => i.menu_id.equals(menuId));
    if (!it) throw new CustomError("Menu item not in this session", 409, "ConflictException");

    const next = it.soldQuantity + Number(delta);

    if (next < 0) throw new CustomError("SoldQuantity < 0 bo‘lib qoladi", 400, "BadRequest");
    if (next > it.initialQuantity) throw new CustomError("Qolganidan ko‘p sotilmoqda", 400, "BadRequest");

    it.soldQuantity = next;
    await s.save({ session });
    return { menu_id: it.menu_id, soldQuantity: it.soldQuantity, remaining: it.initialQuantity - it.soldQuantity };
  }


  async close(sessionId, payload = {}) {
    const s = await SessionModel.findById(sessionId);
    if (!s) throw new Error('Session not found');
    if (s.status !== 'open') throw new Error('Session is not open');

    // Make actions map: menu_id => { carry_to_next_qty, write_off_qty }
    const actionsByMenu = new Map();
    for (const a of Array.isArray(payload.actions) ? payload.actions : []) {
      if (!a || !a.menu_id) continue;

      const product = await getProductByMenuId(toObjectId(a.menu_id));
      if (!product) {
        throw new Error(`Invalid menu_id in actions: ${a.menu_id}`);
      }

      const unitCost = Number.isFinite(+product.price) ? +product.price : 0;

      actionsByMenu.set(String(a.menu_id), {
        carry: Number.isFinite(+a.carry_to_next_qty) ? +a.carry_to_next_qty : 0,
        write: Number.isFinite(+a.write_off_qty) ? +a.write_off_qty : 0,
        note: a.note ?? '',
        unitCost,
      });
    }

    // 1) Qoldiqni hisoblash
    const leftovers = [];
    for (const it of s.items || []) {
      const initial = Number(it.initialQuantity || 0);
      const sold = Number(it.soldQuantity || 0);
      const remaining = Math.max(0, initial - sold);
      if (remaining > 0) {
        leftovers.push({ menu_id: it.menu_id, remaining });
      }
    }

    // 2) Taqsimlash: carry / write-off
    const residualResults = [];
    const expenseResults = [];

    // helper clamp
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

    for (const lf of leftovers) {
      const key = String(lf.menu_id);
      const user = actionsByMenu.get(key);

      let carryQty = 0;
      let writeQty = 0;
      let note, unitCost;

      if (user) {

        // foydalanuvchi kiritgan qiymatlar
        carryQty = clamp(Number(user.carry || 0), 0, lf.remaining);
        writeQty = clamp(Number(user.write || 0), 0, lf.remaining - carryQty);
        note = user.note ?? '';
        unitCost = user.unitCost;
        // agar ikkalasi ham 0 bo‘lsa — default: hammasi carry
        if (carryQty === 0 && writeQty === 0) {
          carryQty = lf.remaining;
        }
      } else {
        // default: hammasi carry
        carryQty = lf.remaining;
        note = '';
      }

      // --- CARRY QISMI ---
      if (carryQty > 0) {
        // Har action uchun alohida hujjat saqlash uchun filter ga action ham qo‘shamiz
        const rCarry = await ResidualModel.findOneAndUpdate(
          { session_id: s._id, menu_id: lf.menu_id, action: RES_ACTION.CARRY },
          {
            $set: {
              session_id: s._id,
              menu_id: lf.menu_id,
              quantity: carryQty,
              action: RES_ACTION.CARRY,
              status: 'pending',
              expense_id: null,
              appliedToSession: null,
              note: note || '',
            },
          },
          { upsert: true, new: true }
        );
        residualResults.push(rCarry);
      }

      // --- WRITE-OFF QISMI ---
      if (writeQty > 0) {
        const exp = await ExpensesModel.create({
          session_id: s._id,
          menu_id: lf.menu_id,
          type: 'residual_writeoff',
          quantity: writeQty,
          unitCost: Number.isFinite(unitCost) ? unitCost : 0,
          amount: (Number.isFinite(unitCost) ? unitCost : 0) * writeQty,
          note: note || '',
        });
        
        const rWO = await ResidualModel.findOneAndUpdate(
          { session_id: s._id, menu_id: lf.menu_id, action: RES_ACTION.WRITE_OFF },
          {
            $set: {
              session_id: s._id,
              menu_id: lf.menu_id,
              quantity: writeQty,
              action: RES_ACTION.WRITE_OFF,
              status: 'applied',
              expense_id: exp._id,
              note: note || '',
            },
          },
          { upsert: true, new: true }
        );

        expenseResults.push(exp);
        residualResults.push(rWO);
      }
    }

    // 3) Sessionni yopish (pre-save hook closedAt ni set qiladi)
    s.status = 'closed';
    await s.save();

    // 4) Summary
    const itemsWithLeftovers = leftovers.length;
    const totalCarry = residualResults
      .filter(r => r.action === RES_ACTION.CARRY)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const totalWrite = residualResults
      .filter(r => r.action === RES_ACTION.WRITE_OFF)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

    return {
      session_id: s._id,
      closedAt: s.closedAt,
      residuals: residualResults,
      expenses: expenseResults,
      summary: {
        itemsWithLeftovers,
        residualCreated: residualResults.length,
        expensesCreated: expenseResults.length,
        totalCarry,
        totalWriteOff: totalWrite,
      },
    };
  }

  /** (Optional) Delete a session */
  async delete(sessionId) {
    return SessionModel.findByIdAndDelete(sessionId);
  }
}

export default new SessionService();
