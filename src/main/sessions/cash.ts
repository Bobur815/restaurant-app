import type { z } from 'zod';
import type { addCashMovementInput } from '@shared/schemas';
import type { CashMovementDto, CashMovementType, ShiftCashSummaryDto } from '@shared/types';
import { dec, sum, toMoneyString, type Dec } from '@shared/utils/decimal';
import { decStr, iso, isoOrNull, type Actor, type DbOrTx, type Db } from '../domain/db';
import { conflict, notFound } from '../domain/errors';

/**
 * The shift's cash drawer (feature F6, posgro's smena cash): opening cash, cash in/out, and the
 * cash the drawer should hold. Money is Decimal throughout.
 *
 * expected = opening + cash payments of the shift's checks + cash debt repayments taken while the
 * shift was open (not voided) + cash in - cash out.
 *
 * Payments are read from the rows that exist now: a cancelled check's payments are deleted and a
 * corrected check's are rewritten (payments.ts), so both are reflected while the shift is open.
 * At close the expected figure is frozen on the shift (closeSession), so later corrections do not
 * change a closed shift's count; the summary shows them as a separate line.
 *
 * Expected can go below zero: a payout is checked against it when made, but cancelling or
 * correcting a cash check later in the same shift is not refused for the drawer's sake.
 * Cash debt repayments need an open shift (debts.ts), so every one lands in a shift's window.
 */

export interface CashFigures {
  opening: Dec;
  sales: { cash: Dec; card: Dec; click: Dec; debt: Dec };
  checksCount: number;
  debtRepaymentsCash: Dec;
  payIn: Dec;
  payOut: Dec;
  expected: Dec;
}

type SessionWindow = {
  id: number;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: { toString(): string };
};

/** The drawer's figures for a shift; an open shift's window runs to `now`. */
export async function cashFigures(
  db: DbOrTx,
  session: SessionWindow,
  now = new Date(),
): Promise<CashFigures> {
  const until = session.closedAt ?? now;
  const [payments, repayments, movements] = await Promise.all([
    db.payment.findMany({
      where: { order: { sessionId: session.id } },
      select: { orderId: true, method: true, amount: true, status: true },
    }),
    db.debtRepayment.findMany({
      where: {
        kind: 'PAYMENT',
        method: 'cash',
        voidedAt: null,
        createdAt: { gte: session.openedAt, lte: until },
      },
      select: { amount: true },
    }),
    db.cashMovement.findMany({
      where: { sessionId: session.id },
      select: { type: true, amount: true },
    }),
  ]);

  // Legacy-imported refunds gave the money back: not in the drawer, not a sale.
  const counted = payments.filter((p) => p.status !== 'refunded');
  const by = (method: string) =>
    sum(counted.filter((p) => p.method === method).map((p) => p.amount.toString()));
  const sales = { cash: by('cash'), card: by('card'), click: by('click'), debt: by('debt') };
  const debtRepaymentsCash = sum(repayments.map((r) => r.amount.toString()));
  const payIn = sum(movements.filter((m) => m.type === 'PAY_IN').map((m) => m.amount.toString()));
  const payOut = sum(movements.filter((m) => m.type === 'PAY_OUT').map((m) => m.amount.toString()));
  const opening = dec(session.openingCash.toString());

  return {
    opening,
    sales,
    checksCount: new Set(counted.map((p) => p.orderId)).size,
    debtRepaymentsCash,
    payIn,
    payOut,
    expected: opening.plus(sales.cash).plus(debtRepaymentsCash).plus(payIn).minus(payOut),
  };
}

function toMovementDto(m: {
  id: number;
  type: string;
  amount: { toString(): string };
  note: string;
  createdAt: Date;
  createdBy: { fullName: string | null } | null;
}): CashMovementDto {
  return {
    id: m.id,
    type: m.type as CashMovementType,
    amount: decStr(m.amount),
    note: m.note,
    createdAt: iso(m.createdAt),
    createdBy: m.createdBy?.fullName ?? null,
  };
}

export async function getCashSummary(db: DbOrTx, sessionId: number): Promise<ShiftCashSummaryDto> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Smena');
  const f = await cashFigures(db, session);
  const movements = await db.cashMovement.findMany({
    where: { sessionId },
    include: { createdBy: { select: { fullName: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // A closed shift keeps the figure it was counted against; a check or repayment corrected after
  // the close shows as its own line, so opening + sales + ... still adds up to it.
  const frozen =
    session.status === 'closed' && session.expectedCash !== null
      ? dec(session.expectedCash.toString())
      : null;
  const expected = frozen ?? f.expected;
  const correction = frozen && !f.expected.equals(frozen) ? frozen.minus(f.expected) : null;
  const counted = session.countedCash === null ? null : dec(session.countedCash.toString());
  return {
    sessionId: session.id,
    status: session.status,
    openedAt: iso(session.openedAt),
    closedAt: isoOrNull(session.closedAt),
    openingCash: toMoneyString(f.opening),
    sales: {
      cash: toMoneyString(f.sales.cash),
      card: toMoneyString(f.sales.card),
      click: toMoneyString(f.sales.click),
      debt: toMoneyString(f.sales.debt),
    },
    salesTotal: toMoneyString(
      f.sales.cash.plus(f.sales.card).plus(f.sales.click).plus(f.sales.debt),
    ),
    checksCount: f.checksCount,
    debtRepaymentsCash: toMoneyString(f.debtRepaymentsCash),
    payIn: toMoneyString(f.payIn),
    payOut: toMoneyString(f.payOut),
    expectedCash: toMoneyString(expected),
    countedCash: counted ? toMoneyString(counted) : null,
    difference: counted ? toMoneyString(counted.minus(expected)) : null,
    correctionAfterClose: correction ? toMoneyString(correction) : null,
    movements: movements.map(toMovementDto),
  };
}

/**
 * Cash in or out of the open shift's drawer. Never edited or deleted: a mistake is corrected with
 * the opposite movement (as posgro). Taking out more than the drawer should hold is refused.
 */
export async function addCashMovement(
  db: Db,
  actor: Actor,
  input: z.infer<typeof addCashMovementInput>,
): Promise<CashMovementDto> {
  return db.$transaction(async (tx) => {
    const session = await tx.session.findFirst({ where: { status: 'open' } });
    if (!session) throw conflict('Ochiq smena yo‘q. Avval smenani oching');
    const amount = dec(input.amount);
    if (input.type === 'PAY_OUT') {
      const { expected } = await cashFigures(tx, session);
      if (amount.gt(expected)) {
        throw conflict(
          `Kassada kutilayotgan naqd ${toMoneyString(expected)} so'm, bundan ko'p chiqarib bo'lmaydi`,
          {
            expectedCash: toMoneyString(expected),
          },
        );
      }
    }
    const created = await tx.cashMovement.create({
      data: {
        sessionId: session.id,
        type: input.type,
        amount: toMoneyString(amount),
        note: input.note,
        createdById: actor.id,
      },
      include: { createdBy: { select: { fullName: true } } },
    });
    return toMovementDto(created);
  });
}
