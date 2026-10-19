import type { DiningTableDto, HallDto, TableSummaryDto } from '@shared/types';
import { api } from '../api';
import { toastError } from '../components/toast';
import { t } from '../i18n';
import { appStore } from '../store/app';
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
  el.append(
    html`<header class="page-header"><h1>${t('tables.title')}</h1></header>`,
    banner,
    tabs,
    content,
  );

  let busy: TableSummaryDto[] = [];
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

  const render = () => {
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
      [busy, halls] = await Promise.all([api.orders.busyTables(), api.halls.list()]);
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
    if (s.openSession !== prev.openSession) render();
  });

  return {
    el,
    destroy() {
      stopEvents();
      stopStore();
    },
  };
};
