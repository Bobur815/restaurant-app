import type { ExpenseList, ResidualList, SalesReport } from '@shared/types';
import { dec, sum, toMoneyString } from '@shared/utils/decimal';
import { api } from '../../api';
import { field, selectField, value } from '../../components/forms';
import { button, pageHeader } from '../../components/page';
import { toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore, licensed } from '../../store/app';
import { html } from '../../ui/html';
import { daysBetween, presetRange, type RangePreset } from '../../utils/dates';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../utils/format';
import type { View } from '../types';
import { createSalesChart } from './sales-chart';

type Tab = 'sales' | 'residuals' | 'expenses';

/** Reports (admin; legacy hisobotlar): sales by day and method, dishes sold, leftovers, expenses. */
export const reportsView: View = () => {
  const lang = () => appStore.get().language;
  let tab: Tab = 'sales';
  // Sales over more than one day are a plan feature (F5); without it the page works per day.
  const longRanges = licensed('reports');
  let range = presetRange(longRanges ? 'week' : 'today');
  let chart: { destroy(): void } | null = null;
  let residualPage = 1;
  let expensePage = 1;

  const el = document.createElement('section');
  el.className = 'page';

  // ── range controls (shared by the tabs) ───────────────────────────────────────────────────
  const rangeForm = document.createElement('form');
  rangeForm.className = 'filters';
  const presetIds: RangePreset[] = longRanges
    ? ['today', 'yesterday', 'week', 'month', 'lastMonth']
    : ['today', 'yesterday'];
  const presets = presetIds.map((p) =>
    button(t(`reports.${p}`), 'secondary', () => {
      range = presetRange(p);
      syncInputs();
      void load();
    }),
  );
  rangeForm.append(
    html`${field({ name: 'start', label: t('reports.from'), type: 'date', value: range.start })}
      ${field({ name: 'end', label: t('reports.to'), type: 'date', value: range.end })}
      <div class="preset-row">${presets}</div>`,
  );
  if (!longRanges) {
    rangeForm.querySelector('[name="end"]')!.closest('.field')!.toggleAttribute('hidden', true);
    const startField = rangeForm.querySelector('[name="start"]')!.closest('.field')!;
    startField.querySelector('label')!.textContent = t('reports.day');
    rangeForm.append(html`<p class="muted">${t('reports.oneDayOnly')}</p>`);
  }
  const syncInputs = () => {
    rangeForm.querySelector<HTMLInputElement>('[name="start"]')!.value = range.start;
    rangeForm.querySelector<HTMLInputElement>('[name="end"]')!.value = range.end;
  };
  rangeForm.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    const start = value(rangeForm, 'start');
    const end = longRanges ? value(rangeForm, 'end') : start;
    if (start && end && start <= end) {
      range = { start, end };
      void load();
    }
  });
  rangeForm.addEventListener('submit', (e) => e.preventDefault());

  // ── tabs ──────────────────────────────────────────────────────────────────────────────────
  const tabs = document.createElement('div');
  tabs.className = 'chips';
  tabs.setAttribute('role', 'tablist');
  const tabButtons = (['sales', 'residuals', 'expenses'] as Tab[]).map((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.textContent = t(`reports.${id}`);
    b.addEventListener('click', () => {
      tab = id;
      void load();
    });
    return b;
  });
  tabs.append(...tabButtons);

  const content = document.createElement('div');
  el.append(pageHeader(t('reports.title')), tabs, rangeForm, content);

  // ── sales ─────────────────────────────────────────────────────────────────────────────────
  function renderSales(report: SalesReport) {
    chart?.destroy();
    chart = null;
    const l = lang();
    const daily = [...report.daily].sort((a, b) => a.date.localeCompare(b.date));
    const revenue = sum(daily.map((d) => d.total));
    const orders = daily.reduce((n, d) => n + d.numberOfOrders, 0);
    const expenses = sum(daily.map((d) => d.expenseTotal));
    const avg = orders ? revenue.div(orders) : dec(0);

    const tile = (label: string, val: string, note?: string) =>
      html`<div class="stat-tile">
        <span class="stat-label">${label}</span><strong class="stat-value">${val}</strong>
        ${note ? html`<span class="stat-note">${note}</span>` : ''}
      </div>`;
    /** Range total of one by-order-type column. */
    const byType = (
      k:
        | 'dineIn'
        | 'takeaway'
        | 'delivery'
        | 'deliveryFees'
        | 'received'
        | 'repayments'
        | 'debt'
        | 'writtenOff',
    ) => toMoneyString(sum(daily.map((d) => d[k])));

    if (daily.length === 0) {
      content.replaceChildren(
        html`<div class="card"><p class="muted empty-inline">${t('reports.empty')}</p></div>`,
      );
      return;
    }

    // Dishes over the whole range (legacy listed them per day; totals per dish answer "what sold").
    const dishes = new Map<
      number,
      { nameUz: string; quantity: string; stock: string; revenue: string }
    >();
    for (const day of report.productsByDate) {
      for (const p of day.products) {
        const prev = dishes.get(p.menuItemId);
        dishes.set(p.menuItemId, {
          nameUz: p.nameUz,
          quantity: dec(prev?.quantity ?? '0')
            .plus(p.quantity)
            .toFixed(),
          stock: dec(prev?.stock ?? '0')
            .plus(p.stockQuantity)
            .toFixed(),
          revenue: dec(prev?.revenue ?? '0')
            .plus(p.revenue)
            .toFixed(),
        });
      }
    }
    const dishRows = [...dishes.values()].sort((a, b) => dec(b.revenue).comparedTo(a.revenue));

    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('reports.chartTitle'));
    const chartBox = document.createElement('div');
    chartBox.className = 'chart-box';
    chartBox.append(canvas);

    content.replaceChildren(
      html`<div class="stat-row">
          ${tile(t('reports.revenue'), formatMoney(toMoneyString(revenue), l))}
          ${tile(t('reports.orders'), String(orders))}
          ${tile(t('reports.avgCheck'), formatMoney(toMoneyString(avg), l))}
          ${tile(t('reports.expenseTotal'), formatMoney(toMoneyString(expenses), l))}
        </div>
        <div class="stat-row">
          ${tile(t('orderType.DINE_IN'), formatMoney(byType('dineIn'), l))}
          ${tile(t('orderType.TAKEAWAY'), formatMoney(byType('takeaway'), l))}
          ${tile(
            t('orderType.DELIVERY'),
            formatMoney(byType('delivery'), l),
            t('reports.deliveryFees', { amount: formatMoney(byType('deliveryFees'), l) }),
          )}
        </div>
        <div class="stat-row">
          ${tile(
            t('reports.received'),
            formatMoney(byType('received'), l),
            t('reports.receivedNote'),
          )}
          ${tile(t('reports.debtSold'), formatMoney(byType('debt'), l))}
          ${tile(t('reports.repayments'), formatMoney(byType('repayments'), l))}
          ${tile(t('reports.writtenOff'), formatMoney(byType('writtenOff'), l))}
        </div>
        <div class="card">
          <h2 class="card-title">${t('reports.chartTitle')}</h2>
          ${chartBox}
        </div>
        <div class="card">
          <h2 class="card-title">${t('reports.tableView')}</h2>
          <div class="table-wrap">
            <table class="lines-table">
              <thead>
                <tr>
                  <th>${t('reports.date')}</th>
                  <th class="num">${t('reports.orders')}</th>
                  <th class="num">${t('reports.cash')}</th>
                  <th class="num">${t('reports.card')}</th>
                  <th class="num">${t('reports.click')}</th>
                  <th class="num">${t('reports.debt')}</th>
                  <th class="num">${t('reports.total')}</th>
                  <th class="num">${t('reports.expenseTotal')}</th>
                </tr>
              </thead>
              <tbody>
                ${daily.map(
                  (d) =>
                    html`<tr>
                      <td>${formatDate(d.date + 'T00:00:00')}</td>
                      <td class="num">${d.numberOfOrders}</td>
                      <td class="num">${formatMoney(d.cash, l, false)}</td>
                      <td class="num">${formatMoney(d.card, l, false)}</td>
                      <td class="num">${formatMoney(d.click, l, false)}</td>
                      <td class="num">${formatMoney(d.debt, l, false)}</td>
                      <td class="num strong">${formatMoney(d.total, l, false)}</td>
                      <td class="num">${formatMoney(d.expenseTotal, l, false)}</td>
                    </tr>`,
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td class="strong">${t('reports.total')}</td>
                  <td class="num strong">${orders}</td>
                  ${(['cash', 'card', 'click', 'debt'] as const).map(
                    (m) =>
                      html`<td class="num strong">
                        ${formatMoney(toMoneyString(sum(daily.map((d) => d[m]))), l, false)}
                      </td>`,
                  )}
                  <td class="num strong">${formatMoney(toMoneyString(revenue), l, false)}</td>
                  <td class="num strong">${formatMoney(toMoneyString(expenses), l, false)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div class="card">
          <h2 class="card-title">${t('reports.products')}</h2>
          <div class="table-wrap">
            <table class="lines-table">
              <thead>
                <tr>
                  <th>${t('reports.dish')}</th>
                  <th class="num">${t('reports.units')}</th>
                  <th class="num">${t('reports.stockUsed')}</th>
                  <th class="num">${t('reports.revenue')}</th>
                </tr>
              </thead>
              <tbody>
                ${dishRows.map(
                  (d) =>
                    html`<tr>
                      <td class="line-name">${d.nameUz}</td>
                      <td class="num">${formatQty(d.quantity, l)}</td>
                      <td class="num">${formatQty(d.stock, l)}</td>
                      <td class="num strong">${formatMoney(d.revenue, l)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>
        </div>`,
    );

    const days = daysBetween(range.start, range.end) ?? daily.map((d) => d.date);
    chart = createSalesChart(canvas, days, daily, l);
  }

  // ── residuals & expenses ──────────────────────────────────────────────────────────────────
  function pager(page: number, pages: number, go: (p: number) => void): DocumentFragment {
    const prev = button(t('reports.prev'), 'secondary', () => go(page - 1));
    const next = button(t('reports.next'), 'secondary', () => go(page + 1));
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    return html`<div class="pager">
      ${prev}<span class="muted">${t('reports.page', { page, pages })}</span>${next}
    </div>`;
  }

  const residualFilters = document.createElement('form');
  residualFilters.className = 'filters';
  residualFilters.append(
    html`${selectField({
      name: 'action',
      label: t('reports.action'),
      options: [
        { value: '', label: t('reports.all') },
        { value: 'CARRY_TO_NEXT', label: t('reports.carry') },
        { value: 'WRITE_OFF', label: t('reports.writeOffAction') },
      ],
    })}
    ${selectField({
      name: 'status',
      label: t('checks.status'),
      options: [
        { value: '', label: t('reports.all') },
        { value: 'pending', label: t('reports.statusPending') },
        { value: 'applied', label: t('reports.statusApplied') },
      ],
    })}
    ${field({ name: 'q', label: t('reports.search'), type: 'search' })}`,
  );
  residualFilters.addEventListener('change', () => ((residualPage = 1), void load()));
  residualFilters.addEventListener(
    'submit',
    (e) => ((e.preventDefault(), (residualPage = 1)), void load()),
  );

  function renderResiduals(list: ResidualList) {
    const l = lang();
    const totals = Object.entries(list.totals).map(
      ([action, v]) =>
        html`<span class="badge badge-muted"
          >${action === 'CARRY_TO_NEXT' ? t('reports.carry') : t('reports.writeOffAction')}:
          ${v.count} · ${formatQty(v.quantity, l)}</span
        >`,
    );
    content.replaceChildren(
      residualFilters,
      html`<div class="card">
        <div class="badge-row">${totals}</div>
        ${list.items.length
          ? html`<div class="table-wrap">
                <table class="lines-table">
                  <thead>
                    <tr>
                      <th>${t('reports.date')}</th>
                      <th>${t('reports.session')}</th>
                      <th>${t('reports.dish')}</th>
                      <th class="num">${t('reports.quantity')}</th>
                      <th>${t('reports.action')}</th>
                      <th>${t('checks.status')}</th>
                      <th>${t('reports.note')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.items.map(
                      (r) =>
                        html`<tr>
                          <td>${formatDateTime(r.createdAt)}</td>
                          <td>№ ${r.sessionId}</td>
                          <td class="line-name">${r.menuNameUz}</td>
                          <td class="num">${formatQty(r.quantity, l)}</td>
                          <td>
                            ${r.action === 'CARRY_TO_NEXT'
                              ? t('reports.carry')
                              : t('reports.writeOffAction')}
                          </td>
                          <td>
                            ${r.status === 'pending'
                              ? t('reports.statusPending')
                              : t('reports.statusApplied')}
                          </td>
                          <td class="muted">${r.note}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              ${pager(list.page, list.totalPages, (p) => ((residualPage = p), void load()))}`
          : html`<p class="muted empty-inline">${t('reports.none')}</p>`}
      </div>`,
    );
  }

  const expenseFilters = document.createElement('form');
  expenseFilters.className = 'filters';
  expenseFilters.append(
    html`${selectField({
      name: 'type',
      label: t('reports.type'),
      options: [
        { value: '', label: t('reports.all') },
        { value: 'residual_writeoff', label: t('reports.writeOff') },
        { value: 'waste', label: t('reports.waste') },
        { value: 'breakage', label: t('reports.breakage') },
      ],
    })}
    ${field({ name: 'q', label: t('reports.search'), type: 'search' })}`,
  );
  expenseFilters.addEventListener('change', () => ((expensePage = 1), void load()));
  expenseFilters.addEventListener(
    'submit',
    (e) => ((e.preventDefault(), (expensePage = 1)), void load()),
  );

  const expenseType = (type: string) =>
    type === 'residual_writeoff'
      ? t('reports.writeOff')
      : type === 'waste'
        ? t('reports.waste')
        : t('reports.breakage');

  function renderExpenses(list: ExpenseList) {
    const l = lang();
    content.replaceChildren(
      expenseFilters,
      html`<div class="card">
        <div class="badge-row">
          <span class="badge badge-muted"
            >${t('reports.total')}: ${formatMoney(list.totals.totalAmount, l)}</span
          >${Object.entries(list.totals.byType).map(
            ([type, v]) =>
              html`<span class="badge badge-muted"
                >${expenseType(type)}: ${v.count} · ${formatMoney(v.amount, l)}</span
              >`,
          )}
        </div>
        ${list.items.length
          ? html`<div class="table-wrap">
                <table class="lines-table">
                  <thead>
                    <tr>
                      <th>${t('reports.date')}</th>
                      <th>${t('reports.dish')}</th>
                      <th>${t('reports.type')}</th>
                      <th class="num">${t('reports.quantity')}</th>
                      <th class="num">${t('reports.unitCost')}</th>
                      <th class="num">${t('reports.amount')}</th>
                      <th>${t('reports.note')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.items.map(
                      (e) =>
                        html`<tr>
                          <td>${formatDateTime(e.createdAt)}</td>
                          <td class="line-name">${e.menuNameUz ?? '—'}</td>
                          <td>${expenseType(e.type)}</td>
                          <td class="num">${formatQty(e.quantity, l)}</td>
                          <td class="num">${formatMoney(e.unitCost, l, false)}</td>
                          <td class="num strong">${formatMoney(e.amount, l)}</td>
                          <td class="muted">${e.note}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              ${pager(list.page, list.totalPages, (p) => ((expensePage = p), void load()))}`
          : html`<p class="muted empty-inline">${t('reports.none')}</p>`}
      </div>`,
    );
  }

  // ── loading ───────────────────────────────────────────────────────────────────────────────
  async function load() {
    tabButtons.forEach((b, i) =>
      b.setAttribute('aria-selected', String(['sales', 'residuals', 'expenses'][i] === tab)),
    );
    try {
      if (tab === 'sales') {
        renderSales(await api.reports.sales({ start: range.start, end: range.end }));
      } else if (tab === 'residuals') {
        chart?.destroy();
        chart = null;
        renderResiduals(
          await api.residuals.list({
            start: range.start,
            end: range.end,
            action: (value(residualFilters, 'action') || undefined) as
              | 'CARRY_TO_NEXT'
              | 'WRITE_OFF'
              | undefined,
            status: (value(residualFilters, 'status') || undefined) as
              | 'pending'
              | 'applied'
              | undefined,
            q: value(residualFilters, 'q') || undefined,
            page: residualPage,
            limit: 20,
          }),
        );
      } else {
        chart?.destroy();
        chart = null;
        const type = value(expenseFilters, 'type');
        renderExpenses(
          await api.expenses.list({
            start: range.start,
            end: range.end,
            types: type ? [type as 'residual_writeoff' | 'waste' | 'breakage'] : undefined,
            q: value(expenseFilters, 'q') || undefined,
            page: expensePage,
            limit: 20,
          }),
        );
      }
    } catch (e) {
      toastError(e);
    }
  }

  void load();
  // Theme changes recolour the chart: rebuild it from the tokens.
  const rerender = () => {
    if (tab === 'sales') void load();
  };
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', rerender);
  const stopStore = appStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) rerender();
  });
  const stopEvents = api.events.subscribe((e) => {
    if (e.type === 'orders-changed' || e.type === 'session-changed') rerender();
  });

  return {
    el,
    destroy() {
      chart?.destroy();
      media.removeEventListener('change', rerender);
      stopStore();
      stopEvents();
    },
  };
};
