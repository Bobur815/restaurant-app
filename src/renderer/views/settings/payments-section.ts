import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  formError,
  showFormError,
} from '../../components/forms';
import { pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import type { View } from '../types';
import { submitButton } from './settings-ui';

/** Payment options offered at the till: split payment and debt (nasiya). */
export const paymentsSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionPayments')), body);

  const load = async () => {
    try {
      const settings = await api.settings.get();
      const form = document.createElement('form');
      form.className = 'card form-card';
      form.noValidate = true;
      form.append(
        html`<p class="muted small">${t('settings.paymentsHint')}</p>
          ${checkboxField({
            name: 'splitPaymentEnabled',
            label: t('settings.splitPaymentEnabled'),
            checked: settings.splitPaymentEnabled,
          })}
          ${checkboxField({
            name: 'debtEnabled',
            label: t('settings.debtEnabled'),
            checked: settings.debtEnabled,
          })}
          ${formError()}${submitButton()}`,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(form);
        try {
          await api.settings.update({
            splitPaymentEnabled: checked(form, 'splitPaymentEnabled'),
            debtEnabled: checked(form, 'debtEnabled'),
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
