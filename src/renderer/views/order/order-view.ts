import type { CategoryDto, MenuItemDto, OrderDto, StockShortage } from '@shared/types';
import { dec } from '@shared/utils/decimal';
import { PORTION_FACTORS, type PortionFactor } from '@shared/utils/order-line';
import { api, isApiError } from '../../api';
import { confirmDialog } from '../../components/modal';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html, refs } from '../../ui/html';
import { icon } from '../../ui/icons';
import { playClick } from '../../ui/sound';
import { formatMoney, formatQty, localName } from '../../utils/format';
import type { View } from '../types';
import {
  addDish,
  available,
  draftTotal,
  draftUsage,
  fromOrder,
  priced,
  removeLine,
  sameAsSaved,
  savedUsage,
  setPortion,
  setQuantity,
  setWeight,
  toSaveInput,
  type DraftLine,
} from './draft';
import { payOrderModal } from './payment-modal';
import { printReceipt } from './print-receipt';
import { askWeight } from './weight-modal';

const PORTION_LABEL: Record<PortionFactor, string> = {
  '1': 'order.portionFull',
  '0.7': 'order.portion07',
  '0.5': 'order.portionHalf',
};

const imageUrl = (file: string | null) =>
  file ? `savdochef-img://img/${encodeURIComponent(file)}` : null;

function thumb(file: string | null, className: string): HTMLElement {
  const box = document.createElement('div');
  box.className = className;
  const url = imageUrl(file);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(icon('noImage', 22)));
    box.append(img);
  } else {
    box.append(icon('noImage', 22));
  }
  return box;
}

/** One table's order: lines on the left, the menu on the right (legacy buyurtma screen). */
export const orderView: View = ({ params, navigate }) => {
  const tableNumber = Number(params['table']);
  const lang = () => appStore.get().language;

  let menu: MenuItemDto[] = [];
  let categories: CategoryDto[] = [];
  let order: OrderDto | null = null;
  let lines: DraftLine[] = [];
  let categoryId: number | null = null;
  let search = '';
  let saving = false;
  let stale = false;
  let invalidLine: number | null = null;

  const el = document.createElement('section');
  el.className = 'page order-page';
  el.append(
    html`<div class="order-panel">
        <header class="order-header">
          <a class="btn btn-ghost" href="#/tables"
            >${icon('back', 18)}<span>${t('app.back')}</span></a
          >
          <div class="order-title">
            <h1>${t('order.title', { n: tableNumber })}</h1>
            <span class="muted" data-ref="number"></span>
          </div>
        </header>
        <div data-ref="notice"></div>
        <div class="order-lines" data-ref="lines"></div>
        <footer class="order-footer">
          <div class="order-total">
            <span>${t('order.total')}</span><strong data-ref="total"></strong>
          </div>
          <div class="order-actions" data-ref="actions"></div>
        </footer>
      </div>
      <aside class="menu-panel" aria-label="${t('nav.menu')}">
        <div class="menu-search">
          ${icon('search', 18)}<input
            type="search"
            data-ref="search"
            placeholder="${t('order.searchPlaceholder')}"
            aria-label="${t('app.search')}"
          />
        </div>
        <div class="chips" data-ref="chips" role="tablist"></div>
        <div class="dish-grid" data-ref="dishes"></div>
      </aside>`,
  );
  const r = refs<{
    number: HTMLElement;
    notice: HTMLElement;
    lines: HTMLElement;
    total: HTMLElement;
    actions: HTMLElement;
    search: HTMLInputElement;
    chips: HTMLElement;
    dishes: HTMLElement;
  }>(el);

  const saveButton = button(t('order.save'), 'primary');
  const payButton = button(t('order.pay'), 'success');
  const cancelButton = button(t('order.cancelOrder'), 'danger-ghost');
  r.actions.append(cancelButton, payButton, saveButton);

  function button(label: string, kind: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-${kind} btn-lg`;
    b.textContent = label;
    return b;
  }

  const dirty = () => !sameAsSaved(lines, order);

  // ── rendering ──────────────────────────────────────────────────────────────────────────────

  function renderHeader() {
    r.number.textContent = order
      ? t('order.orderNumber', { number: order.orderNumber })
      : t('order.newOrder');
    r.notice.replaceChildren();
    if (stale) {
      const reload = button(t('order.reload'), 'primary');
      reload.addEventListener('click', () => void load());
      r.notice.className = 'notice notice-warning';
      r.notice.append(
        html`${icon('warning')}
          <div>
            <strong>${t('order.staleTitle')}</strong>
            <p>${t('order.staleBody')}</p>
          </div>
          ${reload}`,
      );
    } else if (appStore.get().openSession === null) {
      r.notice.className = 'notice notice-warning';
      r.notice.append(html`${icon('warning')}<span>${t('tables.noShift')}</span>`);
    } else {
      r.notice.className = '';
    }
  }

  function renderLines() {
    const l = lang();
    if (lines.length === 0) {
      r.lines.replaceChildren(
        html`<div class="empty-state small">
          ${icon('menu', 32)}
          <p>${t('order.empty')}</p>
        </div>`,
      );
    } else {
      const rows = lines.map((line, index) => lineRow(line, index, l));
      r.lines.replaceChildren(
        html`<table class="lines-table">
          <thead>
            <tr>
              <th></th>
              <th>${t('order.dish')}</th>
              <th class="num">${t('order.price')}</th>
              <th class="num">${t('order.qty')}</th>
              <th class="num">${t('order.total')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>`,
      );
    }
    r.total.textContent = formatMoney(draftTotal(lines), l);
    const unsaved = dirty();
    saveButton.disabled =
      saving || lines.length === 0 || !unsaved || stale || appStore.get().openSession === null;
    payButton.disabled = saving || !order || unsaved || stale;
    cancelButton.disabled = saving || !order || stale;
    payButton.title = order && unsaved ? t('order.unsaved') : '';
    renderDishes();
  }

  function lineRow(line: DraftLine, index: number, l: 'uz' | 'ru'): HTMLTableRowElement {
    const p = priced(line);
    const tr = document.createElement('tr');
    if (invalidLine === index) tr.className = 'is-invalid';

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = '999';
    qty.inputMode = 'numeric';
    qty.value = String(line.quantity);
    qty.className = 'qty-input';
    qty.setAttribute('aria-label', `${t('order.qty')}: ${localName(line, l)}`);
    qty.addEventListener('change', () => update(setQuantity(lines, line.key, Number(qty.value))));
    qty.addEventListener('focus', () => qty.select());

    const minus = iconButton('minus', t('order.decrease'), () =>
      line.quantity > 1 ? update(setQuantity(lines, line.key, line.quantity - 1)) : undefined,
    );
    minus.disabled = line.quantity <= 1;
    const plus = iconButton('plus', t('order.increase'), () =>
      update(setQuantity(lines, line.key, line.quantity + 1)),
    );
    const remove = iconButton('trash', t('order.remove'), () =>
      update(removeLine(lines, line.key)),
    );
    remove.classList.add('danger');

    let variant: Node = document.createTextNode('');
    if (line.hasPortions) {
      const select = document.createElement('select');
      select.className = 'portion-select';
      select.setAttribute('aria-label', t('order.portion'));
      for (const f of PORTION_FACTORS) {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = t(PORTION_LABEL[f]);
        o.selected = line.portion === f;
        select.append(o);
      }
      select.addEventListener('change', () =>
        update(setPortion(lines, line.key, select.value as PortionFactor)),
      );
      variant = select;
    } else if (line.soldByWeight) {
      const w = document.createElement('button');
      w.type = 'button';
      w.className = 'chip-button';
      w.textContent = formatQty(line.weightKg ?? '0', l, true);
      w.setAttribute('aria-label', `${t('order.weight')}: ${w.textContent}`);
      w.addEventListener('click', async () => {
        const kg = await askWeight(line, line.weightKg);
        if (kg) update(setWeight(lines, line.key, kg));
      });
      variant = w;
    }

    tr.append(
      html`<td class="thumb-cell">${thumb(line.imageFile, 'thumb')}</td>
        <td>
          <div class="line-name">${localName(line, l)}</div>
          <div class="line-variant">${variant}</div>
        </td>
        <td class="num">${formatMoney(p.unitPrice.toFixed(), l, false)}</td>
        <td class="num"><div class="stepper">${minus}${qty}${plus}</div></td>
        <td class="num strong">${formatMoney(p.totalPrice.toFixed(), l, false)}</td>
        <td>${remove}</td>`,
    );
    return tr;
  }

  function iconButton(name: Parameters<typeof icon>[0], label: string, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.append(icon(name, 18));
    b.addEventListener('click', onClick);
    return b;
  }

  function visibleDishes(): MenuItemDto[] {
    const needle = search.toLocaleLowerCase();
    return menu.filter(
      (m) =>
        (categoryId === null || m.categoryId === categoryId) &&
        (!needle ||
          m.nameUz.toLocaleLowerCase().includes(needle) ||
          (m.nameRu ?? '').toLocaleLowerCase().includes(needle)),
    );
  }

  function availabilityOf(dish: MenuItemDto) {
    return available(
      dish.id,
      appStore.get().openSession ?? null,
      savedUsage(order),
      draftUsage(lines),
    );
  }

  function renderChips() {
    const l = lang();
    const chip = (label: string, id: number | null) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(categoryId === id));
      b.textContent = label;
      b.addEventListener('click', () => {
        categoryId = id;
        renderChips();
        renderDishes();
      });
      return b;
    };
    r.chips.replaceChildren(
      chip(t('order.allCategories'), null),
      ...categories.map((c) => chip(localName(c, l), c.id)),
    );
  }

  function renderDishes() {
    const l = lang();
    const dishes = visibleDishes();
    if (dishes.length === 0) {
      r.dishes.replaceChildren(html`<p class="muted empty-inline">${t('order.noDishes')}</p>`);
      return;
    }
    r.dishes.replaceChildren(
      ...dishes.map((dish) => {
        const left = availabilityOf(dish);
        const out = left === null || dec(left).lte(0);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `dish-card${out ? ' is-out' : ''}`;
        b.disabled = out || appStore.get().openSession === null || stale;
        const badge =
          left === null
            ? t('order.notInSession')
            : dec(left).lte(0)
              ? t('order.outOfStock')
              : t('order.left', { qty: formatQty(left, l, dish.soldByWeight) });
        b.append(
          html`${thumb(dish.imageFile, 'dish-image')}
            <span class="dish-name">${localName(dish, l)}</span>
            <span class="dish-price"
              >${formatMoney(dish.price, l)}${dish.soldByWeight ? ` ${t('order.perKg')}` : ''}</span
            >
            <span class="dish-stock ${out ? 'badge badge-muted' : 'badge badge-success'}"
              >${badge}</span
            >`,
        );
        b.addEventListener('click', () => void addToOrder(dish));
        return b;
      }),
    );
  }

  function update(next: DraftLine[]) {
    lines = next;
    invalidLine = null;
    renderLines();
  }

  async function addToOrder(dish: MenuItemDto) {
    playClick();
    if (dish.soldByWeight) {
      const kg = await askWeight(dish);
      if (kg) update(addDish(lines, dish, kg));
    } else {
      update(addDish(lines, dish));
    }
  }

  // ── actions ────────────────────────────────────────────────────────────────────────────────

  function shortageText(shortages: StockShortage[]): string {
    const l = lang();
    return shortages
      .map(
        (s) =>
          `${s.nameUz} (${s.reason === 'NOT_IN_SESSION' ? t('order.notInShift') : t('order.left', { qty: formatQty(s.remaining, l) })})`,
      )
      .join(', ');
  }

  async function save(): Promise<boolean> {
    if (saving) return false;
    saving = true;
    renderLines();
    try {
      order = await api.orders.save(toSaveInput(tableNumber, lines, order?.version));
      lines = fromOrder(order, menu);
      toast(t('order.saved'), 'success');
      return true;
    } catch (error) {
      const details = isApiError(error)
        ? (error.details as Record<string, unknown> | undefined)
        : undefined;
      if (isApiError(error, 'CONFLICT') && details?.['reason'] === 'STALE') {
        stale = true;
        renderHeader();
      } else if (isApiError(error, 'CONFLICT') && Array.isArray(details?.['shortages'])) {
        toast(
          t('order.shortage', { list: shortageText(details['shortages'] as StockShortage[]) }),
          'error',
        );
      } else {
        if (isApiError(error, 'VALIDATION') && typeof details?.['lineIndex'] === 'number') {
          invalidLine = details['lineIndex'] as number;
        }
        toastError(error);
      }
      return false;
    } finally {
      saving = false;
      renderLines();
    }
  }

  saveButton.addEventListener('click', () => {
    playClick();
    void save();
  });

  payButton.addEventListener('click', async () => {
    playClick();
    if (!order) return;
    const paid = await payOrderModal(order);
    if (paid) {
      // Legacy printed after every payment; in the background, so a printer problem never
      // holds up the next customer.
      if (appStore.get().settings?.printAfterPayment !== false) printReceipt(paid.id);
      order = null;
      lines = [];
      navigate('/tables');
    }
  });

  cancelButton.addEventListener('click', async () => {
    if (!order) return;
    const ok = await confirmDialog({
      title: t('order.cancelOrder'),
      message: t('order.cancelConfirm', { n: tableNumber }),
      danger: true,
      confirmLabel: t('order.cancelOrder'),
    });
    if (!ok) return;
    try {
      await api.orders.cancel({ tableNumber, expectedVersion: order.version });
      toast(t('order.cancelled'), 'success');
      order = null;
      lines = [];
      navigate('/tables');
    } catch (error) {
      toastError(error);
    }
  });

  r.search.addEventListener('input', () => {
    search = r.search.value.trim();
    renderDishes();
  });
  r.search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = visibleDishes().find((d) => {
      const left = availabilityOf(d);
      return left !== null && dec(left).gt(0);
    });
    if (first) void addToOrder(first);
  });

  // ── loading & live updates ─────────────────────────────────────────────────────────────────

  async function load() {
    try {
      const [m, c, o, s] = await Promise.all([
        api.menu.list({}),
        api.categories.list({}),
        api.orders.getTable({ tableNumber }),
        api.sessions.getOpen(),
      ]);
      menu = m;
      categories = c;
      order = o;
      lines = o ? fromOrder(o, m) : [];
      stale = false;
      appStore.set({ openSession: s });
      renderHeader();
      renderChips();
      renderLines();
    } catch (error) {
      toastError(error);
    }
  }

  renderHeader();
  renderLines();
  void load().then(() => r.search.focus());

  const stopEvents = api.events.subscribe(async (e) => {
    if (
      e.type === 'orders-changed' &&
      (e.tableNumber === undefined || e.tableNumber === tableNumber) &&
      !saving
    ) {
      // Our own save also announces; only a different version means someone else changed it.
      const fresh = await api.orders.getTable({ tableNumber }).catch(() => undefined);
      if (fresh === undefined) return;
      if (
        (fresh?.version ?? null) !== (order?.version ?? null) ||
        (fresh?.id ?? null) !== (order?.id ?? null)
      ) {
        if (dirty()) {
          stale = true;
          renderHeader();
          renderLines();
        } else {
          void load();
        }
      }
    }
    if (e.type === 'menu-changed') {
      menu = await api.menu.list({}).catch(() => menu);
      renderDishes();
    }
  });
  const stopStore = appStore.subscribe((s, prev) => {
    if (s.openSession !== prev.openSession) {
      renderHeader();
      renderLines();
    }
  });

  return {
    el,
    destroy() {
      stopEvents();
      stopStore();
    },
    async canLeave() {
      if (!dirty() || lines.length === 0) return true;
      return confirmDialog({
        title: t('order.unsaved'),
        message: t('order.leaveConfirm'),
        danger: true,
      });
    },
  };
};
