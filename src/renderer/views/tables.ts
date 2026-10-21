import type { DiningTableDto, HallDto, OpenOrderSummaryDto, TableSummaryDto } from '@shared/types';
import { formatPhone } from '@shared/utils/phone';
import { api } from '../api';
import { toastError } from '../components/toast';
import { t } from '../i18n';
import { appStore, licensed } from '../store/app';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import { playClick } from '../ui/sound';
import { formatMoney, formatTime } from '../utils/format';
import type { View } from './types';

const ALL = 'all';
/** Per device: the hall this till shows (a till usually serves one room). */
const HALL_KEY = 'savdochef.tables.hall';

function savedHall(): string {
  try {
    return localStorage.getItem(HALL_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}

function saveHall(id: string): void {
  try {
    localStorage.setItem(HALL_KEY, id);
  } catch {
    // storage unavailable: the choice just is not remembered
  }
}

/**
 * The table grid (legacy "Buyurtma" start screen): free and busy tables at a glance, by hall.
 * "Hammasi" shows every hall under its own heading. A busy order on a number that is no longer an
 * active table (hidden or legacy) still shows, under "Boshqa stollar", so it can be paid.
 */
export const tablesView: View = ({ navigate }) => {
  const el = document.createElement('section');
  el.className = 'page tables-page';

  const banner = document.createElement('div');
  const tabs = document.createElement('div');
  tabs.className = 'chips hall-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('tables.hallsLabel'));
  const content = document.createElement('div');
  // Takeaway and delivery (feature F1-B): start buttons in the header, open ones in a strip.
  const actions = document.createElement('div');
  actions.className = 'page-actions';
  const openStrip = document.createElement('section');
  openStrip.className = 'open-orders';
  openStrip.setAttribute('aria-label', t('tables.openOrders'));
  el.append(
    html`<header class="page-header">
      <h1>${t('tables.title')}</h1>
      ${actions}
    </header>`,
    banner,
    openStrip,
    tabs,
    content,
  );

  let busy: TableSummaryDto[] = [];
  let openOrders: OpenOrderSummaryDto[] = [];
  let halls: HallDto[] = [];
  let selected = savedHall();

  const card = (n: number, table: DiningTableDto | null, order: TableSummaryDto | undefined) => {
    const { openSession, language } = appStore.get();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `table-card ${order ? 'is-busy' : 'is-free'}`;
    b.disabled = !order && openSession === null;
    const label = table?.label ? html`<span class="table-label">${table.label}</span>` : '';
    b.append(
      order
        ? html`<span class="table-number">${n}</span>${label}
            <span class="table-status">${t('tables.busy')} · ${formatTime(order.updatedAt)}</span>
            <span class="table-total">${formatMoney(order.totalAmount, language)}</span>
            <span class="table-meta"
              >№ ${order.orderNumber} · ${t('tables.lines', { count: order.lineCount })}</span
            >`
        : html`<span class="table-number">${n}</span>${label}
            <span class="table-status">${t('tables.free')}</span>`,
    );
    b.setAttribute(
      'aria-label',
      `${t('tables.table', { n })}${table?.label ? ` (${table.label})` : ''}: ${order ? t('tables.busy') : t('tables.free')}`,
    );
    b.addEventListener('click', () => {
      playClick();
      navigate(`/tables/${n}`);
    });
    return b;
  };

  const grid = (tables: DiningTableDto[], byTable: Map<number, TableSummaryDto>) => {
    const g = document.createElement('div');
    g.className = 'table-grid';
    g.append(...tables.map((x) => card(x.number, x, byTable.get(x.number))));
    return g;
  };

  const renderTabs = (byTable: Map<number, TableSummaryDto>) => {
    tabs.hidden = halls.length < 2;
    const tab = (id: string, label: string, busyCount: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(selected === id));
      b.textContent = busyCount > 0 ? `${label} · ${busyCount}` : label;
      b.addEventListener('click', () => {
        playClick();
        selected = id;
        saveHall(id);
        render();
      });
      return b;
    };
    tabs.replaceChildren(
      tab(ALL, t('tables.all'), busy.length),
      ...halls.map((h) =>
        tab(String(h.id), h.name, h.tables.filter((x) => byTable.has(x.number)).length),
      ),
    );
  };

  const renderActions = () => {
    const { openSession, settings } = appStore.get();
    const start = (type: 'takeaway' | 'delivery', enabled: boolean | undefined) => {
      // Off in settings, or not in the restaurant's plan (F5).
      if (enabled === false || !licensed(type)) return [];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary btn-lg';
      b.disabled = openSession === null;
      b.append(
        icon(type, 20),
        document.createTextNode(t(`orderType.${type === 'takeaway' ? 'TAKEAWAY' : 'DELIVERY'}`)),
      );
      b.addEventListener('click', () => {
        playClick();
        navigate(`/orders/new/${type}`);
      });
      return [b];
    };
    actions.replaceChildren(
      ...start('takeaway', settings?.takeawayEnabled),
      ...start('delivery', settings?.deliveryEnabled),
    );
  };

  const renderOpenOrders = () => {
    const { language } = appStore.get();
    openStrip.hidden = openOrders.length === 0;
    openStrip.replaceChildren(
      html`<h2 class="hall-heading">${t('tables.openOrders')}</h2>`,
      ...openOrders.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `open-order-card is-${o.orderType.toLowerCase()}`;
        const who = o.customerName ?? (o.customerPhone ? formatPhone(o.customerPhone) : null);
        b.append(
          html`<span class="open-order-head"
              >${icon(o.orderType === 'DELIVERY' ? 'delivery' : 'takeaway', 18)}
              <span>${t(`orderType.${o.orderType}`)}</span>
              <span class="muted">${formatTime(o.createdAt)}</span></span
            >
            <span class="open-order-who">${who ?? t('tables.noCustomer')}</span>
            ${o.orderType === 'DELIVERY' && o.deliveryAddress
              ? html`<span class="open-order-address">${o.deliveryAddress}</span>`
              : ''}
            <span class="open-order-foot">
              <strong>${formatMoney(o.totalAmount, language)}</strong>
              ${o.deliveryStatus
                ? html`<span
                    class="badge badge-${o.deliveryStatus === 'ON_THE_WAY' ? 'info' : 'muted'}"
                    >${t(`delivery.${o.deliveryStatus}`)}</span
                  >`
                : ''}
              <span class="muted">№ ${o.orderNumber}</span>
            </span>`,
        );
        b.addEventListener('click', () => {
          playClick();
          navigate(`/orders/${o.orderId}`);
        });
        return b;
      }),
    );
  };

  const render = () => {
    renderActions();
    renderOpenOrders();
    const { openSession } = appStore.get();
    banner.replaceChildren();
    if (openSession === null) {
      const go = document.createElement('a');
      go.href = '#/sessions';
      go.className = 'btn btn-primary';
      go.textContent = t('tables.openShift');
      banner.className = 'notice notice-warning';
      banner.append(html`${icon('warning')}<span>${t('tables.noShift')}</span>${go}`);
    } else {
      banner.className = '';
    }

    const byTable = new Map(busy.map((b) => [b.tableNumber, b]));
    // With one hall there are no tabs, so nothing could switch back: always show everything.
    // A remembered hall that was hidden or deleted falls back to all halls too.
    if (halls.length < 2 || !halls.some((h) => String(h.id) === selected)) selected = ALL;
    renderTabs(byTable);

    const known = new Set(halls.flatMap((h) => h.tables.map((x) => x.number)));
    const orphans = busy.filter((b) => !known.has(b.tableNumber));
    const orphanGroup = () => {
      const g = document.createElement('div');
      g.className = 'table-grid';
      g.append(...orphans.map((o) => card(o.tableNumber, null, o)));
      return html`<h2 class="hall-heading">${t('tables.otherTables')}</h2>
        ${g}`;
    };

    if (selected !== ALL) {
      const hall = halls.find((h) => String(h.id) === selected)!;
      // Orders on tables outside every hall show in every view: they still need paying.
      content.replaceChildren(
        hall.tables.length > 0
          ? grid(hall.tables, byTable)
          : html`<p class="empty-state">${t('tables.emptyHall')}</p>`,
        ...(orphans.length > 0 ? [orphanGroup()] : []),
      );
      return;
    }

    const groups = halls
      .filter((h) => h.tables.length > 0)
      .map((h) =>
        halls.length > 1
          ? html`<h2 class="hall-heading">${h.name}</h2>
              ${grid(h.tables, byTable)}`
          : grid(h.tables, byTable),
      );
    content.replaceChildren(...groups, ...(orphans.length > 0 ? [orphanGroup()] : []));
  };

  const load = async () => {
    try {
      [busy, halls, openOrders] = await Promise.all([
        api.orders.busyTables(),
        api.halls.list(),
        api.orders.openList(),
      ]);
      render();
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  const stopEvents = api.events.subscribe((e) => {
    if (e.type === 'orders-changed' || e.type === 'halls-changed') void load();
  });
  const stopStore = appStore.subscribe((s, prev) => {
    if (s.openSession !== prev.openSession || s.settings !== prev.settings) render();
  });

  return {
    el,
    destroy() {
      stopEvents();
      stopStore();
    },
  };
};
