import { t } from '../i18n';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import { openModal } from './modal';

/**
 * Shows a new recovery code once (main keeps only its hash). Not dismissible by Escape: the owner
 * must confirm they wrote it down. Resolves when closed.
 */
export function showRecoveryCode(code: string): Promise<void> {
  const body = html`<div class="recovery-code">
    <p class="notice notice-warning">${icon('warning')}<span>${t('recovery.writeDown')}</span></p>
    <p class="recovery-code-value" aria-label="${t('recovery.code')}">${code}</p>
    <p class="muted">${t('recovery.howToUse')}</p>
  </div>`;
  const modal = openModal({
    title: t('recovery.title'),
    body,
    dismissible: false,
    actions: [{ label: t('recovery.saved'), kind: 'primary' }],
  });
  return modal.closed;
}
