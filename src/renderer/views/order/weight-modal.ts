import type { MenuItemDto } from '@shared/types';
import {
  dec,
  isDecimalString,
  toMoneyString,
  toQtyString,
  type DecimalString,
} from '@shared/utils/decimal';
import { field } from '../../components/forms';
import { openModal } from '../../components/modal';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { formatMoney } from '../../utils/format';

/**
 * Weight entry for a by-kg dish. Legacy let the cashier type a price per unit (e.g. 45 000 for a
 * skewer) and derived the weight; both fields are offered and kept in step: kg × price/kg = price.
 * Resolves the kg per unit, or null when cancelled.
 */
export function askWeight(
  dish: Pick<MenuItemDto, 'nameUz' | 'nameRu' | 'price'>,
  current?: DecimalString | null,
) {
  return new Promise<DecimalString | null>((resolve) => {
    const lang = appStore.get().language;
    const pricePerKg = dec(dish.price);
    const kgField = field({
      name: 'kg',
      label: t('order.weightKg'),
      type: 'text',
      inputmode: 'decimal',
      value: current ?? '',
    });
    const priceField = field({
      name: 'unitPrice',
      label: t('order.unitPrice'),
      type: 'text',
      inputmode: 'numeric',
    });
    const kg = kgField.querySelector('input')!;
    const price = priceField.querySelector('input')!;
    const error = kgField.querySelector<HTMLElement>('.field-error')!;

    const parse = (s: string) => {
      const v = s.trim().replace(',', '.');
      return isDecimalString(v) && dec(v).gt(0) ? dec(v) : null;
    };
    const syncFromKg = () => {
      const v = parse(kg.value);
      price.value = v ? toMoneyString(v.times(pricePerKg)) : '';
    };
    kg.addEventListener('input', syncFromKg);
    price.addEventListener('input', () => {
      const v = parse(price.value);
      kg.value = v && pricePerKg.gt(0) ? toQtyString(v.div(pricePerKg)) : '';
    });
    if (current) syncFromKg();

    let result: DecimalString | null = null;
    const name = lang === 'ru' && dish.nameRu ? dish.nameRu : dish.nameUz;
    const modal = openModal({
      title: t('order.weightTitle', { name }),
      size: 'sm',
      body: html`<p class="muted">
          ${t('order.pricePerKg', { price: formatMoney(dish.price, lang) })}
        </p>
        <div class="form-row">${kgField}${priceField}</div>`,
      actions: [
        { label: t('app.cancel') },
        {
          label: t('order.add'),
          kind: 'primary',
          submit: true,
          onClick: () => {
            const v = parse(kg.value);
            const rounded = v ? toQtyString(v) : null;
            if (!rounded || dec(rounded).lte(0)) {
              error.textContent = t('errors.VALIDATION');
              kg.setAttribute('aria-invalid', 'true');
              kg.focus();
              return false;
            }
            result = rounded;
          },
        },
      ],
    });
    void modal.closed.then(() => resolve(result));
  });
}
