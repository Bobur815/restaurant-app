import type { FiscalStatus } from '@shared/types';
import type { DbOrTx, Tx } from '../domain/db';
import { conflict } from '../domain/errors';
import { fiscalEnabled } from './config';

/**
 * Feature F18: an order's fiscal status as the payment and debt transactions set it. Sending is
 * FiscalService's job, after commit; these only decide what waits.
 *
 * - Paid with fiscal receipts on: PENDING, or DEFERRED_DEBT while any of its debt is unpaid (the
 *   receipt is issued once the debt is repaid, the debt part as cash: decided 2026-11-11, Q2).
 * - Paid with them off: stays null, never sent.
 */

/** Sent before (an answer may be lost): the next send asks VCR by code first. */
export function wasAttempted(o: { fiscalError: string | null; fiscalAttempts: number }): boolean {
  return o.fiscalError !== null || o.fiscalAttempts > 0;
}

/** In the payment transaction, after the payments are written. */
export async function setFiscalStatusAtPayment(tx: Tx, orderId: number): Promise<void> {
  if (!(await fiscalEnabled(tx))) return;
  const openDebt = await tx.payment.count({
    where: { orderId, method: 'debt', status: 'pending' },
  });
  const status: FiscalStatus = openDebt > 0 ? 'DEFERRED_DEBT' : 'PENDING';
  await tx.order.update({ where: { id: orderId }, data: { fiscalStatus: status } });
}

export interface DebtRowCoverage {
  orderId: number;
  covered: boolean;
  /** A write-off paid part of it: no money came, so no receipt is issued for it. */
  writtenOff: boolean;
}

/**
 * After a customer's debt rows were re-covered (debts.reallocate): an order whose debt is now
 * repaid in money waits no more; one whose debt opened again (a voided repayment) waits again,
 * unless it was already sent. A written-off debt is never fiscalised automatically.
 */
export async function syncDeferredReceipts(tx: Tx, rows: DebtRowCoverage[]): Promise<void> {
  const byOrder = new Map<number, { ready: boolean }>();
  for (const r of rows) {
    const acc = byOrder.get(r.orderId) ?? { ready: true };
    if (!r.covered || r.writtenOff) acc.ready = false;
    byOrder.set(r.orderId, acc);
  }
  if (byOrder.size === 0) return;
  const orders = await tx.order.findMany({
    where: { id: { in: [...byOrder.keys()] }, fiscalStatus: { in: ['PENDING', 'DEFERRED_DEBT'] } },
    select: { id: true, fiscalStatus: true, fiscalError: true, fiscalAttempts: true },
  });
  for (const o of orders) {
    const ready = byOrder.get(o.id)!.ready;
    if (ready && o.fiscalStatus === 'DEFERRED_DEBT') {
      await tx.order.update({ where: { id: o.id }, data: { fiscalStatus: 'PENDING' } });
    } else if (!ready && o.fiscalStatus === 'PENDING' && !wasAttempted(o)) {
      await tx.order.update({ where: { id: o.id }, data: { fiscalStatus: 'DEFERRED_DEBT' } });
    }
  }
}

/** Fiscalised (or refunded) checks keep the payment methods VCR registered. */
export function assertFiscalEditable(o: { fiscalStatus: string | null }): void {
  if (o.fiscalStatus === 'FISCALIZED' || o.fiscalStatus === 'REFUNDED') {
    throw conflict("Fiskal chekning to'lov usullarini o'zgartirib bo'lmaydi", {
      reason: 'FISCALIZED',
    });
  }
}

/** A fiscalised check is deleted only after VCR registered its refund (FiscalService.refund). */
export function assertFiscalDeletable(o: { fiscalStatus: string | null }): void {
  if (o.fiscalStatus === 'FISCALIZED') {
    throw conflict('Avval fiskal chekni qaytaring (VCR orqali)', {
      reason: 'FISCAL_REFUND_NEEDED',
    });
  }
}

/** After a check edit: a not yet sent check follows its new payments. */
/**
 * After a check edit: a not yet sent check follows its new payments. With a debt part it waits
 * (DEFERRED_DEBT) and the caller re-covers the debt (debts.reallocate), which lets it go only when
 * the debt is repaid in money: a debt row covered by a write-off is `paid` too (prisma review F18).
 */
export async function resetFiscalAfterEdit(tx: Tx, orderId: number): Promise<void> {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { fiscalStatus: true } });
  if (!o?.fiscalStatus || o.fiscalStatus === 'FISCALIZED' || o.fiscalStatus === 'REFUNDED') return;
  const debtRows = await tx.payment.count({ where: { orderId, method: 'debt' } });
  // A FAILED check gets its attempts back: its payments changed, VCR may take it now.
  await tx.order.update({
    where: { id: orderId },
    data: {
      fiscalStatus: debtRows > 0 ? 'DEFERRED_DEBT' : 'PENDING',
      ...(o.fiscalStatus === 'FAILED' ? { fiscalAttempts: 0 } : {}),
    },
  });
}

export async function countAwaiting(db: DbOrTx): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([
    db.order.count({ where: { fiscalStatus: 'PENDING', status: 'completed' } }),
    db.order.count({ where: { fiscalStatus: 'FAILED', status: 'completed' } }),
  ]);
  return { pending, failed };
}
