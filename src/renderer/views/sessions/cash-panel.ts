import type { CashMovementType, ShiftCashSummaryDto } from '@shared/types';
import { dec } from '@shared/utils/decimal';
import { api } from '../../api';
import { clearErrors, field, formError, showFormError, value } from '../../components/forms';
import { openModal } from '../../components/modal';
import { button } from '../../components/page';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { formatMoney, formatTime } from '../../utils/format';

/**
 * The shift's cash drawer (feature F6, like posgro): what came in and went out, what the drawer
 * should hold, cash in/out, and the X/Z report. Main computes every figure; this only shows them.
 */

/** A typed amount with spaces or a comma → the decimal string main validates. */
export const moneyIn = (raw: string) => raw.replace(/\s/g, '').replace(',', '.');

const tile = (label: string, val: string, cls = '') =>
  html`<div class="stat-tile ${cls}">
    <span class="stat-label">${label}</span><strong class="stat-value">${val}</strong>
  </div>`;

/** Shortage / overage / exact, with its sign and colour class. */
export function differenceText(difference: string): { label: string; text: string; cls: string } {
  const d = dec(difference);
  const l = appStore.get().language;
  if (d.isZero()) return { label: t('cash.exact'), text: formatMoney('0', l), cls: '' };
  return d.lt(0)
    ? { label: t('cash.shortage'), text: formatMoney(difference, l), cls: 'is-negative' }
    : { label: t('cash.overage'), text: `+${formatMoney(difference, l)}`, cls: 'is-positive' };
}

/** The figures and the movements list (also used in a closed shift's details). */
export function cashSummaryBlock(s: ShiftCashSummaryDto): DocumentFragment {
  const l = appStore.get().language;
  const m = (v: string) => formatMoney(v, l);
  const diff = s.difference === null ? null : differenceText(s.difference);
  return html`<div class="stat-row cash-tiles">
      ${tile(t('cash.opening'), m(s.openingCash))} ${tile(t('cash.cashSales'), m(s.sales.cash))}
      ${tile(t('cash.repayments'), m(s.debtRepaymentsCash))} ${tile(t('cash.payIn'), m(s.payIn))}
      ${tile(t('cash.payOut'), `−${m(s.payOut)}`)}
      ${s.correctionAfterClose !== null
        ? tile(
            t('cash.correction'),
            `${dec(s.correctionAfterClose).gt(0) ? '+' : ''}${m(s.correctionAfterClose)}`,
          )
        : ''}
      ${tile(t('cash.expected'), m(s.expectedCash), 'is-strong')}
      ${s.countedCash !== null ? tile(t('cash.counted'), m(s.countedCash), 'is-strong') : ''}
      ${diff ? tile(diff.label, diff.text, `is-strong ${diff.cls}`) : ''}
    </div>
    <p class="muted small cash-sales-line">
      ${t('cash.otherSales', {
        card: m(s.sales.card),
        click: m(s.sales.click),
        debt: m(s.sales.debt),
        checks: s.checksCount,
      })}
    </p>
    ${s.movements.length
      ? html`<div class="table-wrap">
          <table class="lines-table cash-movements">
            <thead>
              <tr>
                <th>${t('cash.time')}</th>
                <th>${t('cash.type')}</th>
                <th>${t('cash.note')}</th>
                <th>${t('cash.by')}</th>
                <th class="num">${t('cash.amount')}</th>
              </tr>
            </thead>
            <tbody>
              ${s.movements.map(
                (mv) =>
                  html`<tr>
                    <td>${formatTime(mv.createdAt)}</td>
                    <td>${mv.type === 'PAY_IN' ? t('cash.payIn') : t('cash.payOut')}</td>
                    <td>${mv.note || '—'}</td>
                    <td class="muted">${mv.createdBy ?? ''}</td>
                    <td class="num strong ${mv.type === 'PAY_IN' ? 'is-positive' : 'is-negative'}">
                      ${mv.type === 'PAY_IN' ? '+' : '−'}${m(mv.amount)}
                    </td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`
      : html`<p class="muted small">${t('cash.noMovements')}</p>`}`;
}

/** Sends an X or Z report to the receipt printer; never blocks anything, only toasts. */
export async function printShiftReport(sessionId: number, kind: 'X' | 'Z'): Promise<void> {
  try {
    const r = await api.printing.shiftReport({ sessionId, kind });
    toast(t('cash.reportSent', { kind, printer: r.printer }), 'success');
  } catch (error) {
    toast(t('printing.failed', { reason: errorMessage(error) }), 'error', 8000);
  }
}

/** Cash in or out of the open shift's drawer. Resolves true when one was recorded. */
export function cashMovementModal(type: CashMovementType): Promise<boolean> {
  const form = document.createElement('div');
  form.append(
    html`<p class="muted small">${t(type === 'PAY_IN' ? 'cash.payInHint' : 'cash.payOutHint')}</p>
      ${field({ name: 'amount', label: t('cash.amount'), inputmode: 'decimal', required: true })}
      ${field({ name: 'note', label: t('cash.note') })}`,
    formError(),
  );
  let saved = false;
  const modal = openModal({
    title: t(type === 'PAY_IN' ? 'cash.payInTitle' : 'cash.payOutTitle'),
    body: form,
    size: 'sm',
    initialFocus: () => form.querySelector('input'),
    actions: [
      { label: t('app.cancel') },
      {
        label: t('app.save'),
        kind: 'primary',
        submit: true,
        onClick: async () => {
          clearErrors(form);
          try {
            await api.sessions.addCashMovement({
              type,
              amount: moneyIn(value(form, 'amount')),
              note: value(form, 'note'),
            });
            saved = true;
            toast(t(type === 'PAY_IN' ? 'cash.payInDone' : 'cash.payOutDone'), 'success');
          } catch (error) {
            showFormError(form, error);
            return false;
          }
        },
      },
    ],
  });
  return modal.closed.then(() => saved);
}

/** The open shift's drawer card: figures, movements, Kirim / Chiqim / X-hisobot. */
export function cashPanel(sessionId: number): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card cash-panel';
  const payIn = button(t('cash.payIn'), 'secondary', () => void cashMovementModal('PAY_IN'));
  const payOut = button(t('cash.payOut'), 'secondary', () => void cashMovementModal('PAY_OUT'));
  const xReport = button(t('cash.xReport'), 'ghost', () => void printShiftReport(sessionId, 'X'));
  const body = document.createElement('div');
  card.append(
    html`<div class="card-header">
      <h2>${t('cash.title')}</h2>
      <div class="page-actions">${payIn}${payOut}${xReport}</div>
    </div>`,
    body,
  );
  void api.sessions
    .cashSummary({ id: sessionId })
    .then((s) => body.replaceChildren(cashSummaryBlock(s)))
    .catch((error: unknown) => {
      body.replaceChildren(html`<p class="form-error">${errorMessage(error)}</p>`);
    });
  return card;
}
