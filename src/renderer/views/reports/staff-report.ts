import type { StaffReport } from '@shared/types';
import { t } from '../../i18n';
import type { Language } from '@shared/types';
import { html } from '../../ui/html';
import { formatMoney, formatQty } from '../../utils/format';

/**
 * Feature F17, Xodimlar bo'yicha hisobot: per user who opened paid orders in the range, their
 * orders, guests, dishes sold (the base), service fees and earnings. Earnings use the percent each
 * order was paid at; the "%" column is the user's percent now.
 */
export function staffReportCard(report: StaffReport, l: Language): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';
  if (report.rows.length === 0) {
    card.append(html`<p class="muted empty-inline">${t('reports.empty')}</p>`);
    return card;
  }
  card.append(
    html`<h2 class="card-title">${t('reports.staffTitle')}</h2>
      <div class="table-wrap">
        <table class="lines-table staff-report">
          <thead>
            <tr>
              <th>${t('reports.staffName')}</th>
              <th class="num">${t('reports.orders')}</th>
              <th class="num">${t('reports.guests')}</th>
              <th class="num">${t('reports.staffSales')}</th>
              <th class="num">${t('reports.serviceFees')}</th>
              <th class="num">${t('reports.staffPercent')}</th>
              <th class="num">${t('reports.staffEarnings')}</th>
            </tr>
          </thead>
          <tbody>
            ${report.rows.map(
              (r) =>
                html`<tr>
                  <td class="line-name">${r.fullName ?? t('reports.staffUnknown')}</td>
                  <td class="num">${r.orders}</td>
                  <td class="num">${r.guests || '—'}</td>
                  <td class="num">${formatMoney(r.sales, l, false)}</td>
                  <td class="num">${formatMoney(r.serviceFees, l, false)}</td>
                  <td class="num">
                    ${r.currentPercent === null ? '—' : `${formatQty(r.currentPercent, l)}%`}
                  </td>
                  <td class="num strong">${formatMoney(r.earnings, l)}</td>
                </tr>`,
            )}
          </tbody>
          <tfoot>
            <tr>
              <td class="strong">${t('reports.total')}</td>
              <td class="num strong">${report.totals.orders}</td>
              <td class="num strong">${report.totals.guests || '—'}</td>
              <td class="num strong">${formatMoney(report.totals.sales, l, false)}</td>
              <td class="num strong">${formatMoney(report.totals.serviceFees, l, false)}</td>
              <td></td>
              <td class="num strong">${formatMoney(report.totals.earnings, l)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="muted small">${t('reports.staffNote')}</p>`,
  );
  return card;
}
