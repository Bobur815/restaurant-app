import type { DebtorDetailDto, DebtorDto } from '@shared/types';
import { dec, sum, toMoneyString } from '@shared/utils/decimal';
import { formatPhone } from '@shared/utils/phone';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  field,
  formError,
  selectField,
  showFormError,
  value,
} from '../../components/forms';
import { openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { phoneField } from '../../components/phone-field';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore, can } from '../../store/app';
import { html } from '../../ui/html';
import { formatDate, formatDateTime, formatMoney, toInputDecimal } from '../../utils/format';
import type { View } from '../types';

const moneyIn = (raw: string) => raw.replace(/\s/g, '').replace(',', '.');
const who = (d: { name: string | null; phone: string | null }) =>
  d.name ?? (d.phone ? formatPhone(d.phone) : t('debts.unknown'));

/** A small form in a modal; resolves when it closes. `save` returns false to stay open. */
function formModal(title: string, body: Node, save: (form: HTMLElement) => Promise<void>) {
  const form = document.createElement('div');
  form.append(body, formError());
  const modal = openModal({
    title,
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
            await save(form);
          } catch (error) {
            showFormError(form, error);
            return false;
          }
        },
      },
    ],
  });
  return modal.closed;
}

/**
 * Debtors (nasiya, feature F1-C): who owes how much, oldest and due dates, overdue first in the
 * eye. A customer's window shows their ledger (debt checks, repayments, write-offs); any user
 * takes a repayment, admins write off, void a mistaken entry, fix the customer, and give imported
 * debts without a customer to someone.
 */
export const debtorsView: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const filters = document.createElement('form');
  filters.className = 'filters';
  filters.append(
    html`${field({ name: 'q', label: t('debts.search') })}
    ${can('debtsAdmin')
      ? checkboxField({ name: 'includeSettled', label: t('debts.includeSettled') })
      : ''}`,
  );
  const tiles = document.createElement('div');
  tiles.className = 'stat-row';
  const list = document.createElement('div');
  list.className = 'card';
  el.append(pageHeader(t('debts.title')), filters, tiles, list);

  let debtors: DebtorDto[] = [];
  let open: { customerId: number | null; refresh: () => Promise<void> } | null = null;

  const render = () => {
    const l = appStore.get().language;
    const owing = debtors.filter((d) => dec(d.balance).gt(0));
    tiles.replaceChildren(
      html`<div class="stat-tile">
          <span class="stat-label">${t('debts.totalOwed')}</span>
          <strong class="stat-value"
            >${formatMoney(toMoneyString(sum(owing.map((d) => d.balance))), l)}</strong
          >
        </div>
        <div class="stat-tile">
          <span class="stat-label">${t('debts.debtors')}</span>
          <strong class="stat-value">${owing.length}</strong>
        </div>
        <div class="stat-tile">
          <span class="stat-label">${t('debts.overdue')}</span>
          <strong class="stat-value">${owing.filter((d) => d.overdue).length}</strong>
        </div>`,
    );
    if (debtors.length === 0) {
      list.replaceChildren(html`<p class="muted empty-inline">${t('debts.empty')}</p>`);
      return;
    }
    const rows = debtors.map((d) => {
      const tr = document.createElement('tr');
      tr.className = `clickable${d.overdue ? ' is-overdue' : ''}`;
      tr.tabIndex = 0;
      tr.append(
        html`<td>
            <div class="strong">${who(d)}</div>
            <div class="muted small">${d.phone ? formatPhone(d.phone) : ''}</div>
          </td>
          <td class="num">${d.openChecks}</td>
          <td>${d.oldestDebtAt ? formatDate(d.oldestDebtAt) : '—'}</td>
          <td>
            ${d.nextDueDate ? formatDate(d.nextDueDate) : '—'}
            ${d.overdue ? html`<span class="badge badge-danger">${t('debts.overdue')}</span>` : ''}
          </td>
          <td class="num strong">${formatMoney(d.balance, l)}</td>`,
      );
      const show = () => void showDebtor(d.customerId);
      tr.addEventListener('click', show);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') show();
      });
      return tr;
    });
    list.replaceChildren(
      html`<div class="table-wrap">
        <table class="lines-table">
          <thead>
            <tr>
              <th>${t('debts.customer')}</th>
              <th class="num">${t('debts.openChecks')}</th>
              <th>${t('debts.since')}</th>
              <th>${t('payment.dueDate')}</th>
              <th class="num">${t('debts.balance')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`,
    );
  };

  const load = async () => {
    try {
      debtors = await api.debts.list({
        q: value(filters, 'q') || undefined,
        includeSettled: checked(filters, 'includeSettled'),
      });
      render();
    } catch (error) {
      toastError(error);
    }
  };
  // Search as you type, once typing pauses (each search reads the whole debt ledger).
  let typing: ReturnType<typeof setTimeout> | undefined;
  filters.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => void load(), 250);
  });
  filters.addEventListener('submit', (e) => {
    e.preventDefault();
    void load();
  });

  // ── one customer's ledger ──────────────────────────────────────────────────────────────────

  async function showDebtor(customerId: number | null) {
    const admin = can('debtsAdmin');
    const body = document.createElement('div');
    body.className = 'debtor-detail';

    const repay = (d: DebtorDetailDto) => {
      const fields = html`${field({
        name: 'amount',
        label: t('debts.amount'),
        inputmode: 'decimal',
        value: toInputDecimal(d.balance),
      })}
      ${selectField({
        name: 'method',
        label: t('payment.method'),
        options: (['cash', 'card', 'click'] as const).map((m) => ({
          value: m,
          label: t(`payment.${m}`),
        })),
      })}
      ${field({ name: 'note', label: t('debts.note') })}`;
      void formModal(t('debts.repay'), fields, async (form) => {
        await api.debts.repay({
          customerId: d.customer!.id,
          amount: moneyIn(value(form, 'amount')),
          method: value(form, 'method') as 'cash' | 'card' | 'click',
          note: value(form, 'note') || null,
        });
        toast(t('debts.repaid'), 'success');
      }).then(refresh);
    };

    const writeOff = (d: DebtorDetailDto) => {
      const fields = html`${field({
        name: 'amount',
        label: t('debts.amount'),
        inputmode: 'decimal',
        value: toInputDecimal(d.balance),
      })}
      ${field({ name: 'note', label: t('debts.reason'), required: true })}`;
      void formModal(t('debts.writeOff'), fields, async (form) => {
        await api.debts.writeOff({
          customerId: d.customer!.id,
          amount: moneyIn(value(form, 'amount')),
          note: value(form, 'note'),
        });
        toast(t('debts.writtenOff'), 'success');
      }).then(refresh);
    };

    const voidEntry = (repaymentId: number) => {
      const fields = html`<p>${t('debts.voidHint')}</p>
        ${field({ name: 'reason', label: t('debts.reason'), required: true })}`;
      void formModal(t('debts.void'), fields, async (form) => {
        await api.debts.void({ repaymentId, reason: value(form, 'reason') });
        toast(t('debts.voided'), 'success');
      }).then(refresh);
    };

    const editCustomer = (d: DebtorDetailDto) => {
      const c = d.customer!;
      const phone = phoneField({ name: 'phone', label: t('customer.phone'), value: c.phone });
      const fields = html`${phone.el}
      ${field({ name: 'name', label: t('customer.name'), value: c.name ?? '' })}
      ${field({ name: 'address', label: t('customer.address'), value: c.address ?? '' })}
      ${field({ name: 'landmark', label: t('customer.landmark'), value: c.landmark ?? '' })}
      ${field({ name: 'note', label: t('debts.note'), value: c.note ?? '' })}`;
      void formModal(t('debts.editCustomer'), fields, async (form) => {
        await api.customers.update({
          id: c.id,
          phone: phone.digits(),
          name: value(form, 'name') || null,
          address: value(form, 'address') || null,
          landmark: value(form, 'landmark') || null,
          note: value(form, 'note') || null,
        });
        toast(t('settings.saved'), 'success');
      }).then(refresh);
    };

    const assign = (paymentId: number) => {
      const phone = phoneField({ name: 'phone', label: t('customer.phone') });
      const fields = html`<p>${t('debts.assignHint')}</p>
        ${phone.el}${field({ name: 'name', label: t('customer.name') })}`;
      void formModal(t('debts.assign'), fields, async (form) => {
        await api.debts.assign({
          paymentId,
          phone: phone.digits(),
          name: value(form, 'name') || null,
        });
        toast(t('debts.assigned'), 'success');
      }).then(refresh);
    };

    function draw(d: DebtorDetailDto) {
      const l = appStore.get().language;
      const actions = document.createElement('div');
      actions.className = 'bulk-actions';
      if (d.customer && dec(d.balance).gt(0)) {
        actions.append(button(t('debts.repay'), 'primary', () => repay(d)));
        if (admin) actions.append(button(t('debts.writeOff'), 'secondary', () => writeOff(d)));
      }
      if (d.customer && admin)
        actions.append(button(t('debts.editCustomer'), 'ghost', () => editCustomer(d)));

      type Entry = { at: string; node: Node };
      const entries: Entry[] = [
        ...d.charges.map((c) => ({
          at: c.paidAt,
          node: html`<tr>
            <td>${formatDateTime(c.paidAt)}</td>
            <td>
              ${t('debts.charge', { number: c.orderNumber })}
              <div class="muted small">
                ${c.dueDate ? `${t('payment.dueDate')}: ${formatDate(c.dueDate)}` : ''}
              </div>
            </td>
            <td>
              ${c.settledAt
                ? html`<span class="badge badge-success"
                    >${t('debts.settledAt', { date: formatDate(c.settledAt) })}</span
                  >`
                : c.dueDate && new Date(c.dueDate).getTime() < Date.now()
                  ? html`<span class="badge badge-danger">${t('debts.overdue')}</span>`
                  : html`<span class="badge badge-muted">${t('debts.open')}</span>`}
              ${d.customer === null && admin
                ? button(t('debts.assign'), 'secondary', () => assign(c.paymentId))
                : ''}
            </td>
            <td class="num strong">+${formatMoney(c.amount, l)}</td>
          </tr>`,
        })),
        ...d.repayments.map((r) => ({
          at: r.createdAt,
          node: html`<tr class="${r.voidedAt ? 'is-voided' : ''}">
            <td>${formatDateTime(r.createdAt)}</td>
            <td>
              ${r.kind === 'WRITE_OFF'
                ? t('debts.writeOffEntry')
                : t('debts.repaymentEntry', { method: t(`payment.${r.method}`) })}
              <div class="muted small">
                ${[r.note, r.createdBy].filter(Boolean).join(' · ')}
                ${r.voidedAt
                  ? ` · ${t('debts.voidedBy', { user: r.voidedBy ?? '—', reason: r.voidReason ?? '' })}`
                  : ''}
              </div>
            </td>
            <td>
              ${!r.voidedAt && admin
                ? button(t('debts.void'), 'danger-ghost', () => voidEntry(r.id))
                : ''}
            </td>
            <td class="num strong">−${formatMoney(r.amount, l)}</td>
          </tr>`,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));

      body.replaceChildren(
        html`<div class="debtor-head">
            <div>
              <h3>${d.customer ? who(d.customer) : t('debts.unknown')}</h3>
              <p class="muted">
                ${d.customer
                  ? [formatPhone(d.customer.phone), d.customer.address].filter(Boolean).join(' · ')
                  : t('debts.unknownHint')}
              </p>
            </div>
            <div class="debtor-balance">
              <span class="muted">${t('debts.balance')}</span>
              <strong>${formatMoney(d.balance, l)}</strong>
            </div>
          </div>
          ${actions}
          <div class="table-wrap">
            <table class="lines-table">
              <tbody>
                ${entries.map((e) => e.node)}
              </tbody>
            </table>
          </div>`,
      );
    }

    async function refresh() {
      try {
        draw(await api.debts.get({ customerId }));
      } catch (error) {
        toastError(error);
      }
    }

    try {
      draw(await api.debts.get({ customerId }));
    } catch (error) {
      toastError(error);
      return;
    }
    open = { customerId, refresh };
    const modal = openModal({
      title: t('debts.ledger'),
      body,
      size: 'lg',
    });
    void modal.closed.then(() => {
      open = null;
    });
  }

  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'debts-changed') {
      void load();
      void open?.refresh();
    }
  });
  return {
    el,
    destroy() {
      clearTimeout(typing);
      stop();
    },
  };
};
