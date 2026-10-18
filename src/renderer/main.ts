import { api, onApiError } from './api';
import { setLanguage } from './i18n';
import { createShell } from './layout/shell';
import { startRouter, type Router } from './router/router';
import type { RouteDef } from './router/routes';
import { appStore, loadPrefs, type ThemeChoice } from './store/app';
import { loginView } from './views/login';
import { orderView } from './views/order/order-view';
import { placeholderView } from './views/placeholder';
import { setupView } from './views/setup';
import { tablesView } from './views/tables';
import type { View } from './views/types';

const NARROW_SCREEN_PX = 1300;

const ROUTES: RouteDef<View>[] = [
  { path: '/setup', access: 'public', layout: 'bare', view: setupView },
  { path: '/login', access: 'public', layout: 'bare', view: loginView },
  { path: '/tables', access: 'user', layout: 'shell', view: tablesView },
  { path: '/tables/:table', access: 'user', layout: 'shell', view: orderView },
  // Phase 5b screens:
  { path: '/sessions', access: 'user', layout: 'shell', view: placeholderView('nav.sessions') },
  { path: '/checks', access: 'user', layout: 'shell', view: placeholderView('nav.checks') },
  { path: '/menu', access: 'admin', layout: 'shell', view: placeholderView('nav.menu') },
  { path: '/reports', access: 'admin', layout: 'shell', view: placeholderView('nav.reports') },
  { path: '/users', access: 'admin', layout: 'shell', view: placeholderView('nav.users') },
  { path: '/settings', access: 'admin', layout: 'shell', view: placeholderView('nav.settings') },
];

function applyTheme(theme: ThemeChoice): void {
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
}

function showFatal(message: string): void {
  const root = document.getElementById('app')!;
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = message;
  root.replaceChildren(box);
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');

  const [setup, settings, receipt, user] = await Promise.all([
    api.setup.status(),
    api.settings.get(),
    api.receipt.get(),
    api.auth.me(),
  ]);
  const prefs = loadPrefs();
  appStore.set({
    setup,
    settings,
    receipt,
    user,
    language: prefs.language ?? settings.language,
    theme: prefs.theme ?? settings.theme,
    // Narrow POS screens start with an icon-only sidebar until the user picks otherwise.
    sidebarCollapsed: prefs.sidebarCollapsed ?? window.innerWidth <= NARROW_SCREEN_PX,
    openSession: user ? await api.sessions.getOpen() : undefined,
  });
  applyTheme(appStore.get().theme);
  setLanguage(appStore.get().language);

  let router: Router | null = null;

  // Any call that finds this window logged out (deactivated, restarted main) goes to login.
  onApiError((error) => {
    if (error.code === 'NOT_AUTHENTICATED' && appStore.get().user) {
      appStore.set({ user: null, openSession: undefined });
      router?.navigate('/login');
    }
  });

  appStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme);
    if (s.language !== prev.language) {
      setLanguage(s.language);
      router?.refresh();
    }
  });

  // Keep shared state fresh when anything changes (in this window or another).
  api.events.subscribe(async (e) => {
    const { user: me } = appStore.get();
    if (e.type === 'settings-changed') {
      const [s, r] = await Promise.all([api.settings.get(), api.receipt.get()]);
      appStore.set({ settings: s, receipt: r });
    }
    if (e.type === 'session-changed' && me) {
      appStore.set({
        openSession: await api.sessions.getOpen().catch(() => appStore.get().openSession),
      });
    }
    if (e.type === 'users-changed' && me) {
      const fresh = await api.auth.me().catch(() => me);
      appStore.set({ user: fresh });
    }
  });

  router = startRouter({ root, routes: ROUTES, createShell });
}

boot().catch((error: unknown) => {
  console.error(error);
  showFatal('SavdoChef ishga tushmadi. Dasturni qayta oching.');
});
