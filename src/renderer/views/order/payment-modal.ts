import type { OrderDto } from '@shared/types';
import { dec } from '@shared/utils/decimal';
import { api } from '../../api';
import { openModal } from '../../components/modal';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { formatMoney } from '../../utils/format';
import { createTenderEditor } from './tender-editor';

/**
 * Pays the order (legacy payment window as a modal): one method, or split over several, part of
 * it on debt (nasiya). Resolves the paid order, or null if closed.
 */
export function payOrderModal(order: OrderDto): Promise<OrderDto | null> {
  return new Promise((resolve) => {
    const lang = appStore.get().language;
    let paid: OrderDto | null = null;
    let confirm: HTMLButtonElement | null = null;

    const editor = createTenderEditor({
      total: order.totalAmount,
      orderCustomer: order.customerId
        ? { name: order.customerName, phone: order.customerPhone }
        : null,
      onChange: () => {
        if (confirm) confirm.disabled = !editor.canSubmit();
      },
    });

    const modal = openModal({
      title:
        order.tableNumber !== null
          ? t('payment.title', { n: order.tableNumber })
          : t('payment.titleOpen', {
              type: t(`orderType.${order.orderType}`),
              number: order.orderNumber,
            }),
      body: editor.el,
      size: 'md',
      initialFocus: () => editor.el.querySelector<HTMLInputElement>('[name="received"]'),
      actions: [
        { label: t('app.cancel') },
        {
          label: t('payment.confirm'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            editor.clearErrors();
            if (!editor.canSubmit()) return false;
            const { change } = editor.state();
            try {
              paid = await api.payments.pay({
                orderId: order.id,
                expectedVersion: order.version,
                ...editor.result(),
              });
              toast(
                dec(change).gt(0)
                  ? t('payment.doneChange', {
                      amount: formatMoney(order.totalAmount, lang),
                      change: formatMoney(change, lang),
                    })
                  : t('payment.done', { amount: formatMoney(order.totalAmount, lang) }),
                'success',
              );
            } catch (e) {
              editor.showError(e);
              return false;
            }
          },
        },
      ],
    });
    confirm = modal.dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (confirm) confirm.disabled = !editor.canSubmit();
    void modal.closed.then(() => resolve(paid));
  });
}
