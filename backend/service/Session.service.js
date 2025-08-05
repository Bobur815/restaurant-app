// src/services/Session.service.js
import SessionModel from "../models/Sessions.model.js";
import CustomError from "../utils/CustomError.js";

class SessionService {
  constructor() {}

  /** Fetch all sessions, optionally with a Mongo filter (e.g. { status: 'open' }) */
  async getAll(filter = {}) {
    const sessions = await SessionModel.find(filter);
    console.log(sessions);
    
    return sessions
  }

  /** Fetch a single session by its _id */
  async getSingle(sessionId) {
    const session = await SessionModel.findById(sessionId);
    return session
  }

  /** Create a new session (day/period start) */
  async create({ items }) {
    // items should be an array of { menu_id, initialQuantity }
    const session = await SessionModel.create({ items });
    return session;
  }

  /** Update arbitrary fields on a session */
  async update(sessionId, data) {
    // e.g. { status: 'closed' } or { items: [...] }
    const updated = await SessionModel.findByIdAndUpdate(sessionId, data, { new: true });
    return updated
  }

  /** Record a sale: increment soldQuantity for a particular menu item */
  async recordSale(sessionId, menuId, quantitySold = 1) {
    const session = await SessionModel.findById(sessionId);
    if (!session) throw new CustomError("Session not found",404,"NotFoundError");
    
    const item = session.items.find(i => i.menu_id.toString() === menuId);
    if (!item) throw new CustomError("Menu item not in this session",409,"ConflictException");

    item.soldQuantity += quantitySold;
    await session.save();
    return item;
  }

  /** Close out the session (marks status and stamps closedAt via your pre‐save hook) */
  async close(sessionId) {
    const session = await SessionModel.findByIdAndUpdate(
      sessionId,
      { status: "closed" },
      { new: true }
    );
    return session;
  }

  /** (Optional) Delete a session */
  async delete(sessionId) {
    return SessionModel.findByIdAndDelete(sessionId);
  }
}

export default new SessionService();
