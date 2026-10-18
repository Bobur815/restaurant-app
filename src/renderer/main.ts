// Phase 1 boot: proves the window, CSP, preload and IPC chain. The router, html`` helper,
// store and i18n arrive in Phase 5. DOM is built with textContent only, never innerHTML.

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');

  const title = document.createElement('h1');
  title.textContent = 'SavdoChef';

  const meta = document.createElement('p');
  meta.className = 'muted';

  root.replaceChildren(title, meta);

  try {
    const info = await window.electronAPI.app.info();
    meta.textContent = `v${info.version}${info.isPackaged ? '' : ' (dev)'}`;
  } catch (err) {
    meta.textContent = 'IPC xatosi';
    console.error(err);
  }
}

void boot();
