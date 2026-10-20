import type { z } from 'zod';
import type {
  closeSessionInput,
  listSessionsInput,
  openSessionInput,
  updateSessionInput,
} from '@shared/schemas';
import type { PendingCarryDto, SessionCloseResult, SessionDto } from '@shared/types';
import { dec, roundMoney, toMoneyString, toQtyString, type Dec } from '@shared/utils/decimal';
import { decStr, iso, isoOrNull, type Actor, type Db, type DbOrTx, type Tx } from '../domain/db';
import { conflict, invalid, isUniqueViolation, notFound, prismaCode } from '../domain/errors';

const sessionInclude = {
  items: {
    include: {
      menuItem: { select: { nameUz: true, nameRu: true, soldByWeight: true, imageFile: true } },
    },
    orderBy: { menuItem: { nameUz: 'asc' } },
  },
  openedBy: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
} as const;

type SessionRow = Awaited<ReturnType<typeof loadSession>>;

async function loadSession(db: DbOrTx, id: number) {
  return db.session.findUnique({ where: { id }, include: sessionInclude });
}

function toSessionDto(s: NonNullable<SessionRow>): SessionDto {
  return {
    id: s.id,
    status: s.status,
    openedAt: iso(s.openedAt),
    closedAt: isoOrNull(s.closedAt),
    openedBy: s.openedBy?.fullName ?? null,
    closedBy: s.closedBy?.fullName ?? null,
    items: s.items.map((i) => {
      const initial = dec(i.initialQuantity.toString());
      const sold = dec(i.soldQuantity.toString());
      return {
        menuItemId: i.menuItemId,
        nameUz: i.menuItem.nameUz,
        nameRu: i.menuItem.nameRu,
        soldByWeight: i.menuItem.soldByWeight,
        imageFile: i.menuItem.imageFile,
        initialQuantity: decStr(i.initialQuantity),
        soldQuantity: decStr(i.soldQuantity),
        remainingQuantity: toQtyString(atLeastZero(initial.minus(sold))),
      };
    }),
  };
}

const atLeastZero = (d: Dec): Dec => (d.lt(0) ? dec(0) : d);

export async function getSession(db: DbOrTx, id: number): Promise<SessionDto> {
  const s = await loadSession(db, id);
  if (!s) throw notFound('Smena');
  return toSessionDto(s);
}

export async function getOpenSession(db: DbOrTx): Promise<SessionDto | null> {
  const open = await db.session.findFirst({ where: { status: 'open' }, select: { id: true } });
  return open ? getSession(db, open.id) : null;
}

/** The open shift's id, or CONFLICT: orders cannot be taken without one. */
export async function requireOpenSessionId(db: DbOrTx): Promise<number> {
  const open = await db.session.findFirst({ where: { status: 'open' }, select: { id: true } });
  if (!open) throw conflict('Ochiq smena yo‘q. Avval smenani oching');
  return open.id;
}

export async function listSessions(
  db: Db,
  input: z.infer<typeof listSessionsInput>,
): Promise<SessionDto[]> {
  const rows = await db.session.findMany({
    where: input.status ? { status: input.status } : {},
    include: sessionInclude,
    orderBy: { id: 'desc' },
    take: input.limit,
  });
  return rows.map(toSessionDto);
}

/** Leftovers carried from closed shifts, not yet taken into a new one: pre-fill for opening. */
export async function getPendingCarry(db: DbOrTx): Promise<PendingCarryDto[]> {
  const rows = await db.residual.findMany({
    where: { action: 'CARRY_TO_NEXT', status: 'pending' },
    include: { menuItem: { select: { nameUz: true } } },
    orderBy: [{ sessionId: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    residualId: r.id,
    sessionId: r.sessionId,
    menuItemId: r.menuItemId,
    nameUz: r.menuItem.nameUz,
    quantity: decStr(r.quantity),
    note: r.note,
  }));
}

async function assertActiveDishes(tx: Tx, ids: number[]): Promise<void> {
  const found = await tx.menuItem.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  const ok = new Set(found.map((m) => m.id));
  const missing = ids.filter((id) => !ok.has(id));
  if (missing.length)
    throw invalid('Ayrim taomlar topilmadi yoki faol emas', { menuItemIds: missing });
}

/**
 * Opens a shift with its starting stock. Legacy parity: every pending carried leftover is marked
 * applied to the new shift; the quantities the user entered are taken as final (the UI pre-fills
 * them from getPendingCarry()).
 */
export async function openSession(
  db: Db,
  actor: Actor,
  input: z.infer<typeof openSessionInput>,
): Promise<SessionDto> {
  try {
    const id = await db.$transaction(async (tx) => {
      await assertActiveDishes(
        tx,
        input.items.map((i) => i.menuItemId),
      );
      const session = await tx.session.create({
        data: {
          openedById: actor.id,
          items: {
            create: input.items.map((i) => ({
              menuItemId: i.menuItemId,
              initialQuantity: toQtyString(i.initialQuantity),
            })),
          },
        },
      });
      await tx.residual.updateMany({
        where: { action: 'CARRY_TO_NEXT', status: 'pending' },
        data: { status: 'applied', appliedToSessionId: session.id },
      });
      return session.id;
    });
    return getSession(db, id);
  } catch (error) {
    // sessions.openGuard is UNIQUE (migration 0002): the database refuses a second open shift.
    if (isUniqueViolation(error)) throw conflict('Ochiq smena allaqachon bor');
    throw error;
  }
}

/**
 * Changes the open shift's starting quantities and adds dishes. Legacy parity: dishes not listed
 * are left as they are (never removed). A quantity below what is already sold (which includes
 * unpaid orders) is refused with the offending dishes in `details.violations`.
 */
export async function updateOpenSession(
  db: Db,
  input: z.infer<typeof updateSessionInput>,
): Promise<SessionDto> {
  await db.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: input.sessionId },
      include: { items: true },
    });
    if (!session) throw notFound('Smena');
    if (session.status !== 'open') throw conflict('Smena yopilgan');

    const existing = new Map(session.items.map((i) => [i.menuItemId, i]));
    const added = input.items.filter((i) => !existing.has(i.menuItemId)).map((i) => i.menuItemId);
    if (added.length) await assertActiveDishes(tx, added);

    const violations: Array<{ menuItemId: number; soldQuantity: string; proposed: string }> = [];
    for (const i of input.items) {
      const ex = existing.get(i.menuItemId);
      if (ex && dec(i.initialQuantity).lt(dec(ex.soldQuantity.toString()))) {
        violations.push({
          menuItemId: i.menuItemId,
          soldQuantity: decStr(ex.soldQuantity),
          proposed: i.initialQuantity,
        });
      }
    }
    if (violations.length) {
      throw conflict("Boshlang'ich miqdor sotilganidan kam bo'lishi mumkin emas", { violations });
    }

    for (const i of input.items) {
      const ex = existing.get(i.menuItemId);
      const qty = toQtyString(i.initialQuantity);
      if (!ex) {
        await tx.sessionItem.create({
          data: { sessionId: session.id, menuItemId: i.menuItemId, initialQuantity: qty },
        });
      } else if (!dec(ex.initialQuantity.toString()).equals(qty)) {
        await tx.sessionItem.update({ where: { id: ex.id }, data: { initialQuantity: qty } });
      }
    }
  });
  return getSession(db, input.sessionId);
}

/**
 * Closes the shift and records what happens to each dish's leftover, all in one transaction:
 * - carried part: a CARRY_TO_NEXT residual, pending until the next shift opens;
 * - written-off part: an Expense (residual_writeoff, unit cost = the dish's cost price, or its
 *   sale price when no cost price is set, as legacy did) and a
 *   WRITE_OFF residual linked to it.
 * Per dish, carry + write-off may not exceed the leftover; whatever is not assigned is carried
 * (legacy carried everything when nothing was given, but lost an unassigned remainder).
 * Refused while the shift has unpaid orders: they would be stranded on a closed shift.
 */
export async function closeSession(
  db: Db,
  actor: Actor,
  input: z.infer<typeof closeSessionInput>,
): Promise<SessionCloseResult> {
  return db.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: input.sessionId },
      include: {
        items: {
          include: { menuItem: { select: { price: true, costPrice: true, nameUz: true } } },
        },
      },
    });
    if (!session) throw notFound('Smena');
    if (session.status !== 'open') throw conflict('Smena allaqachon yopilgan');

    const pending = await tx.order.count({ where: { sessionId: session.id, status: 'pending' } });
    if (pending > 0) {
      throw conflict("To'lanmagan buyurtmalar bor. Avval ularni yoping yoki bekor qiling", {
        pendingOrders: pending,
      });
    }

    const actions = new Map(input.actions.map((a) => [a.menuItemId, a]));
    const unknown = input.actions.filter(
      (a) => !session.items.some((i) => i.menuItemId === a.menuItemId),
    );
    if (unknown.length) {
      throw invalid("Smenada yo'q taom uchun ko'rsatma", {
        menuItemIds: unknown.map((a) => a.menuItemId),
      });
    }

    const result: SessionCloseResult = {
      sessionId: session.id,
      closedAt: '',
      carried: [],
      writtenOff: [],
    };

    for (const item of session.items) {
      const remaining = atLeastZero(
        dec(item.initialQuantity.toString()).minus(dec(item.soldQuantity.toString())),
      );
      const action = actions.get(item.menuItemId);
      const writeOff = dec(action?.writeOffQuantity ?? 0);
      const carryAsked = dec(action?.carryQuantity ?? 0);

      if (carryAsked.plus(writeOff).gt(remaining)) {
        throw invalid(
          `"${item.menuItem.nameUz}": qoldiq ${toQtyString(remaining)}, ko'rsatilgani ko'p`,
          {
            menuItemId: item.menuItemId,
            remaining: toQtyString(remaining),
          },
        );
      }
      if (remaining.isZero()) continue;

      const carry = remaining.minus(writeOff); // unassigned remainder carries over
      const note = action?.note ?? '';

      if (carry.gt(0)) {
        await tx.residual.create({
          data: {
            sessionId: session.id,
            menuItemId: item.menuItemId,
            quantity: toQtyString(carry),
            action: 'CARRY_TO_NEXT',
            status: 'pending',
            note,
          },
        });
        result.carried.push({ menuItemId: item.menuItemId, quantity: toQtyString(carry) });
      }

      if (writeOff.gt(0)) {
        // Cost price when the dish has one, else the sale price (legacy behaviour).
        const unitCost = dec((item.menuItem.costPrice ?? item.menuItem.price).toString());
        const amount = roundMoney(unitCost.times(writeOff));
        const expense = await tx.expense.create({
          data: {
            sessionId: session.id,
            menuItemId: item.menuItemId,
            type: 'residual_writeoff',
            quantity: toQtyString(writeOff),
            unitCost: toMoneyString(unitCost),
            amount: amount.toFixed(),
            note,
            createdById: actor.id,
          },
        });
        await tx.residual.create({
          data: {
            sessionId: session.id,
            menuItemId: item.menuItemId,
            quantity: toQtyString(writeOff),
            action: 'WRITE_OFF',
            status: 'applied',
            expenseId: expense.id,
            note,
          },
        });
        result.writtenOff.push({
          menuItemId: item.menuItemId,
          quantity: toQtyString(writeOff),
          amount: amount.toFixed(),
        });
      }
    }

    // openGuard is released by trigger (migration 0002).
    const closed = await tx.session.update({
      where: { id: session.id },
      data: { status: 'closed', closedAt: new Date(), closedById: actor.id },
    });
    result.closedAt = iso(closed.closedAt!);
    return result;
  });
}

/** Only a shift with no orders, leftovers or expenses can be deleted (a mistaken open). */
export async function deleteSession(db: Db, id: number): Promise<void> {
  const session = await db.session.findUnique({
    where: { id },
    include: {
      _count: { select: { orders: true, residuals: true, appliedResiduals: true, expenses: true } },
    },
  });
  if (!session) throw notFound('Smena');
  if (Object.values(session._count).some((n) => n > 0)) {
    throw conflict("Smenada buyurtma yoki qoldiqlar bor, uni o'chirib bo'lmaydi", session._count);
  }
  try {
    await db.session.delete({ where: { id } });
  } catch (error) {
    if (prismaCode(error) === 'P2003') throw conflict("Smenaga bog'liq yozuvlar bor");
    throw error;
  }
}
