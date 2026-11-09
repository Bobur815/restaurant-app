import { dec, isDecimalString, sum, type DecimalString } from '@shared/utils/decimal';
import { formatPhone } from '@shared/utils/phone';
import {
  settleTenders,
  TENDER_METHODS,
  type SplitState,
  type TenderLine,
  type TenderMethod,
} from '@shared/utils/split-payment';
import { api } from '../../api';
import {
  amountHintFor,
  clearErrors,
  field,
  formError,
  refreshAmountHint,
  showFormError,
  value,
} from '../../components/forms';
import { phoneField } from '../../components/phone-field';
import { t } from '../../i18n';
import { appStore, can, licensed } from '../../store/app';
import { html } from '../../ui/html';
import { icon, type IconName } from '../../ui/icons';
import { playClick } from '../../ui/sound';
import { formatMoney, toInputDecimal } from '../../utils/format';
import { createGuestSplit } from './guest-split';

const METHOD_ICON: Record<TenderMethod, IconName> = {
  cash: 'cash',
  card: 'card',
  click: 'click',
  debt: 'debt',
};

export interface DebtCustomerValue {
  phone: string;
  name: string | null;
  dueDate: string | null;
}

/** A typed amount (spaces, comma) -> decimal string; '' -> null; not a number -> 'NaN'. */
function amountOf(raw: string): DecimalString | null {
  const v = raw.replace(/\s/g, '').replace(',', '.');
  if (v === '') return null;
  return isDecimalString(v) && !v.startsWith('-') ? v : 'NaN';
}

/** How the amounts are entered (F14): one method, an amount per method, or a share per guest. */
export type PayMode = 'single' | 'methods' | 'guests';

/**
 * How a check is paid (payment modal and the admin's check edit). One method for the whole
 * total by default (cash with the amount received and the change); "Usullar bo'yicha" gives every
 * method its own amount, with a "qolgan" (remaining) button; "Kishilar bo'yicha" divides it between
 * guests (guest-split.ts). Debt asks who owes it, unless the order already has a customer. The
 * rules are shared/utils/split-payment.ts, the same main uses.
 */
export function createTenderEditor(options: {
  total: DecimalString;
  /** The order's own customer (takeaway/delivery): debt goes on them without asking. */
  orderCustomer: { name: string | null; phone: string | null } | null;
  initial?: { tenders: TenderLine[]; debtCustomer?: DebtCustomerValue | null };
  /** Offer "Kishilar bo'yicha" (the payment window; not the check edit). */
  guests?: boolean;
  onChange: () => void;
  /** The mode changed (the payment window widens for the guests). */
  onMode?: (mode: PayMode) => void;
}) {
  const { settings, language: lang } = appStore.get();
  // Debt needs the setting on, the plan to include it (F5) and the user's own permission.
  const methods = TENDER_METHODS.filter(
    (m) => m !== 'debt' || (settings?.debtEnabled !== false && licensed('debt') && can('debt')),
  );
  const canSplit = settings?.splitPaymentEnabled !== false;

  const initialLines = options.initial?.tenders ?? [];
  let mode: PayMode = initialLines.length > 1 ? 'methods' : 'single';
  const split = () => mode === 'methods';
  let ready = false;
  let single: TenderMethod = initialLines.length === 1 ? initialLines[0]!.method : 'cash';

  const el = document.createElement('div');
  el.className = 'tender-editor';

  // ── single method ──────────────────────────────────────────────────────────────────────────
  const methodButtons = methods.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'method-button';
    b.append(
      icon(METHOD_ICON[m], 28),
      Object.assign(document.createElement('span'), { textContent: t(`payment.${m}`) }),
    );
    b.addEventListener('click', () => {
      playClick();
      single = m;
      render();
    });
    return { m, b };
  });
  const received = field({
    name: 'received',
    label: t('payment.received'),
    inputmode: 'decimal',
    amount: true,
  });
  received.querySelector('input')!.addEventListener('input', () => render());
  const change = document.createElement('output');
  change.className = 'change-amount';
  const cashBox = document.createElement('div');
  cashBox.className = 'cash-box';
  cashBox.append(
    received,
    html`<div class="change"><span>${t('payment.change')}</span>${change}</div>`,
  );
  const singleBox = document.createElement('div');
  singleBox.className = 'single-box';
  singleBox.append(
    html`<fieldset class="method-group">
      <legend>${t('payment.method')}</legend>
      ${methodButtons.map((x) => x.b)}
    </fieldset>`,
    cashBox,
  );

  // ── split ──────────────────────────────────────────────────────────────────────────────────
  const splitRows = methods.map((m) => {
    const input = document.createElement('input');
    input.className = 'input';
    input.inputMode = 'decimal';
    input.name = `split-${m}`;
    input.setAttribute('aria-label', t(`payment.${m}`));
    const rest = document.createElement('button');
    rest.type = 'button';
    rest.className = 'btn btn-ghost';
    rest.textContent = t('payment.rest');
    rest.addEventListener('click', () => {
      // Fill this line with whatever is still to pay (on top of what it already has).
      const others = lines().filter((l) => l.method !== m && l.amount !== 'NaN');
      const left = dec(options.total).minus(sum(others.map((l) => l.amount)));
      input.value = left.gt(0) ? toInputDecimal(left.toFixed()) : '';
      refreshAmountHint(input);
      render();
    });
    input.addEventListener('input', () => render());
    const row = html`<div class="split-row">
      <span class="split-label">${icon(METHOD_ICON[m], 20)}${t(`payment.${m}`)}</span>
      ${input}${rest}${amountHintFor(input)}
    </div>`;
    return { m, input, row };
  });
  const summary = document.createElement('div');
  summary.className = 'split-summary';
  const splitBox = document.createElement('div');
  splitBox.className = 'split-box';
  splitBox.append(...splitRows.map((r) => r.row), summary);

  // ── guests (F14) ───────────────────────────────────────────────────────────────────────────
  const guest =
    options.guests !== false && canSplit
      ? createGuestSplit({
          total: options.total,
          // One debt customer per check: the guest on debt uses the debt box below.
          methods,
          onChange: () => {
            if (ready) render();
          },
        })
      : null;

  // ── mode control ───────────────────────────────────────────────────────────────────────────
  const modes: PayMode[] = guest ? ['single', 'methods', 'guests'] : ['single', 'methods'];
  const MODE_LABEL: Record<PayMode, string> = {
    single: 'payment.modeSingle',
    methods: 'payment.modeMethods',
    guests: 'payment.modeGuests',
  };
  const modeButtons = modes.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pay-mode';
    b.textContent = t(MODE_LABEL[m]);
    b.addEventListener('click', () => {
      playClick();
      setMode(m);
    });
    return { m, b };
  });
  const modeBar = document.createElement('div');
  modeBar.className = 'pay-modes';
  modeBar.setAttribute('role', 'group');
  modeBar.setAttribute('aria-label', t('payment.howToPay'));
  modeBar.hidden = !canSplit;
  modeBar.append(...modeButtons.map((x) => x.b));

  function setMode(next: PayMode) {
    if (next === mode) return;
    if (next === 'methods') {
      // Start the split from what was chosen: that method gets the whole total.
      for (const r of splitRows) r.input.value = '';
      const row = splitRows.find((r) => r.m === single);
      if (row) row.input.value = toInputDecimal(options.total);
      for (const r of splitRows) refreshAmountHint(r.input);
    }
    if (next === 'guests') guest?.start(single);
    mode = next;
    options.onMode?.(mode);
    render();
  }

  // ── debt customer ──────────────────────────────────────────────────────────────────────────
  const debtBox = document.createElement('div');
  debtBox.className = 'debt-box';
  let lookup = 0;
  const known = document.createElement('span');
  known.className = 'badge badge-success customer-known';
  known.hidden = true;
  known.textContent = t('customer.known');
  const phone = phoneField({
    name: 'debtCustomer.phone',
    label: t('customer.phone'),
    value: options.initial?.debtCustomer?.phone,
    onInput: () => {
      known.hidden = true;
      lookup++;
      options.onChange();
    },
    onComplete: async (digits) => {
      const mine = ++lookup;
      const c = await api.customers.findByPhone({ phone: digits }).catch(() => null);
      if (mine !== lookup || !c) return;
      known.hidden = false;
      const name = el.querySelector<HTMLInputElement>('[name="debtCustomer.name"]')!;
      if (c.name && !name.value.trim()) name.value = c.name;
      options.onChange();
    },
  });
  phone.el.querySelector('label')!.append(known);
  const debtFields = html`<div class="customer-grid">
    ${phone.el}
    ${field({
      name: 'debtCustomer.name',
      label: t('customer.name'),
      value: options.initial?.debtCustomer?.name ?? '',
    })}
    ${field({
      name: 'debtCustomer.dueDate',
      label: t('payment.dueDate'),
      type: 'date',
      value: options.initial?.debtCustomer?.dueDate ?? '',
    })}
  </div>`;
  const oc = options.orderCustomer;
  debtBox.append(
    html`<p class="debt-title">${icon('debt', 18)}${t('payment.debtFor')}</p>`,
    oc && (oc.name || oc.phone)
      ? html`<p class="strong">
          ${[oc.name, oc.phone ? formatPhone(oc.phone) : null].filter(Boolean).join(' · ')}
        </p>`
      : debtFields,
  );

  const problem = document.createElement('p');
  problem.className = 'form-error split-problem';
  problem.setAttribute('role', 'alert');

  el.append(
    html`<div class="pay-total">
      <span>${t('payment.toPay')}</span><strong>${formatMoney(options.total, lang)}</strong>
    </div>`,
    modeBar,
    singleBox,
    splitBox,
    ...(guest ? [guest.el] : []),
    debtBox,
    problem,
    formError(),
  );

  // Initial values (check edit).
  if (split()) {
    for (const l of initialLines) {
      const row = splitRows.find((r) => r.m === l.method);
      if (row) row.input.value = toInputDecimal(l.amount);
    }
    for (const r of splitRows) refreshAmountHint(r.input);
  }

  /** The lines as typed now (invalid amounts as 'NaN', so the state reports them). */
  function lines(): TenderLine[] {
    if (mode === 'guests' && guest) return guest.tenders();
    if (split()) {
      return splitRows.flatMap((r) => {
        const a = amountOf(r.input.value);
        return a === null ? [] : [{ method: r.m, amount: a }];
      });
    }
    if (single === 'cash') {
      const a = amountOf(value(el, 'received'));
      // Nothing typed, or less than the total (a typo): the cash line is the total; any extra
      // is change. Less than the total is never assumed to be a partial payment.
      if (a === null || a === 'NaN' || dec(a).lt(options.total))
        return [{ method: 'cash', amount: options.total }];
      return [{ method: 'cash', amount: a }];
    }
    return [{ method: single, amount: options.total }];
  }

  const badAmount = () => lines().some((l) => l.amount === 'NaN');

  function state(): SplitState {
    const valid = lines().filter((l) => l.amount !== 'NaN');
    return settleTenders(options.total, valid);
  }

  const hasDebt = () => state().applied.some((l) => l.method === 'debt');

  function render() {
    for (const { m, b } of methodButtons)
      b.setAttribute('aria-pressed', String(mode === 'single' && m === single));
    for (const { m, b } of modeButtons) b.setAttribute('aria-pressed', String(m === mode));
    singleBox.hidden = mode !== 'single';
    cashBox.hidden = mode !== 'single' || single !== 'cash';
    splitBox.hidden = mode !== 'methods';
    if (guest) guest.el.hidden = mode !== 'guests';

    const s = state();
    change.textContent = dec(s.change).gt(0) ? formatMoney(s.change, lang) : '—';
    summary.replaceChildren(
      html`<span>${t('payment.entered')}: <strong>${formatMoney(s.entered, lang)}</strong></span>
        <span class="${dec(s.remaining).gt(0) ? 'text-danger' : ''}"
          >${t('payment.remaining')}: <strong>${formatMoney(s.remaining, lang)}</strong></span
        >
        <span>${t('payment.change')}: <strong>${formatMoney(s.change, lang)}</strong></span>`,
    );
    problem.textContent =
      mode === 'guests' && guest
        ? guest.problem()
        : badAmount()
          ? t('payment.badAmount')
          : split() && s.problem !== 'none'
            ? t(`payment.problem_${s.problem}`)
            : '';
    debtBox.hidden = !hasDebt();
    options.onChange();
  }

  ready = true;
  render();

  return {
    el,
    state,
    mode: () => mode,
    /** Guests mode: how many, and the change handed back to them altogether. */
    guests: () =>
      mode === 'guests' && guest ? { count: guest.count(), change: guest.totalChange() } : null,
    /** Ready to send: amounts valid, lines cover the total, debt has its customer details. */
    canSubmit(): boolean {
      if (mode === 'guests' && guest && guest.problem() !== '') return false;
      if (badAmount() || state().problem !== 'none') return false;
      if (hasDebt() && !(oc && (oc.name || oc.phone))) return phone.digits().length === 9;
      return true;
    },
    /** What to send to main. */
    result(): { tenders: TenderLine[]; debtCustomer?: DebtCustomerValue } {
      const tenders = lines().filter((l) => l.amount !== 'NaN' && dec(l.amount).gt(0));
      if (!hasDebt() || (oc && (oc.name || oc.phone))) return { tenders };
      const name = value(el, 'debtCustomer.name');
      const due = value(el, 'debtCustomer.dueDate');
      return {
        tenders,
        debtCustomer: { phone: phone.digits(), name: name || null, dueDate: due || null },
      };
    },
    showError(error: unknown) {
      showFormError(el, error);
    },
    clearErrors: () => clearErrors(el),
  };
}
