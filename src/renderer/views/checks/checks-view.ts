import type {
  CheckDto,
  FiscalStatus,
  OrderDto,
  OrderType,
  PaymentMethod,
  PaymentStatus,
} from '@shared/types';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@shared/types';
import { dec, sum, toMoneyString } from '@shared/utils/decimal';
import { formatPhone } from '@shared/utils/phone';
import { api, isApiError } from '../../api';
import { field, selectField, value } from '../../components/forms';
import { confirmDialog, openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore, can } from '../../store/app';
import { html } from '../../ui/html';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQty,
  formatTime,
  localName,
} from '../../utils/format';
import { printReceipt } from '../order/print-receipt';
import { createTenderEditor } from '../order/tender-editor';
import type { TenderMethod } from '@shared/utils/split-payment';
import type { View } from '../types';

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Where an order was served: its table, or takeaway/delivery with the customer's name. */
function where(o: {
  orderType: OrderType;
  tableNumber: number | null;
  customerName: string | null;
}) {
  if (o.orderType === 'DINE_IN')
    return o.tableNumber !== null ? t('tables.table', { n: o.tableNumber }) : '—';
  return [t(`orderType.${o.orderType}`), o.customerName].filter(Boolean).join(' · ');
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const statusBadge = (status: PaymentStatus) =>
  html`<span class="badge ${status === 'paid' ? 'badge-success' : 'badge-muted'}"
    >${t(`checks.status_${status}`)}</span
  >`;

/** Feature F18: the check's fiscal receipt, as a badge (nothing when fiscal was off). */
const FISCAL_BADGE: Record<FiscalStatus, string> = {
  FISCALIZED: 'badge-success',
  PENDING: 'badge-warning',
  DEFERRED_DEBT: 'badge-muted',
  FAILED: 'badge-danger',
  REFUNDED: 'badge-muted',
};
const fiscalBadge = (status: FiscalStatus | null, error?: string | null) =>
  status
    ? html`<span class="badge ${FISCAL_BADGE[status]}" title="${error ?? ''}"
        >${t(`fiscal.status_${status}`)}</span
      >`
    : '';
const waitsForVcr = (s: FiscalStatus | null) =>
  s === 'PENDING' || s === 'FAILED' || s === 'DEFERRED_DEBT';

/**
 * Feature F18: the QR code on the check's paper receipt, read with the barcode scanner (it types
 * the link and Enter) or typed. Null when cancelled.
 */
function askForReceiptQr(message: string): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const body = html`<p>${message}</p>
      ${field({ name: 'scannedQr', label: t('fiscal.scanLabel'), autocomplete: 'off' })}`;
    const modal = openModal({
      title: t('fiscal.scanTitle'),
      body,
      size: 'md',
      actions: [
        { label: t('app.cancel') },
        {
          label: t('checks.delete'),
          kind: 'danger',
          submit: true,
          onClick: () => {
            const v = value(modal.dialog, 'scannedQr');
            if (!v) return false;
            result = v;
          },
        },
      ],
    });
    modal.dialog.querySelector<HTMLInputElement>('[name="scannedQr"]')?.focus();
    void modal.closed.then(() => resolve(result));
  });
}

/** Checks (legacy "cheklar"): payments by day with filters; details; admin edit/delete. */
export const checksView: View = () => {
  const lang = () => appStore.get().language;
  const el = document.createElement('section');
  el.className = 'page';

  const filters = document.createElement('form');
  filters.className = 'filters';
  filters.append(
    html`${field({ name: 'startDate', label: t('checks.from'), type: 'date', value: today() })}
    ${field({ name: 'endDate', label: t('checks.to'), type: 'date', value: today() })}
    ${selectField({
      name: 'method',
      label: t('checks.method'),
      options: [
        { value: '', label: t('checks.all') },
        ...PAYMENT_METHODS.map((m) => ({ value: m, label: t(`payment.${m}`) })),
      ],
    })}
    ${selectField({
      name: 'status',
      label: t('checks.status'),
      options: [
        { value: '', label: t('checks.all') },
        ...PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`checks.status_${s}`) })),
      ],
    })}
    ${appStore.get().fiscal?.enabled
      ? selectField({
          name: 'fiscal',
          label: t('fiscal.filter'),
          options: [
            { value: '', label: t('checks.all') },
            { value: 'waiting', label: t('fiscal.filterWaiting') },
          ],
        })
      : ''}
    ${selectField({
      name: 'orderType',
      label: t('orderType.label'),
      options: [
        { value: '', label: t('checks.all') },
        ...(['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const).map((o) => ({
          value: o,
          label: t(`orderType.${o}`),
        })),
      ],
    })}
    ${field({
      name: 'tableNumber',
      label: t('checks.table'),
      type: 'number',
      inputmode: 'numeric',
      min: 1,
    })}
    ${selectField({
      name: 'sortBy',
      label: t('checks.sort'),
      value: 'paidAt',
      options: [
        { value: 'paidAt', label: t('checks.sortTime') },
        { value: 'tableNumber', label: t('checks.sortTable') },
        { value: 'amount', label: t('checks.sortAmount') },
      ],
    })}`,
  );
  const list = document.createElement('div');
  list.className = 'card';
  // Feature F18: everything still waiting goes to VCR (FAILED ones once more).
  const sendAll = button(t('fiscal.sendAll'), 'secondary', async () => {
    sendAll.disabled = true;
    try {
      const r = await api.fiscal.retryAll();
      toast(
        t('fiscal.sendAllDone', { sent: r.sent, failed: r.failed, pending: r.pending }),
        r.failed || r.pending ? 'error' : 'success',
      );
    } catch (e) {
      toastError(e);
    } finally {
      sendAll.disabled = false;
    }
  });
  const renderSendAll = () => {
    const f = appStore.get().fiscal;
    sendAll.hidden = !(can('checks') && f?.enabled && f.pending + f.failed > 0);
  };
  renderSendAll();
  const stopFiscal = appStore.subscribe(renderSendAll);
  el.append(pageHeader(t('checks.title'), sendAll), filters, list);

  let checks: CheckDto[] = [];

  const render = () => {
    const l = lang();
    if (checks.length === 0) {
      list.replaceChildren(html`<p class="muted empty-inline">${t('checks.empty')}</p>`);
      return;
    }
    const showFiscal = checks.some((c) => c.fiscalStatus !== null);
    const rows = checks.map((c) => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.tabIndex = 0;
      tr.append(
        html`<td class="strong">${c.orderNumber}</td>
          <td>${where(c)}</td>
          <td>${formatDateTime(c.paidAt)}</td>
          <td>
            ${c.methods.map((m) => t(`payment.${m}`)).join(' + ')}
            ${dec(c.debtOpen).gt(0)
              ? html`<span class="muted small">
                  · ${t('checks.debtOpen', { amount: formatMoney(c.debtOpen, l) })}</span
                >`
              : ''}
          </td>
          <td>${statusBadge(c.status)}</td>
          ${showFiscal ? html`<td>${fiscalBadge(c.fiscalStatus, c.fiscalError)}</td>` : ''}
          <td class="num strong">${formatMoney(c.amount, l)}</td>`,
      );
      const open = () => void showOrder(c.orderNumber);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
      });
      return tr;
    });
    const total = toMoneyString(sum(checks.map((c) => c.amount)));
    list.replaceChildren(
      html`<div class="table-wrap">
        <table class="lines-table">
          <thead>
            <tr>
              <th>${t('checks.number')}</th>
              <th>${t('checks.where')}</th>
              <th>${t('checks.time')}</th>
              <th>${t('checks.method')}</th>
              <th>${t('checks.status')}</th>
              ${showFiscal ? html`<th>${t('fiscal.column')}</th>` : ''}
              <th class="num">${t('checks.amount')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="${showFiscal ? '6' : '5'}" class="strong">
                ${t('checks.total', { count: checks.length })}
              </td>
              <td class="num strong">${formatMoney(total, l)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`,
    );
  };

  const load = async () => {
    const table = value(filters, 'tableNumber');
    try {
      checks = await api.checks.list({
        startDate: value(filters, 'startDate') || today(),
        endDate: value(filters, 'endDate') || today(),
        method: (value(filters, 'method') || undefined) as PaymentMethod | undefined,
        status: (value(filters, 'status') || undefined) as PaymentStatus | undefined,
        tableNumber: table ? Number(table) : undefined,
        orderType: (value(filters, 'orderType') || undefined) as OrderType | undefined,
        sortBy: value(filters, 'sortBy') as 'paidAt' | 'tableNumber' | 'amount',
      });
      // Feature F18: "Fiskal emas" = still waiting for VCR (or refused by it).
      if (value(filters, 'fiscal') === 'waiting')
        checks = checks.filter((c) => waitsForVcr(c.fiscalStatus));
      render();
    } catch (e) {
      toastError(e);
    }
  };
  filters.addEventListener('change', () => void load());
  filters.addEventListener('submit', (e) => {
    e.preventDefault();
    void load();
  });

  async function showOrder(orderNumber: string) {
    let order: OrderDto;
    try {
      order = await api.orders.getByNumber({ orderNumber });
    } catch (e) {
      toastError(e);
      return;
    }
    const l = lang();
    const admin = can('corrections');
    const edit = button(t('checks.edit'), 'secondary', () => {
      modal.close();
      void editPayment(order);
    });
    const del = button(t('checks.delete'), 'danger-ghost', async () => {
      const ok = await confirmDialog({
        title: t('checks.delete'),
        message: t('checks.deleteConfirm', { number: order.orderNumber }),
        danger: true,
      });
      if (!ok) return;
      let scannedQr: string | undefined;
      // F18: a fiscalised check is refunded through VCR first; its stored link may be masked.
      for (;;) {
        try {
          await api.checks.delete({ orderNumber: order.orderNumber, scannedQr });
          toast(t('checks.deleted'), 'success');
          modal.close();
          await load();
          return;
        } catch (e) {
          const reason = isApiError(e)
            ? (e.details as { reason?: string } | undefined)?.reason
            : undefined;
          if (reason !== 'RECEIPT_QR_NEEDED' && reason !== 'RECEIPT_QR_OTHER') {
            toastError(e);
            return;
          }
          const next = await askForReceiptQr(
            reason === 'RECEIPT_QR_OTHER' ? t('fiscal.scanOther') : t('fiscal.scanNeeded'),
          );
          if (!next) return;
          scannedQr = next;
        }
      }
    });
    const fiscal = order.fiscal;
    const retry = button(t('fiscal.retry'), 'secondary', async () => {
      retry.disabled = true;
      try {
        const next = await api.fiscal.retry({ orderId: order.id });
        if (next.fiscal?.status === 'FISCALIZED') toast(t('fiscal.sent'), 'success');
        else toast(next.fiscal?.error ?? t('fiscal.notSent'), 'error', 8000);
        modal.close();
      } catch (e) {
        toastError(e);
      } finally {
        retry.disabled = false;
      }
    });
    const duplicate = button(t('fiscal.duplicate'), 'secondary', async () => {
      try {
        await api.fiscal.duplicate({ orderId: order.id });
        toast(t('fiscal.duplicatePrinted'), 'success');
      } catch (e) {
        toastError(e);
      }
    });
    const fiscalLocked = fiscal?.status === 'FISCALIZED' || fiscal?.status === 'REFUNDED';
    const shownNo = fiscal?.receiptNo && fiscal.receiptNo !== '***' ? fiscal.receiptNo : null;
    const fiscalBlock = fiscal
      ? html`<h3 class="section-title">${t('fiscal.receipt')}</h3>
          <p>
            ${fiscalBadge(fiscal.status)}
            ${shownNo
              ? html` <span class="muted">${t('fiscal.receiptNo', { no: shownNo })}</span>`
              : ''}
            ${fiscal.fiscalAt
              ? html` <span class="muted">· ${formatDateTime(fiscal.fiscalAt)}</span>`
              : ''}
          </p>
          ${fiscal.error && fiscal.status !== 'FISCALIZED'
            ? html`<p class="notice notice-error">${fiscal.error}</p>`
            : ''}
          ${fiscal.status === 'DEFERRED_DEBT'
            ? html`<p class="muted small">${t('fiscal.deferredHint')}</p>`
            : ''}
          ${can('checks') && order.status === 'completed'
            ? html`<div class="bulk-actions">
                ${fiscal.status === 'PENDING' || fiscal.status === 'FAILED' ? retry : ''}
                ${fiscal.status === 'FISCALIZED' ? duplicate : ''}
              </div>`
            : ''}`
      : '';
    const print = button(t('printing.print'), 'secondary', () => printReceipt(order.id));
    const body = html`<p class="muted">
        ${where(order)} · ${t(`checks.order_${order.status}`)} · ${t('checks.cashier')}:
        ${order.createdBy ?? '—'}
      </p>
      ${order.orderType !== 'DINE_IN'
        ? html`<p class="muted">
            ${[
              order.customerName,
              order.customerPhone ? formatPhone(order.customerPhone) : null,
              order.deliveryAddress,
              order.deliveryNote,
            ]
              .filter(Boolean)
              .join(' · ')}
            ${dec(order.deliveryFee).gt(0)
              ? ` · ${t('customer.fee')}: ${formatMoney(order.deliveryFee, l)}`
              : ''}
          </p>`
        : ''}
      <h3 class="section-title">${t('checks.lines')}</h3>
      <table class="lines-table">
        <tbody>
          ${order.lines.map(
            (line) =>
              html`<tr>
                <td>
                  ${localName(line, l)}${line.portion && line.portion !== '1'
                    ? html` <span class="muted">× ${line.portion}</span>`
                    : ''}${line.weightKg
                    ? html` <span class="muted">(${formatQty(line.weightKg, l, true)})</span>`
                    : ''}
                </td>
                <td class="num">
                  ${formatQty(line.quantity, l)} × ${formatMoney(line.unitPrice, l, false)}
                </td>
                <td class="num strong">${formatMoney(line.totalPrice, l)}</td>
              </tr>`,
          )}
        </tbody>
        <tfoot>
          ${dec(order.serviceFee).gt(0)
            ? html`<tr>
                <td colspan="2">
                  ${t('order.serviceFee')}${order.guestCount
                    ? html` <span class="muted">(${t('order.guests')}: ${order.guestCount})</span>`
                    : ''}
                </td>
                <td class="num">${formatMoney(order.serviceFee, l)}</td>
              </tr>`
            : ''}
          <tr>
            <td colspan="2" class="strong">${t('order.total')}</td>
            <td class="num strong">${formatMoney(order.totalAmount, l)}</td>
          </tr>
        </tfoot>
      </table>
      <h3 class="section-title">${t('checks.payments')}</h3>
      <table class="lines-table">
        <tbody>
          ${order.payments.map(
            (p) =>
              html`<tr>
                <td>${formatTime(p.paidAt)}</td>
                <td>
                  ${t(`payment.${p.method}`)}
                  ${p.method === 'debt'
                    ? html`<div class="muted small">
                        ${p.customerName ?? t('debts.unknown')}
                        ${p.dueDate ? ` · ${t('payment.dueDate')}: ${formatDate(p.dueDate)}` : ''}
                        ${p.settledAt
                          ? ` · ${t('debts.settledAt', { date: formatDate(p.settledAt) })}`
                          : ''}
                      </div>`
                    : ''}
                </td>
                <td>${statusBadge(p.status)}</td>
                <td class="num strong">${formatMoney(p.amount, l)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${fiscalBlock}
      ${order.status === 'completed'
        ? html`<div class="bulk-actions">
            ${print}${admin && !fiscalLocked ? edit : ''}${admin ? del : ''}
          </div>`
        : ''}`;
    const modal = openModal({
      title: t('checks.details', { number: order.orderNumber }),
      body,
      size: 'md',
    });
  }

  /** Admin: the check's payments re-entered (methods, split, debt), checked like a payment. */
  async function editPayment(order: OrderDto) {
    const debtRow = order.payments.find((p) => p.method === 'debt');
    // The debt customer's phone, to prefill (the check only names them).
    let debtPhone: string | null = null;
    if (debtRow?.customerId) {
      debtPhone =
        (await api.debts.get({ customerId: debtRow.customerId }).catch(() => null))?.customer
          ?.phone ?? null;
    }
    let confirm: HTMLButtonElement | null = null;
    const editor = createTenderEditor({
      total: order.totalAmount,
      orderCustomer: null,
      // Correcting a check: per method only (who paid what is not kept).
      guests: false,
      initial: {
        tenders: order.payments.map((p) => ({
          method: p.method as TenderMethod,
          amount: p.amount,
        })),
        debtCustomer: debtPhone
          ? {
              phone: debtPhone,
              name: debtRow?.customerName ?? null,
              // Stored as the end of a local day: back to that local YYYY-MM-DD.
              dueDate: debtRow?.dueDate ? localDay(new Date(debtRow.dueDate)) : null,
            }
          : null,
      },
      onChange: () => {
        if (confirm) confirm.disabled = !editor.canSubmit();
      },
    });
    const modal = openModal({
      title: t('checks.edit'),
      body: editor.el,
      size: 'md',
      actions: [
        { label: t('app.cancel') },
        {
          label: t('app.save'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            editor.clearErrors();
            if (!editor.canSubmit()) return false;
            try {
              await api.checks.update({
                orderNumber: order.orderNumber,
                expectedVersion: order.version,
                ...editor.result(),
              });
              toast(t('checks.saved'), 'success');
              await load();
            } catch (e) {
              editor.showError(e);
              return false;
            }
          },
        },
      ],
    });
    confirm = modal.dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (confirm) confirm.disabled = !editor.canSubmit();
  }

  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'orders-changed' || e.type === 'debts-changed') void load();
  });
  return {
    el,
    destroy: () => {
      stop();
      stopFiscal();
    },
  };
};
