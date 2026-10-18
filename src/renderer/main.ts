// Phase 1 boot: proves the window, CSP, preload and IPC chain. The router, html`` helper,
// store and i18n arrive in Phase 5. DOM is built with textContent only, never innerHTML.
import { api } from './api';
import { BRAND_TAGLINE_UZ, SavdoChefHorizontal } from './branding';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');

  const logo = SavdoChefHorizontal({ height: 64, tagline: BRAND_TAGLINE_UZ });
  logo.classList.add('brand-logo');

  const meta = document.createElement('p');
  meta.className = 'muted';

  root.replaceChildren(logo, meta);

  try {
    const info = await api.app.info();
    meta.textContent = `v${info.version}${info.isPackaged ? '' : ' (dev)'}`;
  } catch (err) {
    meta.textContent = 'IPC xatosi';
    console.error(err);
  }
}

void boot();
