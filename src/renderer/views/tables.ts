import type { TableSummaryDto } from '@shared/types';
import { api } from '../api';
import { toastError } from '../components/toast';
import { t } from '../i18n';
import { appStore } from '../store/app';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import { playClick } from '../ui/sound';
import { formatMoney, formatTime } from '../utils/format';
import type { View } from './types';

/** The table grid (legacy "Buyurtma" start screen): free and busy tables at a glance. */
export const tablesView: View = ({ navigate }) => {
  const el = document.createElement('section');
  el.className = 'page tables-page';

  const banner = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'table-grid';
  el.append(html`<header class="page-header"><h1>${t('tables.title')}</h1></header>`, banner, grid);

  let busy: TableSummaryDto[] = [];

  const render = () => {
    const { settings, openSession, language } = appStore.get();
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
    const count = Math.max(settings?.tableCount ?? 10, ...busy.map((b) => b.tableNumber));
    const buttons: HTMLButtonElement[] = [];
    for (let n = 1; n <= count; n++) {
      const order = byTable.get(n);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `table-card ${order ? 'is-busy' : 'is-free'}`;
      b.disabled = !order && openSession === null;
      b.append(
        order
          ? html`<span class="table-number">${n}</span>
              <span class="table-status">${t('tables.busy')} · ${formatTime(order.updatedAt)}</span>
              <span class="table-total">${formatMoney(order.totalAmount, language)}</span>
              <span class="table-meta"
                >№ ${order.orderNumber} · ${t('tables.lines', { count: order.lineCount })}</span
              >`
          : html`<span class="table-number">${n}</span
              ><span class="table-status">${t('tables.free')}</span>`,
      );
      b.setAttribute(
        'aria-label',
        `${t('tables.table', { n })}: ${order ? t('tables.busy') : t('tables.free')}`,
      );
      b.addEventListener('click', () => {
        playClick();
        navigate(`/tables/${n}`);
      });
      buttons.push(b);
    }
    grid.replaceChildren(...buttons);
  };

  const load = async () => {
    try {
      busy = await api.orders.busyTables();
      render();
    } catch (error) {
      toastError(error);
    }
  };

  render();
  void load();
  const stopEvents = api.events.subscribe((e) => {
    if (e.type === 'orders-changed') void load();
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
