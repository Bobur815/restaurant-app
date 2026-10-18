import { api, isApiError } from '../../api';
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

  // ── PIN code for the lock screen ─────────────────────────────────────────────────────────
  const pinForm = document.createElement('form');
  pinForm.className = 'card form-card';
  pinForm.noValidate = true;
  const pinState = document.createElement('p');
  pinState.className = 'badge badge-muted';
  const removePin = document.createElement('button');
  removePin.type = 'button';
  removePin.className = 'btn btn-danger-ghost';
  removePin.textContent = t('profile.removePin');
  const savePin = submitButton(t('profile.savePin'));
  pinForm.append(
    html`<h2 class="card-title">${t('profile.pinTitle')}</h2>
      ${pinState}
      <p class="muted small">${t('profile.pinHint')}</p>
      ${field({
        name: 'pinPassword',
        label: t('profile.currentPassword'),
        type: 'password',
        autocomplete: 'current-password',
      })}
      <div class="form-row">
        ${field({
          name: 'pin',
          label: t('profile.newPin'),
          type: 'password',
          inputmode: 'numeric',
          autocomplete: 'off',
        })}
        ${field({
          name: 'pinRepeat',
          label: t('profile.repeatPin'),
          type: 'password',
          inputmode: 'numeric',
          autocomplete: 'off',
        })}
      </div>
      ${formError()}
      <div class="bulk-actions">${savePin}${removePin}</div>`,
  );
  for (const name of ['pin', 'pinRepeat']) {
    const input = pinForm.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    input.maxLength = 4;
    input.pattern = '[0-9]*';
  }
  const pinField = (name: string) => pinForm.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const showPinState = (hasPin: boolean) => {
    pinState.textContent = t(hasPin ? 'profile.pinSet' : 'profile.pinNotSet');
    pinState.className = `badge ${hasPin ? 'badge-success' : 'badge-muted'}`;
    removePin.hidden = !hasPin;
  };
  const sendPin = async (pin: string | null) => {
    clearErrors(pinForm);
    if (pin !== null && pin !== pinField('pinRepeat').value) {
      setFieldError(pinForm, 'pinRepeat', t('profile.pinsDiffer'));
      return;
    }
    try {
      const result = await api.auth.setPin({ currentPassword: pinField('pinPassword').value, pin });
      pinForm.reset();
      showPinState(result.hasPin);
      toast(t(result.hasPin ? 'profile.pinSaved' : 'profile.pinRemoved'), 'success');
    } catch (error) {
      showFormError(pinForm, error);
      // The server reports a bad password as field `currentPassword`; show it on this form's field.
      if (
        isApiError(error) &&
        (error.details as { field?: string } | undefined)?.field === 'currentPassword'
      ) {
        setFieldError(pinForm, 'pinPassword', error.message);
      }
    }
  };
  pinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void sendPin(pinField('pin').value);
  });
  removePin.addEventListener('click', () => void sendPin(null));
  showPinState(false);
  void api.auth
    .pinStatus()
    .then((s) => showPinState(s.hasPin))
    .catch(() => undefined);

  el.append(
    pageHeader(t('profile.title')),
    html`<div class="card-grid">${account}${password}${pinForm}</div>`,
  );
  return { el };
};
