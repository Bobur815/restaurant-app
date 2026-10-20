import type { UpdateStatusDto } from '@shared/types';
import { formatDateTime } from '@shared/utils/format';
import { api } from '../../api';
import { confirmDialog } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html, refs } from '../../ui/html';
import type { View } from '../types';

/**
 * Software update (feature F4): current version, check, download with progress, install. Main
 * does the work (main/updater/updater.ts); this shows its state from the app store, which
 * main.ts refreshes on every `update-changed` event.
 */
export const updateSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';

  const card = html`<div class="card form-card update-card">
    <div class="update-version">
      <span class="muted">${t('update.current')}</span>
      <strong data-ref="current"></strong>
    </div>
    <p class="update-status" data-ref="status" role="status" aria-live="polite"></p>
    <progress class="update-progress" data-ref="progress" max="100" hidden></progress>
    <p class="muted small" data-ref="checked"></p>
    <div class="form-actions" data-ref="actions"></div>
    <p class="muted small">${t('update.hint')}</p>
  </div>`;
  const r = refs<{
    current: HTMLElement;
    status: HTMLElement;
    progress: HTMLProgressElement;
    checked: HTMLElement;
    actions: HTMLElement;
  }>(card);
  el.append(pageHeader(t('settings.sectionUpdate')), card);
  const progress = r.progress;

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toastError(error);
    }
  };

  const checkButton = button(t('update.check'), 'secondary', () => void run(api.updater.check));
  const downloadButton = button(
    t('update.download'),
    'primary',
    () => void run(api.updater.download),
  );
  const installButton = button(t('update.install'), 'success', async () => {
    const yes = await confirmDialog({
      title: t('update.installTitle'),
      message: t('update.installConfirm'),
      confirmLabel: t('update.install'),
    });
    if (yes) await run(api.updater.install);
  });

  const statusText = (s: UpdateStatusDto): string => {
    switch (s.state) {
      case 'unsupported':
        return t('update.unsupported');
      case 'idle':
        return t('update.idle');
      case 'checking':
        return t('update.checking');
      case 'not-available':
        return t('update.upToDate');
      case 'available':
        return t('update.available', { version: s.version ?? '' });
      case 'downloading':
        return t('update.downloading', { version: s.version ?? '', percent: s.percent ?? 0 });
      case 'downloaded':
        return t('update.downloaded', { version: s.version ?? '' });
      case 'error':
        return s.message ?? t('update.idle');
    }
  };

  const render = () => {
    const s = appStore.get().update;
    if (!s) {
      r.status.textContent = t('update.loading');
      r.actions.replaceChildren();
      return;
    }
    r.current.textContent = s.currentVersion;
    r.status.textContent = statusText(s);
    r.status.className = `update-status${s.state === 'error' ? ' is-error' : ''}${
      s.state === 'available' || s.state === 'downloaded' ? ' is-new' : ''
    }`;
    progress.hidden = s.state !== 'downloading';
    progress.value = s.percent ?? 0;
    r.checked.textContent = s.checkedAt
      ? t('update.checkedAt', { time: formatDateTime(s.checkedAt) })
      : '';

    const buttons: HTMLButtonElement[] = [];
    if (s.state === 'available' || (s.state === 'error' && s.version)) buttons.push(downloadButton);
    if (s.state === 'downloaded') buttons.push(installButton);
    if (s.state !== 'unsupported' && s.state !== 'downloaded') buttons.push(checkButton);
    checkButton.disabled = s.state === 'checking' || s.state === 'downloading';
    r.actions.replaceChildren(...buttons);
  };

  render();
  const stop = appStore.subscribe((s, prev) => {
    if (s.update !== prev.update) render();
  });
  // Fresh state on opening the section (the store may predate a check made in another window).
  void api.updater
    .status()
    .then((update) => appStore.set({ update }))
    .catch(toastError);

  return { el, destroy: stop };
};
