import { api } from '../api';
import { SavdoChefSquare } from '../branding';
import { clearErrors, field, showFormError, value } from '../components/forms';
import { phoneField } from '../components/phone-field';
import { pinField, pinsMatch } from '../components/pin-field';
import { showRecoveryCode } from '../components/recovery-code';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { homeFor } from '../router/routes';
import { appStore } from '../store/app';
import { html } from '../ui/html';
import type { View } from './types';

/**
 * First run: the first administrator (name, phone, login PIN) and the restaurant's receipt
 * details, in one step. Ends by showing the owner's recovery code once.
 */
export const setupView: View = ({ navigate }) => {
  const adminPhone = phoneField({ name: 'admin.phone', label: t('setup.adminPhone') });
  const form = document.createElement('form');
  form.className = 'auth-card auth-card-wide';
  form.noValidate = true;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary btn-lg btn-block';
  submit.textContent = t('setup.submit');

  form.append(
    html`<div class="auth-brand">
        ${SavdoChefSquare({ size: 72 })}
        <div>
          <h1>${t('setup.title')}</h1>
          <p class="muted">${t('setup.subtitle')}</p>
        </div>
      </div>
      <div class="form-columns">
        <fieldset>
          <legend>${t('setup.adminSection')}</legend>
          ${field({
            name: 'admin.fullName',
            label: t('setup.fullName'),
            required: true,
            autocomplete: 'name',
          })}
          ${adminPhone.el} ${pinField('admin.pin', t('setup.pin'))}
          ${pinField('pinRepeat', t('setup.pinRepeat'))}
          <p class="muted small">${t('setup.pinHint')}</p>
        </fieldset>
        <fieldset>
          <legend>${t('setup.restaurantSection')}</legend>
          ${field({
            name: 'receipt.restaurantName',
            label: t('setup.restaurantName'),
            required: true,
          })}
          ${field({ name: 'receipt.phone', label: t('setup.phone'), type: 'tel' })}
          ${field({ name: 'receipt.address', label: t('setup.address') })}
          ${field({
            name: 'tableCount',
            label: t('setup.tableCount'),
            type: 'number',
            value: '10',
            min: 1,
            max: 200,
            inputmode: 'numeric',
          })}
        </fieldset>
      </div>
      <div class="form-error" role="alert"></div>
      ${submit}`,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!pinsMatch(form, 'admin.pin', 'pinRepeat')) return;
    submit.disabled = true;
    try {
      const { user, recoveryCode } = await api.setup.complete({
        admin: {
          fullName: value(form, 'admin.fullName'),
          phone: adminPhone.input.value,
          pin: value(form, 'admin.pin'),
        },
        receipt: {
          restaurantName: value(form, 'receipt.restaurantName'),
          phone: value(form, 'receipt.phone'),
          address: value(form, 'receipt.address'),
        },
        tableCount: Number(value(form, 'tableCount')) || 10,
      });
      const [settings, receipt] = await Promise.all([api.settings.get(), api.receipt.get()]);
      appStore.set({
        user,
        settings,
        receipt,
        setup: { setupComplete: true, hasAdmin: true },
        openSession: null,
      });
      await showRecoveryCode(recoveryCode);
      toast(t('setup.done'), 'success');
      navigate(homeFor(user));
    } catch (error) {
      showFormError(form, error);
    } finally {
      submit.disabled = false;
    }
  });

  const page = document.createElement('div');
  page.className = 'auth-page';
  page.append(form);
  return { el: page };
};
