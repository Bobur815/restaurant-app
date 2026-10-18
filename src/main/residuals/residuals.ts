import type { z } from 'zod';
import type { applyResidualsInput, listExpensesInput, listResidualsInput } from '@shared/schemas';
import type {
  ExpenseDto,
  ExpenseList,
  ExpenseType,
  ResidualAction,
  ResidualList,
} from '@shared/types';
import { dec, sum, toMoneyString, toQtyString } from '@shared/utils/decimal';
import { dayEnd, dayStart, decStr, iso, type Db } from '../domain/db';
import { conflict, notFound } from '../domain/errors';
import { normalizeForSearch } from '../menu/menu-items';

/**
 * Residual and expense lists (legacy filters, sorting, pagination and totals). The note search
 * runs in JS: legacy used Prisma's `mode: "insensitive"`, which SQLite rejects (quirk 6).
 * Lists are per shop and small, so filtering then paging in memory is fine.
 */

function dateRange(start?: string, end?: string) {
  if (!start && !end) return {};
  return {
    createdAt: { ...(start ? { gte: dayStart(start) } : {}), ...(end ? { lte: dayEnd(end) } : {}) },
  };
}

function paginate<T>(all: T[], page: number, limit: number) {
  const totalCount = all.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return {
    items: all.slice((page - 1) * limit, page * limit),
    page,
    limit,
    totalCount,
    totalPages,
  };
}

const matchesNote = (q: string | undefined) => {
  const needle = q ? normalizeForSearch(q) : '';
  return (note: string) => !needle || normalizeForSearch(note).includes(needle);
};

export async function listResiduals(
  db: Db,
  input: z.infer<typeof listResidualsInput>,
): Promise<ResidualList> {
  const rows = await db.residual.findMany({
    where: {
      ...dateRange(input.start, input.end),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.appliedToSessionId ? { appliedToSessionId: input.appliedToSessionId } : {}),
      ...(input.menuItemId ? { menuItemId: input.menuItemId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.action ? { action: input.action } : {}),
    },
    include: { menuItem: { select: { nameUz: true } } },
    orderBy: [{ [input.sortBy]: input.direction }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  const filtered = rows.filter((r) => matchesNote(input.q)(r.note));

  const totals: ResidualList['totals'] = {};
  for (const action of ['CARRY_TO_NEXT', 'WRITE_OFF'] as ResidualAction[]) {
    const of = filtered.filter((r) => r.action === action);
    if (of.length)
      totals[action] = {
        count: of.length,
        quantity: toQtyString(sum(of.map((r) => r.quantity.toString()))),
      };
  }

  return {
    ...paginate(
      filtered.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        menuItemId: r.menuItemId,
        menuNameUz: r.menuItem.nameUz,
        quantity: decStr(r.quantity),
        action: r.action,
        status: r.status,
        appliedToSessionId: r.appliedToSessionId,
        expenseId: r.expenseId,
        note: r.note,
        createdAt: iso(r.createdAt),
      })),
      input.page,
      input.limit,
    ),
    totals,
  };
}

/**
 * Marks selected pending carried leftovers as taken into a shift (legacy "apply"). Only pending
 * CARRY_TO_NEXT rows change; returns how many did.
 */
export async function applyResiduals(
  db: Db,
  input: z.infer<typeof applyResidualsInput>,
): Promise<number> {
  const target = await db.session.findUnique({ where: { id: input.targetSessionId } });
  if (!target) throw notFound('Smena');
  if (target.status !== 'open') throw conflict('Qoldiqlarni faqat ochiq smenaga qo‘shish mumkin');
  const res = await db.residual.updateMany({
    where: { id: { in: input.residualIds }, action: 'CARRY_TO_NEXT', status: 'pending' },
    data: { status: 'applied', appliedToSessionId: target.id },
  });
  return res.count;
}

export async function listExpenses(
  db: Db,
  input: z.infer<typeof listExpensesInput>,
): Promise<ExpenseList> {
  const rows = await db.expense.findMany({
    where: {
      ...dateRange(input.start, input.end),
      ...(input.types?.length ? { type: { in: input.types } } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.menuItemId ? { menuItemId: input.menuItemId } : {}),
    },
    include: { menuItem: { select: { nameUz: true } } },
    orderBy: [{ [input.sortBy]: input.direction }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  const min = input.minAmount ? dec(input.minAmount) : null;
  const max = input.maxAmount ? dec(input.maxAmount) : null;
  const filtered = rows.filter((e) => {
    const amount = dec(e.amount.toString());
    return (!min || amount.gte(min)) && (!max || amount.lte(max)) && matchesNote(input.q)(e.note);
  });

  const byType: ExpenseList['totals']['byType'] = {};
  for (const type of ['residual_writeoff', 'waste', 'breakage'] as ExpenseType[]) {
    const of = filtered.filter((e) => e.type === type);
    if (of.length) {
      byType[type] = {
        count: of.length,
        amount: toMoneyString(sum(of.map((e) => e.amount.toString()))),
        quantity: toQtyString(sum(of.map((e) => e.quantity.toString()))),
      };
    }
  }

  const items: ExpenseDto[] = filtered.map((e) => ({
    id: e.id,
    sessionId: e.sessionId,
    menuItemId: e.menuItemId,
    menuNameUz: e.menuItem?.nameUz ?? null,
    type: e.type,
    note: e.note,
    quantity: decStr(e.quantity),
    unitCost: decStr(e.unitCost),
    amount: decStr(e.amount),
    createdAt: iso(e.createdAt),
  }));

  return {
    ...paginate(items, input.page, input.limit),
    totals: { totalAmount: toMoneyString(sum(filtered.map((e) => e.amount.toString()))), byType },
  };
}
