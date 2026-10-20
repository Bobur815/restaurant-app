import { hasPermission } from '@shared/permissions';
import type { AdminChoiceDto, CurrentUser } from '@shared/types';
import { api, isApiError } from '../api';
import { SavdoChefIcon } from '../branding';
import {
  clearErrors,
  field,
  formError,
  selectField,
  showFormError,
  value,
} from '../components/forms';
import { pinField, pinsMatch } from '../components/pin-field';
import { showRecoveryCode } from '../components/recovery-code';
import { errorMessage, toast } from '../components/toast';
import { t } from '../i18n';
import { homeFor } from '../router/routes';
import { appStore, savePrefs } from '../store/app';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import { playClick } from '../ui/sound';
import type { View } from './types';

import { PIN_LENGTH } from '../components/pin-field';

/**
 * Login (and the lock screen): the 4-digit PIN alone says who logs in. Typed on the keypad or
 * the keyboard. Five wrong PINs lock the keypad for this till (kept in main, survives restarts).
 *
 * Two other ways in: the owner's recovery code (forgotten admin PIN), and, once after an upgrade
 * from a version without PIN login, setting the first administrator PIN.
 */
export const loginView: View = ({ navigate }) => {
  const { receipt, language } = appStore.get();
  const page = document.createElement('div');
  page.className = 'auth-page';
  const card = document.createElement('div');
  card.className = 'auth-card lock-card';
  page.append(card);

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

  const brand = (subtitle: string) =>
    html`<div class="auth-brand auth-brand-center">
      ${SavdoChefIcon({ size: 56 })}
      <h1>${receipt?.restaurantName ?? 'SavdoChef'}</h1>
      <p class="muted">${subtitle}</p>
    </div>`;

  const linkButton = (text: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost lock-alt';
    b.textContent = text;
    b.addEventListener('click', () => {
      playClick();
      onClick();
    });
    return b;
  };

  async function enter(user: CurrentUser, recoveryCode?: string) {
    if (recoveryCode) await showRecoveryCode(recoveryCode);
    const openSession = await api.sessions.getOpen();
    appStore.set({ user, openSession });
    toast(t('login.welcome', { name: user.fullName }), 'success');
    navigate(homeFor(user));
    // An upgraded install has no recovery code yet: remind whoever can make one.
    if (!recoveryCode && hasPermission(user, 'users')) {
      const status = await api.auth.recoveryStatus().catch(() => ({ hasCode: true }));
      if (!status.hasCode) toast(t('recovery.noCode'), 'error');
    }
  }

  // ── keypad ───────────────────────────────────────────────────────────────────────────────
  let pin = '';
  let busy = false;
  let keypadShown = false;
  let unlockTimer: number | undefined;
  const dots = document.createElement('div');
  dots.className = 'pin-dots';
  dots.setAttribute('aria-hidden', 'true');
  const live = document.createElement('div');
  live.className = 'form-error';
  live.setAttribute('role', 'alert');
  const pad = document.createElement('div');
  pad.className = 'pin-pad';

  const renderDots = () =>
    dots.replaceChildren(
      ...Array.from({ length: PIN_LENGTH }, (_, i) => {
        const d = document.createElement('span');
        d.className = `pin-dot${i < pin.length ? ' is-filled' : ''}`;
        return d;
      }),
    );

  const setLocked = (until: Date | null) => {
    window.clearTimeout(unlockTimer);
    const locked = until !== null && until.getTime() > Date.now();
    pad.querySelectorAll('button').forEach((b) => (b.disabled = locked));
    if (locked) {
      unlockTimer = window.setTimeout(() => {
        live.textContent = '';
        setLocked(null);
      }, until.getTime() - Date.now());
    }
  };

  const shake = () => {
    card.classList.remove('shake');
    void card.offsetWidth; // restart the animation
    card.classList.add('shake');
  };

  async function submit() {
    if (pin.length !== PIN_LENGTH || busy) return;
    busy = true;
    try {
      await enter(await api.auth.pinLogin({ pin }));
    } catch (error) {
      pin = '';
      renderDots();
      let message = errorMessage(error);
      if (isApiError(error, 'NOT_AUTHENTICATED')) {
        const left = (error.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
        if (left !== undefined) message += ` ${t('login.attemptsLeft', { n: left })}`;
      }
      if (isApiError(error, 'LOCKED')) {
        const until = (error.details as { lockedUntil?: string } | undefined)?.lockedUntil;
        if (until) setLocked(new Date(until));
      }
      live.textContent = message;
      shake();
    } finally {
      busy = false;
    }
  }

  const press = (key: string) => {
    if (busy) return;
    if (key === 'back') pin = pin.slice(0, -1);
    else if (key === 'ok') return void submit();
    else if (pin.length < PIN_LENGTH) pin += key;
    if (key !== 'back' || pin.length === 0) live.textContent = '';
    renderDots();
    if (pin.length === PIN_LENGTH) void submit();
  };

  const key = (label: string, keyValue: string, aria: string, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pin-key ${cls}`;
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => {
      playClick();
      press(keyValue);
    });
    return b;
  };
  const erase = key('', 'back', t('lock.erase'), 'pin-key-muted');
  erase.append(icon('back', 22));
  const ok = key('', 'ok', t('lock.unlock'), 'pin-key-primary');
  ok.append(icon('check', 24));
  pad.append(
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d, t('lock.digit', { d }))),
    erase,
    key('0', '0', t('lock.digit', { d: '0' })),
    ok,
  );

  function renderKeypad() {
    keypadShown = true;
    pin = '';
    renderDots();
    card.replaceChildren(
      lang,
      brand(t('login.enterPin')),
      dots,
      live,
      pad,
      linkButton(t('login.forgotPin'), renderRecover),
    );
    pad.querySelector('button')?.focus();
  }

  // Physical keyboard: digits, Backspace, Enter (only while the keypad is on screen).
  const onKey = (e: KeyboardEvent) => {
    if (!keypadShown || document.querySelector('dialog[open]')) return;
    if (pad.querySelector('button')?.disabled) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') press('ok');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  // ── forgotten PIN: the owner's recovery code ────────────────────────────────────────────
  function renderRecover() {
    keypadShown = false;
    const form = document.createElement('form');
    form.noValidate = true;
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'btn btn-primary btn-lg btn-block';
    submitButton.textContent = t('recovery.submit');
    form.append(
      html`<p class="muted auth-hint">${t('recovery.hint')}</p>
        ${field({ name: 'code', label: t('recovery.code'), required: true, autocomplete: 'off' })}
        ${pinField('pin', t('recovery.newPin'))} ${pinField('pinRepeat', t('recovery.pinRepeat'))}
        ${formError()} ${submitButton}`,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      if (!pinsMatch(form, 'pin', 'pinRepeat')) return;
      submitButton.disabled = true;
      try {
        const result = await api.auth.recover({
          code: value(form, 'code'),
          pin: value(form, 'pin'),
        });
        await enter(result.user, result.recoveryCode);
      } catch (error) {
        showFormError(form, error);
      } finally {
        submitButton.disabled = false;
      }
    });
    card.replaceChildren(
      lang,
      brand(t('recovery.title')),
      form,
      linkButton(t('recovery.back'), renderKeypad),
    );
    form.querySelector<HTMLInputElement>('[name="code"]')?.focus();
  }

  // ── first administrator PIN (upgrade from a version without PIN login) ──────────────────
  function renderBootstrap(admins: AdminChoiceDto[]) {
    keypadShown = false;
    const form = document.createElement('form');
    form.noValidate = true;
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'btn btn-primary btn-lg btn-block';
    submitButton.textContent = t('bootstrap.submit');
    form.append(
      html`<p class="notice notice-info">${icon('lock')}<span>${t('bootstrap.hint')}</span></p>
        ${selectField({
          name: 'userId',
          label: t('bootstrap.admin'),
          options: admins.map((a) => ({ value: String(a.id), label: a.fullName })),
        })}
        ${pinField('pin', t('bootstrap.pin'))} ${pinField('pinRepeat', t('recovery.pinRepeat'))}
        ${formError()} ${submitButton}`,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      if (!pinsMatch(form, 'pin', 'pinRepeat')) return;
      submitButton.disabled = true;
      try {
        const result = await api.auth.bootstrapPin({
          userId: Number(value(form, 'userId')),
          pin: value(form, 'pin'),
        });
        await enter(result.user, result.recoveryCode);
      } catch (error) {
        showFormError(form, error);
      } finally {
        submitButton.disabled = false;
      }
    });
    card.replaceChildren(lang, brand(t('bootstrap.title')), form);
  }

  void api.auth
    .bootstrapStatus()
    .catch(() => ({ needed: false, admins: [] as AdminChoiceDto[] }))
    .then((status) => {
      if (status.needed && status.admins.length > 0) renderBootstrap(status.admins);
      else renderKeypad();
    });

  return {
    el: page,
    destroy() {
      window.clearTimeout(unlockTimer);
      document.removeEventListener('keydown', onKey);
    },
  };
};
