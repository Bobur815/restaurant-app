import { api } from '../api';
import { SavdoChefIcon } from '../branding';
import { t } from '../i18n';
import type { ShellInstance } from '../router/router';
import { isAdmin } from '../router/routes';
import { appStore, savePrefs, type ThemeChoice } from '../store/app';
import { html, refs } from '../ui/html';
import { icon, type IconName } from '../ui/icons';
import { playClick } from '../ui/sound';
import { formatLongDate, formatTime } from '../utils/format';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  admin?: boolean;
}

// Legacy sidebar order: Buyurtma first (the till's main screen), then the back office.
const NAV: NavItem[] = [
  { path: '/tables', label: 'nav.tables', icon: 'tables' },
  { path: '/sessions', label: 'nav.sessions', icon: 'sessions' },
  { path: '/checks', label: 'nav.checks', icon: 'checks' },
  { path: '/menu', label: 'nav.menu', icon: 'menu', admin: true },
  { path: '/reports', label: 'nav.reports', icon: 'reports', admin: true },
  { path: '/users', label: 'nav.users', icon: 'users', admin: true },
  { path: '/settings', label: 'nav.settings', icon: 'settings', admin: true },
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

export function createShell(navigate: (path: string) => void): ShellInstance {
  const state = appStore.get();
  const user = state.user!;
  const items = NAV.filter((n) => !n.admin || isAdmin(user.role));

  const navLinks = items.map((item) => {
    const a = document.createElement('a');
    a.href = `#${item.path}`;
    a.className = 'nav-link';
    a.dataset['path'] = item.path;
    a.append(
      icon(item.icon),
      Object.assign(document.createElement('span'), { textContent: t(item.label) }),
    );
    a.addEventListener('click', () => playClick());
    return a;
  });

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'nav-link nav-logout';
  logout.append(
    icon('logout'),
    Object.assign(document.createElement('span'), { textContent: t('nav.logout') }),
  );

  const themeButton = document.createElement('button');
  themeButton.type = 'button';
  themeButton.className = 'icon-button';
  const langButton = document.createElement('button');
  langButton.type = 'button';
  langButton.className = 'chip-button';

  const sidebarToggle = document.createElement('button');
  sidebarToggle.type = 'button';
  sidebarToggle.className = 'icon-button sidebar-toggle';
  sidebarToggle.setAttribute('aria-controls', 'app-sidebar');

  const brandIcon = SavdoChefIcon({ size: 36 });
  const el = document.createElement('div');
  el.className = 'shell';
  el.append(
    html`<header class="topbar">
        ${sidebarToggle}
        <div class="brand">
          ${brandIcon}
          <div class="brand-text">
            <span class="brand-name">SavdoChef</span>
            <span class="brand-sub" data-ref="restaurant"></span>
          </div>
        </div>
        <div class="topbar-center">
          <span class="clock" data-ref="clock"></span>
          <span class="date" data-ref="date"></span>
        </div>
        <div class="topbar-right">
          <span class="badge" data-ref="shift"></span>
          ${langButton}${themeButton}
          <span class="user-chip">
            <span class="user-name">${user.fullName ?? user.username}</span>
            <span class="user-role">${t(`nav.role${user.role}`)}</span>
          </span>
        </div>
      </header>
      <nav class="sidebar" id="app-sidebar" aria-label="SavdoChef">
        <div class="nav-list">${navLinks}</div>
        ${logout}
      </nav>
      <main class="outlet" data-ref="outlet" tabindex="-1"></main>`,
  );
  const r = refs<{
    outlet: HTMLElement;
    clock: HTMLElement;
    date: HTMLElement;
    shift: HTMLElement;
    restaurant: HTMLElement;
  }>(el);

  const tick = () => {
    const now = new Date();
    const lang = appStore.get().language;
    r.clock.textContent = formatTime(now);
    r.date.textContent = formatLongDate(now, lang);
  };
  tick();
  const timer = window.setInterval(tick, 15_000);

  const renderState = () => {
    const s = appStore.get();
    r.restaurant.textContent = s.receipt?.restaurantName ?? '';
    const open = !!s.openSession;
    r.shift.textContent = t(open ? 'nav.shiftOpen' : 'nav.shiftClosed');
    r.shift.className = `badge ${open ? 'badge-success' : 'badge-muted'}`;
    langButton.textContent = s.language === 'uz' ? 'UZ' : 'RU';
    langButton.setAttribute('aria-label', `${t('nav.language')}: ${langButton.textContent}`);
    themeButton.replaceChildren(icon(THEME_ICON[s.theme]));
    const label = `${t('nav.theme')}: ${t(THEME_LABEL[s.theme])}`;
    themeButton.setAttribute('aria-label', label);
    themeButton.title = label;
  };
  renderState();
  const unsubscribe = appStore.subscribe((s, prev) => {
    renderState();
    if (s.sidebarCollapsed !== prev.sidebarCollapsed) applySidebar();
  });

  // Collapsible sidebar: icon-only when collapsed, remembered per machine. Ctrl+B toggles.
  const applySidebar = () => {
    const collapsed = appStore.get().sidebarCollapsed;
    el.classList.toggle('is-collapsed', collapsed);
    sidebarToggle.replaceChildren(icon(collapsed ? 'expand' : 'collapse'));
    const label = t(collapsed ? 'nav.expand' : 'nav.collapse');
    sidebarToggle.setAttribute('aria-label', label);
    sidebarToggle.title = `${label} (Ctrl+B)`;
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    // Labels are hidden when collapsed: keep the names for screen readers and as tooltips.
    for (const link of [...navLinks, logout]) {
      const text = link.querySelector('span')?.textContent ?? '';
      link.setAttribute('aria-label', text);
      if (collapsed) link.title = text;
      else link.removeAttribute('title');
    }
  };
  const toggleSidebar = () => {
    const sidebarCollapsed = !appStore.get().sidebarCollapsed;
    appStore.set({ sidebarCollapsed });
    savePrefs({ sidebarCollapsed });
  };
  sidebarToggle.addEventListener('click', toggleSidebar);
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  };
  document.addEventListener('keydown', onKey);
  applySidebar();

  langButton.addEventListener('click', () => {
    const s = appStore.get();
    const language = s.language === 'uz' ? 'ru' : 'uz';
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
    },
    destroy() {
      window.clearInterval(timer);
      unsubscribe();
      document.removeEventListener('keydown', onKey);
    },
  };
}
