import { api } from '../../api';
import {
  clearErrors,
  field,
  formError,
  setFieldError,
  showFormError,
  value,
} from '../../components/forms';
import { pageHeader } from '../../components/page';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import type { View } from '../types';

function submitButton(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'submit';
  b.className = 'btn btn-primary';
  b.textContent = label;
  return b;
}

/** Everyone's own account: login name, display name, password. */
export const profileView: View = () => {
  const me = appStore.get().user!;
  const el = document.createElement('section');
  el.className = 'page';

  const account = document.createElement('form');
  account.className = 'card form-card';
  account.noValidate = true;
  account.append(
    html`<h2 class="card-title">${t('profile.account')}</h2>
      ${field({
        name: 'username',
        label: t('users.username'),
        value: me.username,
        autocomplete: 'username',
      })}
      ${field({
        name: 'fullName',
        label: t('users.fullName'),
        value: me.fullName ?? '',
        autocomplete: 'name',
      })}
      ${formError()}${submitButton(t('app.save'))}`,
  );
  account.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(account);
    try {
      const user = await api.users.updateProfile({
        username: value(account, 'username'),
        fullName: value(account, 'fullName') || null,
      });
      appStore.set({ user });
      toast(t('profile.saved'), 'success');
    } catch (error) {
      showFormError(account, error);
    }
  });

  const password = document.createElement('form');
  password.className = 'card form-card';
  password.noValidate = true;
  password.append(
    html`<h2 class="card-title">${t('profile.changePassword')}</h2>
      ${field({
        name: 'currentPassword',
        label: t('profile.currentPassword'),
        type: 'password',
        autocomplete: 'current-password',
      })}
      ${field({
        name: 'newPassword',
        label: t('profile.newPassword'),
        type: 'password',
        autocomplete: 'new-password',
      })}
      ${field({
        name: 'repeat',
        label: t('profile.repeat'),
        type: 'password',
        autocomplete: 'new-password',
      })}
      ${formError()}${submitButton(t('profile.changePassword'))}`,
  );
  const pw = (name: string) => password.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  password.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(password);
    if (pw('newPassword').value !== pw('repeat').value) {
      setFieldError(password, 'repeat', t('errors.passwordsDiffer'));
      return;
    }
    try {
      await api.auth.changePassword({
        currentPassword: pw('currentPassword').value,
        newPassword: pw('newPassword').value,
      });
      password.reset();
      toast(t('profile.passwordChanged'), 'success');
    } catch (error) {
      showFormError(password, error);
    }
  });

  el.append(
    pageHeader(t('profile.title')),
    html`<div class="card-grid">${account}${password}</div>`,
  );
  return { el };
};
