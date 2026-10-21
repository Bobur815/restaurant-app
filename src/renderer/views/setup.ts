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
import { linkRestaurant } from '../components/link-restaurant';
import type { View } from './types';

/**
 * First run, in two steps:
 * 1. link the till to its restaurant on the posgro server (feature F5; needs internet once): a new
 *    restaurant signs up and starts its trial, an existing one uses an activation code;
 * 2. the first administrator (name, phone, login PIN) and the receipt details. Ends by showing
 *    the owner's recovery code once.
 * Main refuses step 2 until step 1 is done (license-core.ts), whatever this page shows.
 */
export const setupView: View = (ctx) => {
  const page = document.createElement('div');
  page.className = 'auth-page';
  let link: { destroy(): void } | null = null;

  const showDetails = () => {
    link?.destroy();
    page.replaceChildren(setupDetails(ctx).el);
  };

  const license = appStore.get().license;
  if (license && !license.linked && license.mode === 'setup') {
    const card = document.createElement('div');
    card.className = 'auth-card auth-card-wide';
    const linker = linkRestaurant({
      onLinked: (status) => {
        appStore.set({ license: status });
        toast(t('license.linked', { name: status.storeName ?? '' }), 'success');
        showDetails();
      },
    });
    link = linker;
    card.append(
      html`<div class="auth-brand">
        ${SavdoChefSquare({ size: 72 })}
        <div>
          <h1>${t('license.linkTitle')}</h1>
          <p class="muted">${t('license.linkSubtitle')}</p>
        </div>
      </div>`,
      linker.el,
    );
    page.append(card);
  } else {
    showDetails();
  }
  return { el: page, destroy: () => link?.destroy() };
};

/** Step 2: the first administrator and the receipt details. */
const setupDetails: View = ({ navigate }) => {
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
            value: appStore.get().license?.storeName ?? '',
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

  return { el: form };
};
