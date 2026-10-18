import { api } from '../api';
import { SavdoChefSquare } from '../branding';
import { field, showFormError, value } from '../components/forms';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { appStore, savePrefs } from '../store/app';
import { html } from '../ui/html';
import type { View } from './types';

export const loginView: View = ({ navigate }) => {
  const { receipt, language } = appStore.get();

  const form = document.createElement('form');
  form.className = 'auth-card';
  form.noValidate = true;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary btn-lg btn-block';
  submit.textContent = t('login.submit');

  const lang = document.createElement('button');
  lang.type = 'button';
  lang.className = 'chip-button auth-lang';
  lang.textContent = language === 'uz' ? 'RU' : 'UZ';
  lang.setAttribute('aria-label', t('nav.language'));
  lang.addEventListener('click', () => {
    const next = appStore.get().language === 'uz' ? 'ru' : 'uz';
    appStore.set({ language: next });
    savePrefs({ language: next });
  });

  form.append(
    html`${lang}
      <div class="auth-brand auth-brand-center">
        ${SavdoChefSquare({ size: 96 })}
        <h1>${receipt?.restaurantName ?? 'SavdoChef'}</h1>
        <p class="muted">${t('login.title')}</p>
      </div>
      ${field({
        name: 'username',
        label: t('login.username'),
        required: true,
        autocomplete: 'username',
      })}
      ${field({
        name: 'password',
        label: t('login.password'),
        type: 'password',
        required: true,
        autocomplete: 'current-password',
      })}
      <div class="form-error" role="alert"></div>
      ${submit}`,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const user = await api.auth.login({
        username: value(form, 'username'),
        password: form.querySelector<HTMLInputElement>('[name="password"]')!.value,
      });
      const openSession = await api.sessions.getOpen();
      appStore.set({ user, openSession });
      toast(t('login.welcome', { name: user.fullName ?? user.username }), 'success');
      navigate('/tables');
    } catch (error) {
      showFormError(form, error);
      const pw = form.querySelector<HTMLInputElement>('[name="password"]')!;
      pw.value = '';
      pw.focus();
    } finally {
      submit.disabled = false;
    }
  });

  const page = document.createElement('div');
  page.className = 'auth-page';
  page.append(form);
  return { el: page };
};
