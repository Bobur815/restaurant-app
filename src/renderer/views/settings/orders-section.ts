import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  field,
  formError,
  showFormError,
  value,
} from '../../components/forms';
import { pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { licensed } from '../../store/app';
import { html } from '../../ui/html';
import { toInputDecimal } from '../../utils/format';
import type { View } from '../types';
import { submitButton } from './settings-ui';

/** Which order types the till offers besides tables, and the usual delivery fee. */
export const ordersSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionOrders')), body);

  const load = async () => {
    try {
      const settings = await api.settings.get();
      const form = document.createElement('form');
      form.className = 'card form-card';
      form.noValidate = true;
      form.append(
        html`<p class="muted small">${t('settings.ordersHint')}</p>
          ${licensed('takeaway') && licensed('delivery')
            ? ''
            : html`<p class="notice notice-info">${t('settings.ordersNotInPlan')}</p>`}
          ${checkboxField({
            name: 'takeawayEnabled',
            label: t('settings.takeawayEnabled'),
            checked: settings.takeawayEnabled,
          })}
          ${checkboxField({
            name: 'deliveryEnabled',
            label: t('settings.deliveryEnabled'),
            checked: settings.deliveryEnabled,
          })}
          ${field({
            name: 'deliveryFeeDefault',
            label: t('settings.deliveryFeeDefault'),
            inputmode: 'decimal',
            value: toInputDecimal(settings.deliveryFeeDefault),
          })}
          ${formError()}${submitButton()}`,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(form);
        try {
          await api.settings.update({
            takeawayEnabled: checked(form, 'takeawayEnabled'),
            deliveryEnabled: checked(form, 'deliveryEnabled'),
            deliveryFeeDefault:
              value(form, 'deliveryFeeDefault').replace(/\s/g, '').replace(',', '.') || '0',
          });
          toast(t('settings.saved'), 'success');
        } catch (error) {
          showFormError(form, error);
        }
      });
      body.replaceChildren(form);
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  return { el };
};
