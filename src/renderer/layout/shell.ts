import { api } from '../api';
import { SavdoChefIcon } from '../branding';
import { canPayBill, payBillModal } from '../components/pay-bill';
import { t } from '../i18n';
import type { ShellInstance } from '../router/router';
import { canAccess, homeFor, type Access } from '../router/routes';
import { appStore, can, savePrefs, updatePending, type ThemeChoice } from '../store/app';
import type { LicenseStatusDto } from '@shared/license';
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
}

// Till screens first (legacy order: Buyurtma is the main screen), back office in its own group.
const MAIN_NAV: NavItem[] = [
  { path: '/tables', label: 'nav.tables', icon: 'tables', access: 'orders' },
  { path: '/sessions', label: 'nav.sessions', icon: 'sessions', access: 'user' },
  { path: '/checks', label: 'nav.checks', icon: 'checks', access: 'checks' },
  { path: '/debtors', label: 'nav.debtors', icon: 'debt', access: 'debt' },
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

const HOVER_INTENT_MS = 120;
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
  span.className = 'sidebar-label';
  span.textContent = text;
  return span;
}

/**
 * App frame. The top bar spans the window: brand, clock, status and the account controls (user,
 * logout). Below it, the sidebar is a 72 px icon rail that opens as a drawer over the page
 * (never over the top bar): on hover, on keyboard focus, or pinned with the hamburger button.
 * Each link keeps its name as aria-label, since the label text is hidden while the rail is closed.
 */
export function createShell(navigate: (path: string) => void): ShellInstance {
  const user = appStore.get().user!;

  const link = (item: NavItem) => {
    const a = document.createElement('a');
    a.href = `#${item.path}`;
    a.className = 'nav-link';
    a.dataset['path'] = item.path;
    a.setAttribute('aria-label', t(item.label));
    a.append(icon(item.icon), label(t(item.label)));
    a.addEventListener('click', () => {
      playClick();
      closeDrawer();
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

  const hamburger = document.createElement('button');
  hamburger.type = 'button';
  hamburger.className = 'nav-link sidebar-hamburger';
  hamburger.setAttribute('aria-controls', 'app-sidebar-panel');
  hamburger.append(icon('hamburger'), label(t('nav.menuToggle')));

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
          <span class="badge" data-ref="shift"></span>
          ${langButton}${themeButton}
          <span class="topbar-divider" aria-hidden="true"></span>
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
      <nav class="sidebar" aria-label="SavdoChef">
        <div class="sidebar-panel" id="app-sidebar-panel">
          ${hamburger}
          <div class="sidebar-nav">
            ${section(t('nav.sectionMain'), mainLinks)}
            ${section(t('nav.sectionAdmin'), adminLinks)}
          </div>
        </div>
      </nav>
      <div class="shell-main">
        <div class="license-banner" data-ref="licenseBanner" role="status" hidden></div>
        <main class="outlet" data-ref="outlet" tabindex="-1"></main>
      </div>`,
  );

  // The drawer opens three ways: hover (after a short intent pause, so a pointer passing over the
  // rail does not flash it; JS, because reduced-motion settings switch CSS delays off), keyboard
  // focus (CSS :has(:focus-visible)), or pinned with the hamburger (stays until toggled, Escape,
  // or a page is chosen).
  const sidebar = el.querySelector<HTMLElement>('.sidebar')!;
  let openTimer: number | undefined;
  let pinned = false;
  const setPinned = (value: boolean) => {
    pinned = value;
    sidebar.classList.toggle('is-pinned', value);
    hamburger.setAttribute('aria-expanded', String(value));
    hamburger.setAttribute('aria-label', t(value ? 'nav.menuClose' : 'nav.menuOpen'));
    hamburger.title = t(value ? 'nav.menuClose' : 'nav.menuOpen');
  };
  setPinned(false);
  hamburger.addEventListener('click', () => {
    playClick();
    setPinned(!pinned);
  });
  sidebar.addEventListener('mouseenter', () => {
    window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => sidebar.classList.add('is-open'), HOVER_INTENT_MS);
  });
  sidebar.addEventListener('mouseleave', () => {
    window.clearTimeout(openTimer);
    sidebar.classList.remove('is-open');
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && pinned && !document.querySelector('dialog[open]')) {
      // Close and hand focus to the page: focus left inside the rail would keep it open.
      closeDrawer();
      r.outlet.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  // After choosing a destination, close and drop any focus inside the drawer.
  function closeDrawer() {
    window.clearTimeout(openTimer);
    sidebar.classList.remove('is-open');
    setPinned(false);
    if (sidebar.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  const r = refs<{
    outlet: HTMLElement;
    licenseBanner: HTMLElement;
    clock: HTMLElement;
    date: HTMLElement;
    shift: HTMLElement;
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
    langButton.textContent = s.language === 'uz' ? 'UZ' : 'RU';
    langButton.setAttribute('aria-label', `${t('nav.language')}: ${langButton.textContent}`);
    themeButton.replaceChildren(icon(THEME_ICON[s.theme]));
    const themeLabel = `${t('nav.theme')}: ${t(THEME_LABEL[s.theme])}`;
    themeButton.setAttribute('aria-label', themeLabel);
    themeButton.title = themeLabel;
    // A dot on Settings while a newer version of the app waits (only set for who may update).
    navLinks
      .find((a) => a.dataset['path'] === '/settings')
      ?.classList.toggle('has-dot', updatePending());
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
    },
    destroy() {
      window.clearInterval(timer);
      window.clearTimeout(openTimer);
      document.removeEventListener('keydown', onKey);
      unsubscribe();
    },
  };
}
