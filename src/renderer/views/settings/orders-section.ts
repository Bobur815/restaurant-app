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

/**
 * Which order types the till offers besides tables, the usual delivery fee, and whether the order
 * screen shows category and dish pictures (feature F10).
 */
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
            amount: true,
            value: toInputDecimal(settings.deliveryFeeDefault),
          })}
          <h3 class="form-subtitle">${t('settings.picturesTitle')}</h3>
          <p class="muted small">${t('settings.picturesHint')}</p>
          ${checkboxField({
            name: 'showCategoryImages',
            label: t('settings.showCategoryImages'),
            checked: settings.showCategoryImages,
          })}
          ${checkboxField({
            name: 'showMenuImages',
            label: t('settings.showMenuImages'),
            checked: settings.showMenuImages,
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
            showCategoryImages: checked(form, 'showCategoryImages'),
            showMenuImages: checked(form, 'showMenuImages'),
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
