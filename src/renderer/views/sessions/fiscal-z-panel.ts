import type { FiscalZReportDto } from '@shared/types';
import { api } from '../../api';
import { confirmDialog } from '../../components/modal';
import { button } from '../../components/page';
import { errorMessage, toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { formatMoney } from '../../utils/format';

/**
 * Feature F18: REGOS:VCR's Z-report beside the shift. It opens and closes with the shift by
 * itself; the buttons are for when the two disagree (closed in the REGOS app, 24-hour close).
 * Nothing here when fiscal receipts are off.
 */
export function fiscalZPanel(): { el: HTMLElement; refresh(): void } {
  const el = document.createElement('div');

  const render = (z: FiscalZReportDto | null, error?: string) => {
    el.replaceChildren();
    el.className = '';
    if (!z && !error) return;
    el.className = 'card';
    const l = appStore.get().language;
    const act = (
      label: string,
      kind: 'secondary' | 'danger',
      run: () => Promise<FiscalZReportDto>,
      confirmText?: string,
    ) =>
      button(label, kind, async () => {
        if (
          confirmText &&
          !(await confirmDialog({ title: label, message: confirmText, danger: true }))
        )
          return;
        try {
          render(await run());
          toast(t('fiscal.zDone'), 'success');
        } catch (e) {
          toastError(e);
        }
      });
    const open = act(t('fiscal.zOpen'), 'secondary', () => api.fiscal.zOpen());
    const close = act(
      t('fiscal.zClose'),
      'danger',
      () => api.fiscal.zClose(),
      t('fiscal.zCloseConfirm'),
    );
    el.append(
      html`<div class="card-header">
          <div>
            <h2>${t('fiscal.zTitle')}</h2>
            <p class="muted">
              ${z
                ? z.open
                  ? t('fiscal.zIsOpen', { n: z.number, terminal: z.terminalId })
                  : t('fiscal.zIsClosed', { terminal: z.terminalId })
                : ''}
            </p>
          </div>
          <div class="page-actions">${z ? (z.open ? close : open) : ''}</div>
        </div>
        ${error ? html`<p class="notice notice-error">${error}</p>` : ''}
        ${z
          ? html`<dl class="kv">
              <dt>${t('fiscal.zSales')}</dt>
              <dd>${z.saleCount}</dd>
              <dt>${t('payment.cash')}</dt>
              <dd>${formatMoney(z.saleCash, l)}</dd>
              <dt>${t('payment.card')}</dt>
              <dd>${formatMoney(z.saleCard, l)}</dd>
              <dt>${t('fiscal.zRefunds')}</dt>
              <dd>${z.refundCount}</dd>
            </dl>`
          : ''}`,
    );
  };

  const refresh = () => {
    if (!appStore.get().fiscal?.enabled) return render(null);
    api.fiscal
      .zReport()
      .then((z) => render(z))
      .catch((e: unknown) => render(null, errorMessage(e)));
  };
  return { el, refresh };
}
