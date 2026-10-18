import type { OrderDto, PaymentMethod } from '@shared/types';
import { dec, isDecimalString, toMoneyString } from '@shared/utils/decimal';
import { api } from '../../api';
import { openModal } from '../../components/modal';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon, type IconName } from '../../ui/icons';
import { playClick } from '../../ui/sound';
import { formatMoney } from '../../utils/format';

const METHODS: Array<{ method: PaymentMethod; icon: IconName }> = [
  { method: 'cash', icon: 'cash' },
  { method: 'card', icon: 'card' },
  { method: 'click', icon: 'click' },
  { method: 'debt', icon: 'debt' },
];

/**
 * Pays the order in full (legacy payment window as a modal). Cash shows the change for the amount
 * received; debt is recorded as a pending payment. Resolves the paid order, or null if closed.
 */
export function payOrderModal(order: OrderDto): Promise<OrderDto | null> {
  return new Promise((resolve) => {
    const lang = appStore.get().language;
    let method: PaymentMethod = 'cash';
    let paid: OrderDto | null = null;

    const methodButtons = METHODS.map(({ method: m, icon: ic }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'method-button';
      b.dataset['method'] = m;
      b.setAttribute('aria-pressed', String(m === method));
      b.append(
        icon(ic, 28),
        Object.assign(document.createElement('span'), { textContent: t(`payment.${m}`) }),
      );
      return b;
    });

    const received = document.createElement('input');
    received.type = 'text';
    received.inputMode = 'numeric';
    received.id = 'pay-received';
    received.className = 'input-lg';
    const change = document.createElement('output');
    change.className = 'change-amount';
    change.htmlFor.add('pay-received');
    const cashBox = html`<div class="cash-box" data-ref="cash">
      <div class="field"><label for="pay-received">${t('payment.received')}</label>${received}</div>
      <div class="change"><span>${t('payment.change')}</span>${change}</div>
    </div>`;
    const debtNote = document.createElement('p');
    debtNote.className = 'notice notice-info';
    debtNote.textContent = t('payment.debtNote');
    const error = document.createElement('div');
    error.className = 'form-error';
    error.setAttribute('role', 'alert');

    const body = html`<div class="pay-total">
        <span>${t('payment.toPay')}</span><strong>${formatMoney(order.totalAmount, lang)}</strong>
      </div>
      <fieldset class="method-group">
        <legend>${t('payment.method')}</legend>
        ${methodButtons}
      </fieldset>
      ${cashBox}${debtNote}${error}`;

    const cash = body.querySelector<HTMLElement>('[data-ref="cash"]')!;
    const updateChange = () => {
      const v = received.value.replace(/\s/g, '').replace(',', '.');
      if (!isDecimalString(v)) {
        change.textContent = '—';
        return;
      }
      const diff = dec(v).minus(order.totalAmount);
      change.textContent = diff.lt(0) ? '—' : formatMoney(toMoneyString(diff), lang);
    };
    const select = (m: PaymentMethod) => {
      method = m;
      for (const b of methodButtons)
        b.setAttribute('aria-pressed', String(b.dataset['method'] === m));
      cash.hidden = m !== 'cash';
      debtNote.hidden = m !== 'debt';
    };
    for (const b of methodButtons) {
      b.addEventListener('click', () => {
        playClick();
        select(b.dataset['method'] as PaymentMethod);
      });
    }
    received.addEventListener('input', updateChange);
    select('cash');
    updateChange();

    const modal = openModal({
      title: t('payment.title', { n: order.tableNumber }),
      body,
      size: 'md',
      initialFocus: () => received,
      actions: [
        { label: t('app.cancel') },
        {
          label: t('payment.confirm'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            error.textContent = '';
            try {
              paid = await api.payments.pay({
                orderId: order.id,
                method,
                expectedVersion: order.version,
              });
              toast(t('payment.done', { amount: formatMoney(order.totalAmount, lang) }), 'success');
            } catch (e) {
              error.textContent = errorMessage(e);
              return false;
            }
          },
        },
      ],
    });
    void modal.closed.then(() => resolve(paid));
  });
}
