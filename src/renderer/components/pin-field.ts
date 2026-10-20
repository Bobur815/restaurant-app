import { t } from '../i18n';
import { field, setFieldError, value } from './forms';

export const PIN_LENGTH = 4;

/** A 4-digit PIN input for the forms (recovery, first PIN, users). */
export function pinField(name: string, label: string): HTMLElement {
  const el = field({ name, label, type: 'password', inputmode: 'numeric', autocomplete: 'off' });
  const input = el.querySelector('input')!;
  input.maxLength = PIN_LENGTH;
  input.classList.add('pin-input');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
  });
  return el;
}

/** Checks a PIN and its repeat on a form; marks the field and returns false when wrong. */
export function pinsMatch(form: HTMLElement, name: string, repeat: string): boolean {
  const pin = value(form, name);
  if (!/^\d{4}$/.test(pin)) {
    setFieldError(form, name, t('errors.pinFormat'));
    return false;
  }
  if (pin !== value(form, repeat)) {
    setFieldError(form, repeat, t('errors.pinsDiffer'));
    return false;
  }
  return true;
}
