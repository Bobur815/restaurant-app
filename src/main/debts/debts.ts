import type { z } from 'zod';
import type {
  assignDebtInput,
  listDebtorsInput,
  repayInput,
  updateCustomerInput,
  voidRepaymentInput,
  writeOffInput,
} from '@shared/schemas';
import { hasPermission } from '@shared/permissions';
import type { DebtorDetailDto, DebtorDto } from '@shared/types';
import { dec, sum, toMoneyString, type Dec } from '@shared/utils/decimal';
import type { Actor, Db, DbOrTx, Tx } from '../domain/db';
import { decStr, iso, isoOrNull } from '../domain/db';
import { conflict, invalid, isUniqueViolation, notFound } from '../domain/errors';

/**
 * Debt (nasiya), feature F1-C. A debt is a payment row with method `debt` on a customer; money
 * brought back is a DebtRepayment (or an admin WRITE_OFF). Nothing stores a balance:
 *
 *   balance = debt rows of the customer - non-voided repayments and write-offs
 *
 * Repayments cover debt rows in the order they were written (oldest first; a back-dated check
 * edit or an assigned legacy debt goes last, so it never re-opens debt already paid off);
 * `reallocate` recomputes that after every change (each debt row is `paid` with settledAt once
 * fully covered, `pending` otherwise), so the flags can never drift from the money. A repayment
 * may never exceed the balance: no credit is held. A voided repayment counts as never made, in
 * balances and in reports (the day it was entered loses it).
 *
 * Who sees what: the debtor list and a debtor's ledger (name, phone, debts, repayments) are for
 * every user, who take repayments; the customer's address, landmark and note only for admins.
 */

const charges = (tx: DbOrTx, customerId: number | null) =>
  tx.payment.findMany({
    where: { method: 'debt', customerId },
    include: { order: { select: { orderNumber: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

/**
 * The customer a debt goes on, by phone: an existing one is used as is (only an empty name is
 * filled in; renaming or re-activating is an admin's job), a new one needs a name.
 */
export async function debtCustomerId(
  tx: Tx,
  phone: string,
  name: string | null,
  field: string,
): Promise<number> {
  const known = await tx.customer.findUnique({ where: { phone } });
  if (known) {
    if (!known.name && name) await tx.customer.update({ where: { id: known.id }, data: { name } });
    return known.id;
  }
  if (!name) throw invalid('Yangi mijoz uchun ism kerak', { field });
  return (await tx.customer.create({ data: { phone, name } })).id;
}

const credits = (tx: DbOrTx, customerId: number) =>
  tx.debtRepayment.findMany({
    where: { customerId, voidedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

export async function balanceOf(tx: DbOrTx, customerId: number): Promise<Dec> {
  const [c, r] = await Promise.all([charges(tx, customerId), credits(tx, customerId)]);
  return sum(c.map((p) => p.amount.toString())).minus(sum(r.map((x) => x.amount.toString())));
}

/**
 * Covers the customer's debt rows, oldest first, with everything they have paid back. A row is
 * settled when fully covered, at the time of the repayment that completed it.
 */
export async function reallocate(tx: Tx, customerId: number): Promise<void> {
  const [rows, paid] = await Promise.all([charges(tx, customerId), credits(tx, customerId)]);
  // `pool`: repaid money not yet used for older rows; `lastAt`: the latest repayment taken in.
  let pool = dec(0);
  let lastAt: Date | null = null;
  let r = 0;
  for (const row of rows) {
    const amount = dec(row.amount.toString());
    while (pool.lt(amount) && r < paid.length) {
      pool = pool.plus(paid[r]!.amount.toString());
      lastAt = paid[r]!.createdAt;
      r++;
    }
    const covered = pool.gte(amount);
    if (covered) pool = pool.minus(amount);
    // Settled when the repayment that completed it was made.
    const status = covered ? 'paid' : 'pending';
    const at = covered ? lastAt : null;
    if (row.status !== status || (row.settledAt?.getTime() ?? null) !== (at?.getTime() ?? null)) {
      await tx.payment.update({ where: { id: row.id }, data: { status, settledAt: at } });
    }
  }
}

/** Refuses a change that would leave the customer having paid back more than they owe. */
export async function assertNotOverpaid(tx: Tx, customerId: number): Promise<void> {
  if ((await balanceOf(tx, customerId)).lt(0)) {
    throw conflict(
      "Bu qarz qisman qaytarilgan. Avval qaytarilgan to'lovni bekor qiling (Qarzdorlar sahifasi)",
      { reason: 'DEBT_REPAID', customerId },
    );
  }
}

export async function listDebtors(
  db: DbOrTx,
  input: z.infer<typeof listDebtorsInput>,
): Promise<DebtorDto[]> {
  const [rows, repaid] = await Promise.all([
    db.payment.findMany({
      where: { method: 'debt' },
      select: {
        customerId: true,
        amount: true,
        paidAt: true,
        dueDate: true,
        status: true,
        customer: { select: { name: true, phone: true } },
      },
    }),
    db.debtRepayment.groupBy({
      by: ['customerId'],
      where: { voidedAt: null },
      _sum: { amount: true },
    }),
  ]);
  const credit = new Map(repaid.map((r) => [r.customerId, dec(r._sum.amount?.toString() ?? '0')]));
  const now = Date.now();
  const byCustomer = new Map<number | null, DebtorDto & { total: Dec }>();
  for (const p of rows) {
    // Imported debt without a customer: only what was still open in the legacy app is owed.
    if (p.customerId === null && p.status !== 'pending') continue;
    const d = byCustomer.get(p.customerId) ?? {
      customerId: p.customerId,
      name: p.customer?.name ?? null,
      phone: p.customer?.phone ?? null,
      balance: '0',
      openChecks: 0,
      oldestDebtAt: null,
      nextDueDate: null,
      overdue: false,
      total: dec(0),
    };
    d.total = d.total.plus(p.amount.toString());
    if (p.status === 'pending') {
      d.openChecks++;
      if (!d.oldestDebtAt || p.paidAt.toISOString() < d.oldestDebtAt)
        d.oldestDebtAt = p.paidAt.toISOString();
      if (p.dueDate) {
        if (!d.nextDueDate || p.dueDate.toISOString() < d.nextDueDate)
          d.nextDueDate = p.dueDate.toISOString();
        if (p.dueDate.getTime() < now) d.overdue = true;
      }
    }
    byCustomer.set(p.customerId, d);
  }

  const q = input.q?.toLocaleLowerCase();
  const qDigits = input.q?.replace(/\D/g, '');
  return [...byCustomer.values()]
    .map(({ total, ...d }) => ({
      ...d,
      balance: toMoneyString(
        total.minus(d.customerId === null ? 0 : (credit.get(d.customerId) ?? 0)),
      ),
    }))
    .filter((d) => input.includeSettled || dec(d.balance).gt(0))
    .filter(
      (d) =>
        !q ||
        (d.name ?? '').toLocaleLowerCase().includes(q) ||
        (!!qDigits && (d.phone ?? '').includes(qDigits)),
    )
    .sort((a, b) => dec(b.balance).comparedTo(a.balance));
}

/**
 * One debtor's ledger. Only a customer with debt history is a debtor (the ledger is not a way to
 * read any customer by id); `full` (admins) adds the address, landmark and note.
 */
export async function getDebtor(
  db: DbOrTx,
  customerId: number | null,
  { full }: { full: boolean },
): Promise<DebtorDetailDto> {
  const customer =
    customerId === null ? null : await db.customer.findUnique({ where: { id: customerId } });
  if (customerId !== null) {
    const history =
      customer &&
      ((await db.payment.count({ where: { customerId, method: 'debt' } })) > 0 ||
        (await db.debtRepayment.count({ where: { customerId } })) > 0);
    if (!history) throw notFound('Qarzdor');
  }
  const [all, repayments] = await Promise.all([
    charges(db, customerId),
    customerId === null
      ? Promise.resolve([])
      : db.debtRepayment.findMany({
          where: { customerId },
          include: {
            createdBy: { select: { fullName: true } },
            voidedBy: { select: { fullName: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
  ]);
  // Imported debt without a customer: only rows still open in the legacy app are owed (and shown).
  const rows = customerId === null ? all.filter((r) => r.status === 'pending') : all;
  // Legacy debt without a customer has nothing repaid against it: the open rows are what is owed.
  const owed =
    customerId === null
      ? sum(rows.filter((r) => r.status === 'pending').map((r) => r.amount.toString()))
      : sum(rows.map((r) => r.amount.toString())).minus(
          sum(repayments.filter((r) => !r.voidedAt).map((r) => r.amount.toString())),
        );
  return {
    customer: customer && {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      address: full ? customer.address : null,
      landmark: full ? customer.landmark : null,
      note: full ? customer.note : null,
    },
    balance: toMoneyString(owed),
    charges: rows
      .map((r) => ({
        paymentId: r.id,
        orderId: r.orderId,
        orderNumber: r.order.orderNumber,
        amount: decStr(r.amount),
        paidAt: iso(r.paidAt),
        dueDate: isoOrNull(r.dueDate),
        settledAt: isoOrNull(r.settledAt),
      }))
      .reverse(),
    repayments: repayments.map((r) => ({
      id: r.id,
      kind: r.kind,
      method: r.method as 'cash' | 'card' | 'click' | null,
      amount: decStr(r.amount),
      note: r.note,
      createdAt: iso(r.createdAt),
      createdBy: r.createdBy?.fullName ?? null,
      voidedAt: isoOrNull(r.voidedAt),
      voidedBy: r.voidedBy?.fullName ?? null,
      voidReason: r.voidReason,
    })),
  };
}

async function addCredit(
  db: Db,
  actor: Actor,
  data: {
    customerId: number;
    amount: string;
    kind: 'PAYMENT' | 'WRITE_OFF';
    method: 'cash' | 'card' | 'click' | null;
    note: string | null;
  },
): Promise<DebtorDetailDto> {
  await db.$transaction(async (tx) => {
    if (!(await tx.customer.findUnique({ where: { id: data.customerId } })))
      throw notFound('Mijoz');
    // Cash goes into the open shift's drawer (feature F6); with no shift it would be in none.
    if (data.kind === 'PAYMENT' && data.method === 'cash') {
      const open = await tx.session.findFirst({ where: { status: 'open' }, select: { id: true } });
      if (!open) {
        throw conflict(
          "Naqd to'lov uchun smena ochiq bo'lishi kerak. Smenani oching yoki karta/Click bilan qabul qiling",
          { reason: 'NO_OPEN_SHIFT' },
        );
      }
    }
    const balance = await balanceOf(tx, data.customerId);
    if (dec(data.amount).gt(balance)) {
      throw invalid(`Qarzdan ko'p: qarz ${toMoneyString(balance)}`, {
        field: 'amount',
        balance: toMoneyString(balance),
      });
    }
    await tx.debtRepayment.create({ data: { ...data, createdById: actor.id } });
    // The rule again after the write, so it holds however writes may ever interleave.
    await assertNotOverpaid(tx, data.customerId);
    await reallocate(tx, data.customerId);
  });
  return getDebtor(db, data.customerId, { full: hasPermission(actor, 'debtsAdmin') });
}

/** Money brought back against the debt (any user); never more than is owed. */
export function repayDebt(db: Db, actor: Actor, input: z.infer<typeof repayInput>) {
  return addCredit(db, actor, { ...input, kind: 'PAYMENT' });
}

/** Admin: forgives part or all of the debt, with a reason. */
export function writeOffDebt(db: Db, actor: Actor, input: z.infer<typeof writeOffInput>) {
  return addCredit(db, actor, { ...input, kind: 'WRITE_OFF', method: null });
}

/** Admin: a mistaken repayment or write-off is voided (kept, struck through), not deleted. */
export async function voidRepayment(
  db: Db,
  actor: Actor,
  input: z.infer<typeof voidRepaymentInput>,
): Promise<DebtorDetailDto> {
  const customerId = await db.$transaction(async (tx) => {
    const r = await tx.debtRepayment.findUnique({ where: { id: input.repaymentId } });
    if (!r) throw notFound("To'lov");
    if (r.voidedAt) throw conflict("Bu to'lov allaqachon bekor qilingan");
    await tx.debtRepayment.update({
      where: { id: r.id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    });
    await reallocate(tx, r.customerId);
    return r.customerId;
  });
  return getDebtor(db, customerId, { full: true });
}

/** Admin: gives an imported legacy debt (no customer) to a customer found or created by phone. */
export async function assignDebt(
  db: Db,
  input: z.infer<typeof assignDebtInput>,
): Promise<DebtorDetailDto> {
  const customerId = await db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!p || p.method !== 'debt') throw notFound('Qarz');
    if (p.customerId !== null) throw conflict('Bu qarz allaqachon mijozga biriktirilgan');
    // Paid in the legacy app: nothing is owed, so it stays out of every ledger.
    if (p.status !== 'pending') throw conflict("Bu qarz to'langan, biriktirish shart emas");
    const id = await debtCustomerId(tx, input.phone, input.name, 'name');
    // Written now as far as coverage goes: an old debt never takes over repayments already made.
    await tx.payment.update({
      where: { id: p.id },
      data: { customerId: id, createdAt: new Date() },
    });
    await reallocate(tx, id);
    return id;
  });
  return getDebtor(db, customerId, { full: true });
}

/** Admin: corrects a customer's details (the phone stays unique). */
export async function updateCustomer(
  db: Db,
  input: z.infer<typeof updateCustomerInput>,
): Promise<DebtorDetailDto> {
  const { id, ...data } = input;
  if (!(await db.customer.findUnique({ where: { id } }))) throw notFound('Mijoz');
  try {
    await db.customer.update({ where: { id }, data });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict('Bu telefon raqamli mijoz bor', { field: 'phone' });
    throw error;
  }
  return getDebtor(db, id, { full: true });
}
