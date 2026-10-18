import { api } from '../api';
import { SavdoChefSquare } from '../branding';
import { clearErrors, field, setFieldError, showFormError, value } from '../components/forms';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { appStore } from '../store/app';
import { html } from '../ui/html';
import type { View } from './types';

/** First run: the first administrator and the restaurant's receipt details, in one step. */
export const setupView: View = ({ navigate }) => {
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
            name: 'admin.username',
            label: t('setup.username'),
            required: true,
            autocomplete: 'username',
          })}
          ${field({ name: 'admin.fullName', label: t('setup.fullName'), autocomplete: 'name' })}
          ${field({
            name: 'admin.password',
            label: t('setup.password'),
            type: 'password',
            required: true,
            autocomplete: 'new-password',
          })}
          ${field({
            name: 'passwordRepeat',
            label: t('setup.passwordRepeat'),
            type: 'password',
            required: true,
            autocomplete: 'new-password',
          })}
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
    if (value(form, 'admin.password') !== value(form, 'passwordRepeat')) {
      setFieldError(form, 'passwordRepeat', t('errors.passwordsDiffer'));
      return;
    }
    submit.disabled = true;
    try {
      const user = await api.setup.complete({
        admin: {
          username: value(form, 'admin.username'),
          password: form.querySelector<HTMLInputElement>('[name="admin.password"]')!.value,
          fullName: value(form, 'admin.fullName') || null,
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
      toast(t('setup.done'), 'success');
      navigate('/tables');
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
