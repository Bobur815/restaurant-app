import { api } from '../../api';
import { clearErrors, field, formError, showFormError, value } from '../../components/forms';
import { pageHeader } from '../../components/page';
import { phoneField } from '../../components/phone-field';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import type { View } from '../types';

/**
 * Everyone's own account: name and phone. The PIN is set by whoever manages users (so nobody
 * finds another's PIN by trying to choose it: PINs are unique).
 */
export const profileView: View = () => {
  const me = appStore.get().user!;
  const el = document.createElement('section');
  el.className = 'page';

  const phone = phoneField({ name: 'phone', label: t('users.phone'), value: me.phone });
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  submit.textContent = t('app.save');

  const account = document.createElement('form');
  account.className = 'card form-card';
  account.noValidate = true;
  account.append(
    html`<h2 class="card-title">${t('profile.account')}</h2>
      ${field({
        name: 'fullName',
        label: t('users.fullName'),
        value: me.fullName,
        autocomplete: 'name',
      })}
      ${phone.el}
      <p class="muted small">${t('profile.pinHint')}</p>
      ${formError()}${submit}`,
  );
  account.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(account);
    submit.disabled = true;
    try {
      const user = await api.users.updateProfile({
        fullName: value(account, 'fullName'),
        phone: phone.input.value,
      });
      appStore.set({ user });
      toast(t('profile.saved'), 'success');
    } catch (error) {
      showFormError(account, error);
    } finally {
      submit.disabled = false;
    }
  });

  el.append(pageHeader(t('profile.title')), html`<div class="card-grid">${account}</div>`);
  return { el };
};
