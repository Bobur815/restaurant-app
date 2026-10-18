import { isApiError } from '../api';
import { t } from '../i18n';
import { icon } from '../ui/icons';

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.append(region);
  return region;
}

/** A short message at the corner; errors stay longer. Text only (never markup). */
export function toast(
  message: string,
  kind: 'success' | 'error' | 'info' = 'info',
  ms?: number,
): void {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  if (kind === 'error') el.setAttribute('role', 'alert');
  el.append(icon(kind === 'error' ? 'warning' : 'check', 18));
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  ensureRegion().append(el);
  window.setTimeout(() => el.remove(), ms ?? (kind === 'error' ? 6000 : 3000));
}

/**
 * The message to show for a failed call: the server's (already Uzbek, specific) message when
 * there is one; otherwise the translated text for the code.
 */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === 'LOCKED') {
      const until = (error.details as { lockedUntil?: string } | undefined)?.lockedUntil;
      const time = until ? new Date(until).toLocaleTimeString() : '';
      return t('errors.LOCKED', { time });
    }
    return error.message || t(`errors.${error.code}`);
  }
  return t('errors.INTERNAL');
}

export function toastError(error: unknown): void {
  if (!isApiError(error)) console.error(error);
  toast(errorMessage(error), 'error');
}
