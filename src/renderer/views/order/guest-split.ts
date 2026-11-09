import { dec, isDecimalString, sum, type DecimalString } from '@shared/utils/decimal';
import {
  equalShares,
  guestChange,
  guestTenders,
  MAX_GUESTS,
  MIN_GUESTS,
  rebalance,
  type GuestShare,
  type RebalanceProblem,
} from '@shared/utils/guest-split';
import type { TenderLine, TenderMethod } from '@shared/utils/split-payment';
import { amountHintFor, refreshAmountHint } from '../../components/forms';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon, type IconName } from '../../ui/icons';
import { playClick } from '../../ui/sound';
import { formatMoney, toInputDecimal } from '../../utils/format';

const METHOD_ICON: Record<TenderMethod, IconName> = {
  cash: 'cash',
  card: 'card',
  click: 'click',
  debt: 'debt',
};

/** A typed amount (spaces, comma) -> decimal string; '' -> null; not a number -> 'NaN'. */
function amountOf(raw: string): DecimalString | null {
  const v = raw.replace(/\s/g, '').replace(',', '.');
  if (v === '') return null;
  return isDecimalString(v) && !v.startsWith('-') ? v : 'NaN';
}

interface Card {
  el: HTMLElement;
  title: HTMLElement;
  shareInput: HTMLInputElement;
  fixedBadge: HTMLElement;
  chips: Map<TenderMethod, HTMLButtonElement>;
  cashRow: HTMLElement;
  gaveInput: HTMLInputElement;
  change: HTMLElement;
}

/**
 * Feature F14, "Kishilar bo'yicha": the check divided between guests (equal shares, each one can
 * be typed over and the rest is divided again), each guest with their own method and, for cash,
 * what they gave and their change. On confirm the shares go to main as ordinary split tenders
 * (shared/utils/guest-split.ts). At most one guest pays on debt (one debt customer per check).
 */
export function createGuestSplit(options: {
  total: DecimalString;
  methods: readonly TenderMethod[];
  onChange: () => void;
}) {
  const lang = () => appStore.get().language;
  let guests: GuestShare[] = [];
  const gave: string[] = [];
  let problem: RebalanceProblem = 'none';

  const el = document.createElement('div');
  el.className = 'guest-split';

  // ── guest count ────────────────────────────────────────────────────────────────────────────
  const count = document.createElement('output');
  count.className = 'guest-count';
  const stepButton = (name: 'minus' | 'plus', label: string, delta: number) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button stepper-button';
    b.setAttribute('aria-label', label);
    b.append(icon(name, 20));
    b.addEventListener('click', () => {
      playClick();
      setCount(guests.length + delta);
    });
    return b;
  };
  const minus = stepButton('minus', t('payment.fewerGuests'), -1);
  const plus = stepButton('plus', t('payment.moreGuests'), 1);
  const equal = document.createElement('button');
  equal.type = 'button';
  equal.className = 'btn btn-ghost';
  equal.textContent = t('payment.resetShares');
  equal.addEventListener('click', () => {
    playClick();
    divideEqually();
  });
  const stepper = html`<div class="guest-toolbar">
    <span class="guest-toolbar-label">${t('payment.guests')}</span>
    <div class="stepper" role="group" aria-label="${t('payment.guests')}">
      ${minus}${count}${plus}
    </div>
    ${equal}
  </div>`;

  const grid = document.createElement('div');
  grid.className = 'guest-grid';
  const footer = document.createElement('div');
  footer.className = 'guest-footer';
  el.append(stepper, grid, footer);

  let cards: Card[] = [];

  function card(index: number): Card {
    const title = document.createElement('span');
    title.className = 'guest-title';
    const fixedBadge = document.createElement('span');
    fixedBadge.className = 'badge badge-muted guest-fixed';
    fixedBadge.textContent = t('payment.fixedShare');

    const shareInput = document.createElement('input');
    shareInput.className = 'input guest-share-input';
    shareInput.inputMode = 'decimal';
    shareInput.name = `guest-${index}-share`;
    shareInput.setAttribute(
      'aria-label',
      `${t('payment.guest', { n: index + 1 })}: ${t('payment.share')}`,
    );
    shareInput.addEventListener('focus', () => shareInput.select());
    shareInput.addEventListener('input', () => {
      const a = amountOf(shareInput.value);
      // Typing a share fixes it; the others are divided again. Cleared: back to an equal share.
      guests[index] = {
        ...guests[index]!,
        share: a === null || a === 'NaN' ? '0' : a,
        fixed: a !== null,
      };
      if (a === 'NaN') problem = 'over';
      apply(index);
    });

    const chips = new Map<TenderMethod, HTMLButtonElement>();
    const chipRow = document.createElement('div');
    chipRow.className = 'guest-methods';
    chipRow.setAttribute('role', 'group');
    chipRow.setAttribute('aria-label', t('payment.method'));
    for (const m of options.methods) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-button guest-method';
      b.append(icon(METHOD_ICON[m], 16), document.createTextNode(t(`payment.${m}`)));
      b.addEventListener('click', () => {
        playClick();
        guests[index] = { ...guests[index]!, method: m };
        render();
      });
      chips.set(m, b);
      chipRow.append(b);
    }

    const gaveInput = document.createElement('input');
    gaveInput.className = 'input';
    gaveInput.inputMode = 'decimal';
    gaveInput.name = `guest-${index}-gave`;
    gaveInput.setAttribute(
      'aria-label',
      `${t('payment.guest', { n: index + 1 })}: ${t('payment.gave')}`,
    );
    gaveInput.value = gave[index] ?? '';
    gaveInput.addEventListener('input', () => {
      gave[index] = gaveInput.value;
      render();
    });
    const change = document.createElement('output');
    change.className = 'guest-change';
    const cashRow = html`<div class="guest-cash">
      <label class="guest-cash-field"
        ><span>${t('payment.gave')}</span>${gaveInput}${amountHintFor(gaveInput)}</label
      >
      <div class="guest-cash-change"><span>${t('payment.change')}</span>${change}</div>
    </div>`.firstElementChild as HTMLElement;

    const el = html`<section class="guest-card">
      <header class="guest-card-head">${title}${fixedBadge}</header>
      <label class="guest-share">
        <span>${t('payment.share')}</span>
        ${shareInput}${amountHintFor(shareInput)}
      </label>
      ${chipRow} ${cashRow}
    </section>`.firstElementChild as HTMLElement;
    return { el, title, shareInput, fixedBadge, chips, cashRow, gaveInput, change };
  }

  function setCount(n: number) {
    const next = Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, n));
    // A new count starts again from equal shares; each guest keeps the method they chose.
    const methods = guests.map((g) => g.method);
    const shares = equalShares(options.total, next);
    guests = shares.map((share, i) => ({ share, fixed: false, method: methods[i] ?? 'cash' }));
    gave.length = next;
    problem = 'none';
    cards = guests.map((_, i) => card(i));
    grid.replaceChildren(...cards.map((c) => c.el));
    for (const c of cards) c.shareInput.value = '';
    apply(-1);
  }

  function divideEqually() {
    guests = guests.map((g) => ({ ...g, fixed: false }));
    for (const c of cards) c.shareInput.value = '';
    apply(-1);
  }

  /** Divides again around the fixed shares; `editing` is the input being typed in (left alone). */
  function apply(editing: number) {
    const typedBad = cards.some((c) => amountOf(c.shareInput.value) === 'NaN');
    const r = rebalance(options.total, guests);
    guests = r.guests;
    problem = typedBad ? 'over' : r.problem;
    cards.forEach((c, i) => {
      if (i === editing) return;
      // Fixed shares show what was typed; the others show their computed share.
      if (!guests[i]!.fixed) {
        c.shareInput.value = toInputDecimal(guests[i]!.share);
        refreshAmountHint(c.shareInput);
      }
    });
    render();
  }

  const debtGuest = () => guests.findIndex((g) => g.method === 'debt');

  function render() {
    const l = lang();
    count.textContent = String(guests.length);
    minus.disabled = guests.length <= MIN_GUESTS;
    plus.disabled = guests.length >= MAX_GUESTS;
    equal.disabled = !guests.some((g) => g.fixed);
    const onDebt = debtGuest();
    cards.forEach((c, i) => {
      const g = guests[i]!;
      c.title.textContent = t('payment.guest', { n: i + 1 });
      c.fixedBadge.hidden = !g.fixed;
      c.el.classList.toggle('is-fixed', g.fixed);
      for (const [m, b] of c.chips) {
        b.setAttribute('aria-pressed', String(m === g.method));
        // One debt customer per check: only one guest can pay on debt.
        b.disabled = m === 'debt' && onDebt !== -1 && onDebt !== i;
      }
      c.cashRow.hidden = g.method !== 'cash';
      const gaveAmount = amountOf(c.gaveInput.value);
      const short =
        g.method === 'cash' &&
        gaveAmount !== null &&
        (gaveAmount === 'NaN' || dec(gaveAmount).lt(g.share));
      c.gaveInput.setAttribute('aria-invalid', String(short));
      const ch =
        gaveAmount === null || gaveAmount === 'NaN' ? '0' : guestChange(g.share, gaveAmount);
      c.change.textContent = dec(ch).gt(0) ? formatMoney(ch, l) : '—';
    });

    const byMethod = guestTenders(guests);
    const entered = sum(guests.map((g) => g.share));
    const left = dec(options.total).minus(entered);
    footer.replaceChildren(
      html`<span class="guest-footer-methods"
          >${byMethod.length
            ? byMethod
                .map((x) => `${t(`payment.${x.method}`)} ${formatMoney(x.amount, l)}`)
                .join(' · ')
            : '—'}</span
        >
        <span class="${left.eq(0) ? '' : 'text-danger'}"
          >${left.lt(0) ? t('payment.sharesOverBy') : t('payment.remaining')}:
          <strong>${formatMoney(left.abs().toFixed(), l)}</strong></span
        >`,
    );
    options.onChange();
  }

  /** Why the guests cannot pay yet, as a message key, or null. */
  /** The first guest paying cash who gave less than their share (or not a number), or -1. */
  const shortGuest = () =>
    guests.findIndex((g, i) => {
      if (g.method !== 'cash') return false;
      const a = amountOf(cards[i]!.gaveInput.value);
      return a !== null && (a === 'NaN' || dec(a).lt(g.share));
    });

  function blocker(): string | null {
    if (cards.some((c) => amountOf(c.shareInput.value) === 'NaN')) return 'payment.badAmount';
    if (problem === 'over') return 'payment.sharesOver';
    if (problem === 'short' || !sum(guests.map((g) => g.share)).eq(options.total))
      return 'payment.sharesLeft';
    if (shortGuest() !== -1) return 'payment.gaveLess';
    return null;
  }

  setCount(MIN_GUESTS);

  return {
    el,
    count: () => guests.length,
    /** The guests' shares as split tenders (what main stores). */
    tenders: (): TenderLine[] => guestTenders(guests),
    /** The message for what blocks paying, or '' when the guests can pay. */
    problem(): string {
      const key = blocker();
      if (key !== 'payment.gaveLess') return key ? t(key) : '';
      return t('payment.gaveLess', { n: shortGuest() + 1 });
    },
    /** Change handed back to each guest paying cash, added up (for the done message). */
    totalChange(): DecimalString {
      return sum(
        guests.map((g, i) => {
          const a = amountOf(cards[i]!.gaveInput.value);
          return g.method === 'cash' && a !== null && a !== 'NaN' ? guestChange(g.share, a) : '0';
        }),
      ).toFixed();
    },
    /** Starts again from the method chosen in the single view, for every guest. */
    start(method: TenderMethod) {
      guests = guests.map((g) => ({ ...g, method: method === 'debt' ? 'cash' : method }));
      divideEqually();
    },
  };
}
