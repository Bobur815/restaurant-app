import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  field,
  formError,
  selectField,
  showFormError,
  value,
} from '../../components/forms';
import { pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { licensed } from '../../store/app';
import { SERVICE_FEE_TYPES, type ServiceFeeType } from '@shared/utils/service-fee';
import { html } from '../../ui/html';
import { toInputDecimal } from '../../utils/format';
import type { View } from '../types';
import { submitButton } from './settings-ui';
import { withInfo } from '../../components/info-hint';

/**
 * Which order types the till offers besides tables, the usual delivery fee, the service fee on
 * table orders (feature F17), and whether the order screen shows pictures (feature F10).
 */
export const ordersSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(withInfo(t('settings.sectionOrders'), t('settings.ordersHint'))), body);

  const load = async () => {
    try {
      const settings = await api.settings.get();
      const form = document.createElement('form');
      form.className = 'card form-card';
      form.noValidate = true;
      form.append(
        html`${licensed('takeaway') && licensed('delivery')
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
          <h3 class="form-subtitle">
            ${withInfo(t('settings.serviceFeeTitle'), t('settings.serviceFeeHint'))}
          </h3>
          ${selectField({
            name: 'serviceFeeType',
            label: t('settings.serviceFeeType'),
            value: settings.serviceFeeType,
            options: SERVICE_FEE_TYPES.map((type) => ({
              value: type,
              label: t(`settings.serviceFee_${type}`),
            })),
          })}
          ${field({
            name: 'serviceFeePercent',
            label: t('settings.serviceFeePercent'),
            inputmode: 'decimal',
            value: toInputDecimal(settings.serviceFeePercent),
          })}
          ${field({
            name: 'serviceFeePerGuest',
            label: t('settings.serviceFeePerGuest'),
            inputmode: 'decimal',
            amount: true,
            value: toInputDecimal(settings.serviceFeePerGuest),
          })}
          <h3 class="form-subtitle">
            ${withInfo(t('settings.picturesTitle'), t('settings.picturesHint'))}
          </h3>
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
      // Only the amount the chosen type uses is shown.
      const typeSelect = form.querySelector<HTMLSelectElement>('[name="serviceFeeType"]')!;
      const showFeeFields = () => {
        const type = typeSelect.value as ServiceFeeType;
        form
          .querySelector('[name="serviceFeePercent"]')!
          .closest('.field')!
          .toggleAttribute('hidden', type !== 'percent');
        form
          .querySelector('[name="serviceFeePerGuest"]')!
          .closest('.field')!
          .toggleAttribute('hidden', type !== 'perGuest');
      };
      typeSelect.addEventListener('change', showFeeFields);
      showFeeFields();
      const decimalOf = (name: string) =>
        value(form, name).replace(/\s/g, '').replace(',', '.') || '0';
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
            serviceFeeType: typeSelect.value as ServiceFeeType,
            serviceFeePercent: decimalOf('serviceFeePercent'),
            serviceFeePerGuest: decimalOf('serviceFeePerGuest'),
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
