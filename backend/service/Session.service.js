// src/services/Session.service.js
import ExpensesModel from "../models/Expenses.model.js";
import ResidualModel from "../models/Residual.model.js";
import SessionModel from "../models/Sessions.model.js";
import CustomError from "../utils/CustomError.js";

// Kutiladigan action constantlari
export const RES_ACTION = {
  CARRY: "CARRY_TO_NEXT",
  WRITE_OFF: "WRITE_OFF",
};

class SessionService {
  constructor() { }

  /** Fetch all sessions, optionally with a Mongo filter (e.g. { status: 'open' }) */
  async getAll(filter = {}) {
    return SessionModel
      .find(filter)
      .populate({
        path: 'items.menu_id',
        select: 'name image_url'
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

  /** Update arbitrary fields on a session */
  async update(sessionId, data) {
    // e.g. { status: 'closed' } or { items: [...] }
    const updated = await SessionModel.findByIdAndUpdate(sessionId, data, { new: true });
    return updated
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

  /** Close out the session (marks status and stamps closedAt via your pre‐save hook) */
  async close(sessionId, payload = {}) {
    const s = await SessionModel.findById(sessionId);
    if (!s) throw new Error("Session not found");
    if (s.status !== "open") throw new Error("Session is not open");

    const actionsByMenu = new Map();
    for (const a of payload.actions || []) {
      if (!a.menu_id) continue;
      actionsByMenu.set(String(a.menu_id), a);
    }

    // 1) Qoldiqni hisoblash
    const leftovers = [];
    for (const it of s.items) {
      const remaining = (it.initialQuantity || 0) - (it.soldQuantity || 0);
      if (remaining > 0) {
        leftovers.push({
          menu_id: it.menu_id,
          remaining,
        });
      }
    }

    // 2) Har item bo‘yicha foydalanuvchi tanlovi asosida amal
    const residualResults = [];
    const expenseResults = [];

    for (const lf of leftovers) {
      const key = String(lf.menu_id);
      const choice = actionsByMenu.get(key) || { action: RES_ACTION.CARRY }; // default: carry
      const qty = Math.max(0, Math.min(Number(choice.quantity ?? lf.remaining), lf.remaining));

      if (qty === 0) continue;

      if (choice.action === RES_ACTION.CARRY) {
        // Residual pending (keyingi smenaga ko‘chirish)
        const r = await ResidualModel.findOneAndUpdate(
          { session_id: s._id, menu_id: lf.menu_id },
          {
            $set: {
              session_id: s._id,
              menu_id: lf.menu_id,
              quantity: qty,
              action: RES_ACTION.CARRY,
              status: "pending",
              expense_id: null,
              appliedToSession: null,
              note: choice.note ?? "",
            },
          },
          { upsert: true, new: true }
        );
        residualResults.push(r);
      } else if (choice.action === RES_ACTION.WRITE_OFF) {
        // Chiqim yaratamiz va residual'ni darhol applied qilamiz
        const exp = await ExpensesModel.create({
          session_id: s._id,
          menu_id: lf.menu_id,
          type: "residual_writeoff",
          quantity: qty,
          unitCost: Number(choice.unitCost) || 0, // ixtiyoriy
          note: choice.note ?? "",
          reason: "residual",
        });

        const r = await ResidualModel.findOneAndUpdate(
          { session_id: s._id, menu_id: lf.menu_id },
          {
            $set: {
              session_id: s._id,
              menu_id: lf.menu_id,
              quantity: qty,
              action: RES_ACTION.WRITE_OFF,
              status: "applied",
              expense_id: exp._id,
              note: choice.note ?? "",
            },
          },
          { upsert: true, new: true }
        );

        expenseResults.push(exp);
        residualResults.push(r);
      } else {
        // Not supported action
        // eslint-disable-next-line no-console
        console.warn("Unsupported action for menu:", key, choice.action);
      }
    }

    // 3) Sessionni yopish
    s.status = "closed";
    await s.save();

    return {
      session_id: s._id,
      closedAt: s.closedAt,
      residuals: residualResults,
      expenses: expenseResults,
      summary: {
        itemsWithLeftovers: leftovers.length,
        residualCreated: residualResults.length,
        expensesCreated: expenseResults.length,
      },
    };
  }

  /** (Optional) Delete a session */
  async delete(sessionId) {
    return SessionModel.findByIdAndDelete(sessionId);
  }
}

export default new SessionService();
