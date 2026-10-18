// backend/services/session.service.js
import prisma from "../database/prisma.js";
import CustomError from "../utils/CustomError.js";
import { getGlobalPendingQtyByMenu } from "../utils/pendingOrders.js";
import getProductByMenuId from "../utils/getProductByMenuId.js";

export const RES_ACTION = {
  CARRY: "CARRY_TO_NEXT",
  WRITE_OFF: "WRITE_OFF",
};

const toIntId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

class SessionService {
  constructor() {}

  /** Fetch all sessions, optional filter (e.g. { status: 'open' }) */
  async getAll(filter = {}) {
    // Map incoming filter to Prisma where
    const where = {};
    if (filter.status) where.status = String(filter.status);

    const sessions = await prisma.session.findMany({
      where,
      include: {
        items: {
          include: {
            menu: { select: { name: true, imageUrl: true, soldByWeight: true } },
          },
        },
      },
      orderBy: { id: "desc" },
    });

    return sessions;
  }

  /** Fetch a single session by its id */
  async getSingle(sessionId) {
    const id = toIntId(sessionId);
    if (!id) return null;
    return prisma.session.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });
  }

  /** Create a new session (day/period start) + apply pending CARRY residuals as 'applied' to this session */
  async create({ items }) {
    // only one open session
    const exists = await prisma.session.findFirst({ where: { status: "open" } });
    if (exists) throw new Error("Another open session already exists");
    
    // items: [{ menuId, initialQuantity }]
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items required");
    }
    const payloadItems = items.map((it, idx) => {
      const mid = toIntId(it.menuId);
      const init = Number(it.initialQuantity);
      if (!mid) throw new Error(`items[${idx}].menuId is invalid`);
      if (!Number.isFinite(init) || init < 0) {
        throw new Error(`items[${idx}].initialQuantity must be >= 0`);
      }
      return { menuId: mid, initialQuantity: init, soldQuantity: 0 };
    });

    // Create session + items
    const session = await prisma.session.create({
      data: {
        status: "open",
        items: {
          create: payloadItems,
        },
      },
    });

    // Mark existing pending CARRY residuals as applied to this session
    const toCarry = await prisma.residual.findMany({
      where: {
        action: RES_ACTION.CARRY,
        status: "pending",
      },
      select: { id: true },
    });

    if (toCarry.length) {
      await prisma.residual.updateMany({
        where: { id: { in: toCarry.map((r) => r.id) } },
        data: { status: "applied", appliedToSession: session.id },
      });
    }

    return session;
  }

  /** Update a session (merge items initialQuantity with guards) */
  async updateSession(sessionId, data = {}) {
    const id = toIntId(sessionId);
    if (!id) throw new Error("Invalid sessionId");

    const session = await prisma.session.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!session) throw new Error("Session not found");
    if (session.status !== "open") {
      const e = new Error("Session is not open");
      e.code = "SESSION_NOT_OPEN";
      throw e;
    }

    const { items } = data;

    // If no items provided, update other fields and return
    if (items == null) {
      const patch = {};
      // Only allow status change here if desired; otherwise ignore non-items
      if (data.status) patch.status = String(data.status);
      const updated = await prisma.session.update({
        where: { id },
        data: patch,
        include: { items: true },
      });
      return updated;
    }

    if (!Array.isArray(items)) {
      throw new Error("Items should be an array");
    }

    // Normalize incoming items
    const incoming = items.map((it, idx) => {
      const mid = toIntId(it.menuId);
      const init = Number(it.initialQuantity);
      if (!mid) throw new Error(`items[${idx}].menuId is invalid`);
      if (!Number.isFinite(init) || init < 0) {
        throw new Error(`items[${idx}].initialQuantity must be >= 0`);
      }
      return { menuId: mid, initialQuantity: init };
    });

    const incomingMap = new Map(incoming.map((it) => [String(it.menuId), it.initialQuantity]));
    const uniqueMenuIds = Array.from(new Set(incoming.map((x) => x.menuId)));
    // global pending check
    const globalPendingMap = await getGlobalPendingQtyByMenu(uniqueMenuIds);

    // Build next items + collect violations
    const violations = [];
    const existing = session.items || [];
    const nextItems = [];

    // Update existing ones present in incoming
    for (const ex of existing) {
      const key = String(ex.menuId);
      if (!incomingMap.has(key)) {
        // untouched
        nextItems.push(ex);
        continue;
      }

      const proposedInitial = incomingMap.get(key);
      const sold = Number(ex.soldQuantity || 0);

      if (proposedInitial < sold) {
        violations.push({
          menuId: key,
          reason: "LESS_THAN_SOLD",
          soldQuantity: sold,
          proposedInitial,
          message: `initialQuantity (${proposedInitial}) < soldQuantity (${sold})`,
        });
      }

      const pendingNeed = Number(globalPendingMap.get(Number(key)) || 0);
      if (proposedInitial < pendingNeed) {
        violations.push({
          menuId: key,
          reason: "LESS_THAN_GLOBAL_PENDING",
          pendingRequired: pendingNeed,
          proposedInitial,
          message: `initialQuantity (${proposedInitial}) < global pending need (${pendingNeed})`,
        });
      }

      nextItems.push({
        ...ex,
        initialQuantity: proposedInitial,
      });
    }

    // Add new items that are not in existing
    const existingSet = new Set(existing.map((ex) => String(ex.menuId)));
    for (const inc of incoming) {
      const key = String(inc.menuId);
      if (!existingSet.has(key)) {
        const pendingNeed = Number(globalPendingMap.get(inc.menuId) || 0);
        if (inc.initialQuantity < pendingNeed) {
          violations.push({
            menuId: key,
            reason: "LESS_THAN_GLOBAL_PENDING",
            pendingRequired: pendingNeed,
            proposedInitial: inc.initialQuantity,
            message: `initialQuantity (${inc.initialQuantity}) < global pending need (${pendingNeed})`,
          });
        }
        nextItems.push({
          id: undefined, // new
          sessionId: session.id,
          menuId: inc.menuId,
          initialQuantity: inc.initialQuantity,
          soldQuantity: 0,
        });
      }
    }

    if (violations.length) {
      const err = new Error(
        "❌ Ayrim mahsulotlar sotilgan yoki kutilayotgan miqdorlarga nisbatan yaroqsiz"
      );
      err.status = 409;
      err.code = "INITIAL_QTY_CONFLICT";
      err.details = violations;
      throw err;
    }

    // Persist: update existing rows and create new ones
    await prisma.$transaction(async (tx) => {
      // Update rows that already exist and changed
      for (const it of nextItems) {
        if (it.id) {
          // existing
          const existingRow = existing.find((e) => e.id === it.id);
          if (
            existingRow &&
            Number(existingRow.initialQuantity) !== Number(it.initialQuantity)
          ) {
            await tx.sessionItem.update({
              where: { id: it.id },
              data: { initialQuantity: it.initialQuantity },
            });
          }
        } else {
          // new
          await tx.sessionItem.create({
            data: {
              sessionId: session.id,
              menuId: it.menuId,
              initialQuantity: it.initialQuantity,
              soldQuantity: 0,
            },
          });
        }
      }

      // If you want to remove items not present in incoming, you could delete them here.
      // Your original code did NOT delete unspecified items, so we keep them.
    });

    // Return fresh session
    return prisma.session.findUnique({
      where: { id: session.id },
      include: { items: true },
    });
  }

  /** Increase/decrease soldQuantity for a menu inside the open session */
  async recordSale(menuIdRaw, delta = 0, { session } = {}) {
    const menuId = toIntId(menuIdRaw);
    if (!menuId) throw new CustomError("Invalid menu id", 400, "BadRequest");

    // Find open session that has this menu item
    const s = await prisma.session.findFirst({
      where: { status: "open", items: { some: { menuId } } },
      include: { items: true },
    });

    if (!s) throw new CustomError("Open session not found", 404, "NotFoundError");

    const it = s.items.find((i) => i.menuId === menuId);
    if (!it) throw new CustomError("Menu item not in this session", 409, "ConflictException");

    const next = Number(it.soldQuantity) + Number(delta);
    if (next < 0) throw new CustomError("SoldQuantity < 0 bo‘lib qoladi", 400, "BadRequest");
    if (next > Number(it.initialQuantity)) throw new CustomError("Qolganidan ko‘p sotilmoqda", 400, "BadRequest");

    const updated = await prisma.sessionItem.update({
      where: { id: it.id },
      data: { soldQuantity: next },
    });

    return {
      menuId: updated.menuId,
      soldQuantity: Number(updated.soldQuantity),
      remaining: Number(updated.initialQuantity) - Number(updated.soldQuantity),
    };
  }

  /** Close a session and create residuals/expenses as per actions payload */
  async close(sessionId, payload = {}) {
    const id = toIntId(sessionId);
    if (!id) throw new Error("Invalid session id");

    const s = await prisma.session.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!s) throw new Error("Session not found");
    if (s.status !== "open") throw new Error("Session is not open");

    // Build actions map { menuId -> { carry, write, note, unitCost } }
    const actionsByMenu = new Map();
    for (const a of Array.isArray(payload.actions) ? payload.actions : []) {
      if (!a || !a.menuId) continue;
      const mid = toIntId(a.menuId);
      if (!mid) throw new Error(`Invalid menuId in actions: ${a.menuId}`);

      // fetch product for unitCost fallback
      const product = await getProductByMenuId(mid); // make sure it returns { price }
      const unitCost = Number.isFinite(+product?.price) ? +product.price : 0;

      actionsByMenu.set(String(mid), {
        carry: Number.isFinite(+a.carry_to_next_qty) ? +a.carry_to_next_qty : 0,
        write: Number.isFinite(+a.write_off_qty) ? +a.write_off_qty : 0,
        note: a.note ?? "",
        unitCost,
      });
    }

    // 1) leftovers
    const leftovers = [];
    for (const it of s.items || []) {
      const initial = Number(it.initialQuantity || 0);
      const sold = Number(it.soldQuantity || 0);
      const remaining = Math.max(0, initial - sold);
      if (remaining > 0) leftovers.push({ menuId: it.menuId, remaining });
    }

    // 2) distribute carry/write-off
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const residualResults = [];
    const expenseResults = [];

    for (const lf of leftovers) {
      const key = String(lf.menuId);
      const user = actionsByMenu.get(key);

      let carryQty = 0;
      let writeQty = 0;
      let note = "";
      let unitCost = 0;

      if (user) {
        carryQty = clamp(Number(user.carry || 0), 0, lf.remaining);
        writeQty = clamp(Number(user.write || 0), 0, lf.remaining - carryQty);
        note = user.note ?? "";
        unitCost = Number.isFinite(user.unitCost) ? user.unitCost : 0;

        // if both 0 → default all carry
        if (carryQty === 0 && writeQty === 0) carryQty = lf.remaining;
      } else {
        // default all carry
        carryQty = lf.remaining;
      }

      // --- CARRY PART ---
      if (carryQty > 0) {
        // We need to "upsert" by (sessionId, menuId, action)
        const existingCarry = await prisma.residual.findFirst({
          where: { sessionId: s.id, menuId: lf.menuId, action: RES_ACTION.CARRY },
        });

        let rCarry;
        if (existingCarry) {
          rCarry = await prisma.residual.update({
            where: { id: existingCarry.id },
            data: {
              quantity: carryQty,
              status: "pending",
              expenseId: null,
              appliedToSession: null,
              note: note || "",
            },
          });
        } else {
          rCarry = await prisma.residual.create({
            data: {
              sessionId: s.id,
              menuId: lf.menuId,
              quantity: carryQty,
              action: RES_ACTION.CARRY,
              status: "pending",
              expenseId: null,
              appliedToSession: null,
              note: note || "",
            },
          });
        }
        residualResults.push(rCarry);
      }

      // --- WRITE-OFF PART ---
      if (writeQty > 0) {
        // create expense
        const exp = await prisma.expense.create({
          data: {
            sessionId: s.id,
            menuId: lf.menuId,
            type: "residual_writeoff",
            quantity: writeQty,
            unitCost: unitCost,
            amount: unitCost * writeQty,
            note: note || "",
          },
        });

        // upsert residual for WRITE_OFF
        const existingWO = await prisma.residual.findFirst({
          where: { sessionId: s.id, menuId: lf.menuId, action: RES_ACTION.WRITE_OFF },
        });

        let rWO;
        if (existingWO) {
          rWO = await prisma.residual.update({
            where: { id: existingWO.id },
            data: {
              quantity: writeQty,
              action: RES_ACTION.WRITE_OFF,
              status: "applied",
              expenseId: exp.id,
              note: note || "",
            },
          });
        } else {
          rWO = await prisma.residual.create({
            data: {
              sessionId: s.id,
              menuId: lf.menuId,
              quantity: writeQty,
              action: RES_ACTION.WRITE_OFF,
              status: "applied",
              expenseId: exp.id,
              note: note || "",
            },
          });
        }

        expenseResults.push(exp);
        residualResults.push(rWO);
      }
    }

    // 3) close the session (also set closedAt)
    const closed = await prisma.session.update({
      where: { id: s.id },
      data: { status: "closed", closedAt: new Date() },
    });

    // 4) summary
    const itemsWithLeftovers = leftovers.length;
    const totalCarry = residualResults
      .filter((r) => r.action === RES_ACTION.CARRY)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const totalWrite = residualResults
      .filter((r) => r.action === RES_ACTION.WRITE_OFF)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

    return {
      sessionId: closed.id,
      closedAt: closed.closedAt,
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

  /** Delete a session (simple) */
  async delete(sessionId) {
    const id = toIntId(sessionId);
    if (!id) return null;
    try {
      return await prisma.session.delete({ where: { id } });
    } catch (err) {
      // If not found, P2025
      if (err?.code === "P2025") return null;
      throw err;
    }
  }
}

export default new SessionService();
