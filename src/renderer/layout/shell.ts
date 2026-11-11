import { api } from '../api';
import { SavdoChefIcon } from '../branding';
import { canPayBill, payBillModal } from '../components/pay-bill';
import { t } from '../i18n';
import type { ShellInstance } from '../router/router';
import { canAccess, homeFor, type Access } from '../router/routes';
import { appStore, can, licensed, savePrefs, updatePending, type ThemeChoice } from '../store/app';
import type { LicenseFeature, LicenseStatusDto } from '@shared/license';
import { html, refs } from '../ui/html';
import { icon, type IconName } from '../ui/icons';
import { playClick } from '../ui/sound';
import { formatLongDate, formatTime } from '../utils/format';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Same as the route's access in main.ts: a link is shown only to who may open the page. */
  access: Access;
  /** Same as the route's plan feature: hidden while the plan does not include it. */
  feature?: LicenseFeature;
}

// Till screens first (legacy order: Buyurtma is the main screen), back office in its own group.
const MAIN_NAV: NavItem[] = [
  { path: '/tables', label: 'nav.tables', icon: 'tables', access: 'orders' },
  { path: '/sessions', label: 'nav.sessions', icon: 'sessions', access: 'user' },
  { path: '/checks', label: 'nav.checks', icon: 'checks', access: 'checks' },
  { path: '/debtors', label: 'nav.debtors', icon: 'debt', access: 'debt', feature: 'debt' },
];
const ADMIN_NAV: NavItem[] = [
  { path: '/menu', label: 'nav.menu', icon: 'menu', access: 'menu' },
  { path: '/reports', label: 'nav.reports', icon: 'reports', access: 'reports' },
  { path: '/settings', label: 'nav.settings', icon: 'settings', access: ['settings', 'users'] },
];

const THEME_ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemeChoice, IconName> = {
  system: 'system',
  light: 'light',
  dark: 'dark',
};
const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'nav.themeSystem',
  light: 'nav.themeLight',
  dark: 'nav.themeDark',
};

/** "Bobur Ergashev" -> "BE", "owner" -> "OW". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The licence banner over every page (feature F5), or null when there is nothing to say. */
export function licenseBannerText(
  s: LicenseStatusDto | null,
  now = Date.now(),
): { text: string; readonly: boolean } | null {
  if (!s || s.mode === 'setup') return null;
  const n = s.daysLeft ?? 0;
  if (s.mode === 'readonly') return { text: t(`license.banner.${s.reason}`), readonly: true };
  if (s.reason === 'warning' || s.reason === 'grace' || s.reason === 'unlinked-allowance') {
    return { text: t(`license.banner.${s.reason}`, { n }), readonly: false };
  }
  if (s.reason === 'trial' && n <= 3)
    return { text: t('license.banner.trial', { n }), readonly: false };
  if (s.checkinBy) {
    const days = Math.ceil((Date.parse(s.checkinBy) - now) / DAY_MS);
    if (days <= 3)
      return { text: t('license.banner.checkin-soon', { n: Math.max(0, days) }), readonly: false };
  }
  return null;
}

function label(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'nav-label';
  span.textContent = text;
  return span;
}

/**
 * App frame. The top bar spans the window: brand, clock, status and the account controls (pages
 * menu, user, logout); the page takes everything below it. The pages are a drop-down under the
 * gear button next to the profile: it closes on a choice, Escape, or a tap outside.
 */
export function createShell(navigate: (path: string) => void): ShellInstance {
  const user = appStore.get().user!;

  const link = (item: NavItem) => {
    const a = document.createElement('a');
    a.href = `#${item.path}`;
    a.className = 'nav-link';
    a.dataset['path'] = item.path;
    if (item.feature) a.dataset['feature'] = item.feature;
    a.setAttribute('aria-label', t(item.label));
    a.append(icon(item.icon), label(t(item.label)));
    a.addEventListener('click', () => {
      playClick();
      closeMenu();
    });
    return a;
  };
  const allowed = (item: NavItem) => canAccess(user, item.access);
  const mainLinks = MAIN_NAV.filter(allowed).map(link);
  const adminLinks = ADMIN_NAV.filter(allowed).map(link);
  const navLinks = [...mainLinks, ...adminLinks];

  const section = (title: string, links: HTMLAnchorElement[]) =>
    links.length
      ? html`<div class="nav-section">
          <span class="nav-section-title"><span>${title}</span></span>
          ${links}
        </div>`
      : '';

  const iconButton = (name: IconName, text: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button';
    b.setAttribute('aria-label', text);
    b.title = text;
    b.append(icon(name));
    return b;
  };

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'icon-button nav-menu-button';
  menuButton.setAttribute('aria-controls', 'app-nav-menu');
  menuButton.append(icon('settings'));

  const logout = iconButton('logout', t('nav.logout'));
  const themeButton = document.createElement('button');
  themeButton.type = 'button';
  themeButton.className = 'icon-button';
  const langButton = document.createElement('button');
  langButton.type = 'button';
  langButton.className = 'chip-button';

  const el = document.createElement('div');
  el.className = 'shell';
  el.append(
    html`<header class="topbar">
        <a class="topbar-brand" href="#${homeFor(user)}" aria-label="SavdoChef">
          ${SavdoChefIcon({ size: 40 })}
          <span class="brand-text">
            <span class="brand-name">SavdoChef</span>
            <span class="brand-sub" data-ref="restaurant"></span>
          </span>
        </a>
        <div class="topbar-center">
          <span class="clock" data-ref="clock"></span>
          <span class="date" data-ref="date"></span>
        </div>
        <div class="topbar-right">
          <a class="badge badge-warning" href="#/checks" data-ref="fiscal" hidden></a>
          <span class="badge" data-ref="shift"></span>
          ${langButton}${themeButton}
          <span class="topbar-divider" aria-hidden="true"></span>
          <div class="nav-menu-wrap">
            ${menuButton}
            <nav class="nav-menu" id="app-nav-menu" aria-label="${t('nav.menuToggle')}" hidden>
              ${section(t('nav.sectionMain'), mainLinks)}
              ${section(t('nav.sectionAdmin'), adminLinks)}
            </nav>
          </div>
          <a class="topbar-user" href="#/profile" data-ref="profile">
            <span class="avatar" data-ref="avatar" aria-hidden="true"></span>
            <span class="user-text">
              <span class="user-name" data-ref="userName"></span>
              <span class="user-role" data-ref="userRole"></span>
            </span>
          </a>
          ${logout}
        </div>
      </header>
      <div class="shell-main">
        <div class="license-banner" data-ref="licenseBanner" role="status" hidden></div>
        <main class="outlet" data-ref="outlet" tabindex="-1"></main>
      </div>`,
  );

  const menuWrap = el.querySelector<HTMLElement>('.nav-menu-wrap')!;
  const menu = el.querySelector<HTMLElement>('.nav-menu')!;
  const isOpen = () => !menu.hidden;
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    const text = t(open ? 'nav.menuClose' : 'nav.menuOpen');
    menuButton.setAttribute('aria-label', text);
    menuButton.title = text;
  };
  setOpen(false);
  menuButton.addEventListener('click', () => {
    playClick();
    setOpen(!isOpen());
    if (isOpen())
      (
        menu.querySelector<HTMLElement>('.nav-link.active') ??
        menu.querySelector<HTMLElement>('.nav-link')
      )?.focus();
  });
  // A tap anywhere else closes it (the button toggles by itself).
  const onPointer = (e: PointerEvent) => {
    if (isOpen() && !menuWrap.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onPointer);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen() || document.querySelector('dialog[open]')) return;
    setOpen(false);
    menuButton.focus();
  };
  document.addEventListener('keydown', onKey);
  // Focus leaving the menu (Tab past the last link) closes it.
  menuWrap.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (isOpen() && next && !menuWrap.contains(next)) setOpen(false);
  });
  function closeMenu() {
    setOpen(false);
  }

  const r = refs<{
    outlet: HTMLElement;
    licenseBanner: HTMLElement;
    clock: HTMLElement;
    date: HTMLElement;
    shift: HTMLElement;
    fiscal: HTMLElement;
    restaurant: HTMLElement;
    profile: HTMLElement;
    avatar: HTMLElement;
    userName: HTMLElement;
    userRole: HTMLElement;
  }>(el);

  const tick = () => {
    const now = new Date();
    r.clock.textContent = formatTime(now);
    r.date.textContent = formatLongDate(now, appStore.get().language);
  };
  tick();
  const timer = window.setInterval(tick, 15_000);

  const renderState = () => {
    const s = appStore.get();
    r.restaurant.textContent = s.receipt?.restaurantName ?? '';
    if (s.user) {
      const name = s.user.fullName;
      r.userName.textContent = name;
      r.userRole.textContent = t(`nav.role${s.user.role}`);
      r.avatar.textContent = initials(name);
      r.profile.setAttribute('aria-label', `${t('profile.title')}: ${name}`);
    }
    const open = !!s.openSession;
    r.shift.textContent = t(open ? 'nav.shiftOpen' : 'nav.shiftClosed');
    r.shift.className = `badge ${open ? 'badge-success' : 'badge-muted'}`;
    // Feature F18: paid checks VCR has not registered yet (main checks it all again).
    const waiting = s.fiscal?.enabled ? s.fiscal.pending + s.fiscal.failed : 0;
    r.fiscal.hidden = waiting === 0;
    r.fiscal.textContent = t('fiscal.topbar', { count: waiting });
    r.fiscal.title = t('fiscal.topbarHint');
    r.fiscal.className = `badge ${s.fiscal?.failed ? 'badge-danger' : 'badge-warning'}`;
    const banner = licenseBannerText(s.license);
    r.licenseBanner.hidden = !banner;
    if (banner) {
      r.licenseBanner.classList.toggle('is-readonly', banner.readonly);
      const more = can('settings')
        ? Object.assign(document.createElement('a'), {
            href: '#/settings/subscription',
            textContent: t('license.banner.open'),
          })
        : Object.assign(document.createElement('span'), {
            textContent: t('license.banner.askAdmin'),
          });
      // Paying is what ends a warning, grace or unpaid block: offer it right here (feature F7).
      const lic = s.license;
      const payable =
        can('settings') &&
        canPayBill(lic) &&
        (lic?.reason === 'warning' || lic?.reason === 'grace' || lic?.reason === 'blocked');
      const pay = payable
        ? Object.assign(document.createElement('button'), {
            type: 'button',
            className: 'license-banner-pay',
            textContent: t('bill.pay'),
            onclick: () => lic && payBillModal(lic),
          })
        : null;
      r.licenseBanner.replaceChildren(
        Object.assign(document.createElement('span'), { textContent: banner.text }),
        ...(pay ? [pay] : []),
        more,
      );
    }
    // The licence can change while signed in (plan bought or expired): hide what it leaves out.
    for (const a of navLinks) {
      const feature = a.dataset['feature'] as LicenseFeature | undefined;
      a.hidden = !!feature && !licensed(feature);
    }
    langButton.textContent = s.language === 'uz' ? 'UZ' : 'RU';
    langButton.setAttribute('aria-label', `${t('nav.language')}: ${langButton.textContent}`);
    themeButton.replaceChildren(icon(THEME_ICON[s.theme]));
    const themeLabel = `${t('nav.theme')}: ${t(THEME_LABEL[s.theme])}`;
    themeButton.setAttribute('aria-label', themeLabel);
    themeButton.title = themeLabel;
    // A dot on Settings, and on the button that opens the menu, while a newer version of the app
    // waits (only set for who may update).
    const settingsLink = navLinks.find((a) => a.dataset['path'] === '/settings');
    settingsLink?.classList.toggle('has-dot', updatePending());
    menuButton.classList.toggle('has-dot', !!settingsLink && updatePending());
  };
  renderState();
  const unsubscribe = appStore.subscribe(renderState);

  langButton.addEventListener('click', () => {
    const language = appStore.get().language === 'uz' ? 'ru' : 'uz';
    appStore.set({ language });
    savePrefs({ language });
  });
  themeButton.addEventListener('click', () => {
    const s = appStore.get();
    const theme = THEME_ORDER[(THEME_ORDER.indexOf(s.theme) + 1) % THEME_ORDER.length]!;
    appStore.set({ theme });
    savePrefs({ theme });
  });
  logout.addEventListener('click', async () => {
    await api.auth.logout().catch(() => undefined);
    appStore.set({ user: null, openSession: undefined });
    navigate('/login');
  });

  return {
    el,
    outlet: r.outlet,
    update(path) {
      for (const a of navLinks) {
        const active = path === a.dataset['path'] || path.startsWith(`${a.dataset['path']}/`);
        a.classList.toggle('active', active);
        if (active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      r.profile.classList.toggle('active', path === '/profile');
      setOpen(false);
    },
    destroy() {
      window.clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      unsubscribe();
    },
  };
}
