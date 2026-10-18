import type { PinUserDto } from '@shared/types';
import { api } from '../api';
import { SavdoChefIcon } from '../branding';
import { errorMessage, toast } from '../components/toast';
import { t } from '../i18n';
import { initials } from '../layout/shell';
import { appStore } from '../store/app';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import { playClick } from '../ui/sound';
import type { View } from './types';

const MAX_PIN = 4;

/**
 * Lock screen: pick who you are, type your 4-digit PIN on the keypad or keyboard. The lock
 * button in the top bar logs the window out before coming here, so this is a real login, with the
 * same 5-attempt lock as passwords (enforced in main).
 */
export const lockView: View = ({ navigate }) => {
  const el = document.createElement('div');
  el.className = 'auth-page';
  const card = document.createElement('div');
  card.className = 'auth-card lock-card';
  el.append(card);

  let users: PinUserDto[] = [];
  let selected: PinUserDto | null = null;
  let pin = '';
  let busy = false;

  const header = () =>
    html`<div class="auth-brand auth-brand-center">
      ${SavdoChefIcon({ size: 56 })}
      <h1>${appStore.get().receipt?.restaurantName ?? 'SavdoChef'}</h1>
      <p class="muted">${t('lock.title')}</p>
    </div>`;

  const passwordLink = () => {
    const a = document.createElement('a');
    a.href = '#/login';
    a.className = 'lock-alt';
    a.textContent = t('lock.passwordLogin');
    return a;
  };

  const nameOf = (u: PinUserDto) => u.fullName ?? u.username;

  // ── step 1: who ───────────────────────────────────────────────────────────────────────────
  function renderUsers() {
    selected = null;
    pin = '';
    if (users.length === 0) {
      card.replaceChildren(
        header(),
        html`<p class="notice notice-info">${t('lock.noUsers')}</p>`,
        passwordLink(),
      );
      return;
    }
    const tiles = users.map((u) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lock-user';
      b.append(
        html`<span class="avatar avatar-lg" aria-hidden="true">${initials(nameOf(u))}</span
          ><span>${nameOf(u)}</span>`,
      );
      b.addEventListener('click', () => {
        playClick();
        selected = u;
        renderPin();
      });
      return b;
    });
    card.replaceChildren(
      header(),
      html`<h2 class="lock-subtitle">${t('lock.pickUser')}</h2>
        <div class="lock-users">${tiles}</div>`,
      passwordLink(),
    );
    tiles[0]?.focus();
  }

  // ── step 2: PIN ───────────────────────────────────────────────────────────────────────────
  const dots = document.createElement('div');
  dots.className = 'pin-dots';
  dots.setAttribute('aria-hidden', 'true');
  const live = document.createElement('div');
  live.className = 'form-error';
  live.setAttribute('role', 'alert');

  const renderDots = () => {
    dots.replaceChildren(
      ...Array.from({ length: MAX_PIN }, (_, i) => {
        const d = document.createElement('span');
        d.className = `pin-dot${i < pin.length ? ' is-filled' : ''}`;
        return d;
      }),
    );
  };

  const press = (key: string) => {
    if (busy) return;
    if (key === 'back') pin = pin.slice(0, -1);
    else if (key === 'ok') return void submit();
    else if (pin.length < MAX_PIN) pin += key;
    live.textContent = '';
    renderDots();
    if (pin.length === MAX_PIN) void submit();
  };

  async function submit() {
    if (!selected || pin.length !== MAX_PIN || busy) return;
    busy = true;
    try {
      const user = await api.auth.pinLogin({ userId: selected.id, pin });
      const openSession = await api.sessions.getOpen();
      appStore.set({ user, openSession });
      toast(t('login.welcome', { name: user.fullName ?? user.username }), 'success');
      navigate('/tables');
    } catch (error) {
      pin = '';
      renderDots();
      live.textContent = errorMessage(error);
      card.classList.remove('shake');
      void card.offsetWidth; // restart the animation
      card.classList.add('shake');
    } finally {
      busy = false;
    }
  }

  function renderPin() {
    pin = '';
    live.textContent = '';
    renderDots();
    const key = (label: string, value: string, aria?: string, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pin-key ${cls}`;
      b.textContent = label;
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => {
        playClick();
        press(value);
      });
      return b;
    };
    const erase = key('', 'back', t('lock.erase'), 'pin-key-muted');
    erase.append(icon('back', 22));
    const ok = key('', 'ok', t('lock.unlock'), 'pin-key-primary');
    ok.append(icon('check', 24));
    const keys = [
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) =>
        key(d, d, t('lock.digit', { d })),
      ),
      erase,
      key('0', '0', t('lock.digit', { d: '0' })),
      ok,
    ];

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-ghost lock-back';
    back.append(icon('back', 18), document.createTextNode(t('lock.back')));
    back.addEventListener('click', renderUsers);

    card.replaceChildren(
      html`<div class="lock-who">
        <span class="avatar avatar-lg" aria-hidden="true">${initials(nameOf(selected!))}</span>
        <h2>${t('lock.enterPin', { name: nameOf(selected!) })}</h2>
      </div>`,
      dots,
      live,
      html`<div class="pin-pad">${keys}</div>`,
      users.length > 1 ? back : document.createTextNode(''),
      passwordLink(),
    );
    keys[0]?.focus();
  }

  // Physical keyboard: digits, Backspace, Enter; Escape goes back to the user list.
  const onKey = (e: KeyboardEvent) => {
    if (!selected) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') press('ok');
    else if (e.key === 'Escape' && users.length > 1) renderUsers();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  card.append(header());
  void api.auth
    .pinUsers()
    .then((list) => {
      users = list;
      if (users.length === 1) {
        selected = users[0]!;
        renderPin();
      } else renderUsers();
    })
    .catch((error: unknown) => {
      card.replaceChildren(
        header(),
        html`<p class="form-error">${errorMessage(error)}</p>`,
        passwordLink(),
      );
    });

  return {
    el,
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
};
