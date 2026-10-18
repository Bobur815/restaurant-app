import { isApiError } from '../api';
import { errorMessage } from './toast';

/** A labelled input, with an error slot under it. `name` is the zod path joined by dots. */
export function field(options: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  autocomplete?: string;
  min?: number;
  max?: number;
  inputmode?: string;
}): HTMLElement {
  const id = `f-${options.name.replace(/\W/g, '-')}`;
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = options.label;

  const input = document.createElement('input');
  input.id = id;
  input.name = options.name;
  input.type = options.type ?? 'text';
  input.value = options.value ?? '';
  input.required = options.required ?? false;
  if (options.autocomplete) input.autocomplete = options.autocomplete as AutoFill;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.inputmode) input.inputMode = options.inputmode;

  const error = document.createElement('div');
  error.className = 'field-error';
  error.id = `${id}-error`;
  input.setAttribute('aria-describedby', error.id);

  wrap.append(label, input, error);
  return wrap;
}

export function value(form: HTMLElement, name: string): string {
  return (form.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`)?.value ?? '').trim();
}

export function clearErrors(form: HTMLElement): void {
  form.querySelectorAll('.field-error').forEach((e) => (e.textContent = ''));
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  const general = form.querySelector('.form-error');
  if (general) general.textContent = '';
}

export function setFieldError(form: HTMLElement, name: string, message: string): boolean {
  const input = form.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`);
  const slot = input
    ? form.querySelector(`#${CSS.escape(input.getAttribute('aria-describedby') ?? '')}`)
    : null;
  if (!input || !slot) return false;
  slot.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  return true;
}

/**
 * Shows a failed call on the form: VALIDATION issues under their fields (or `details.field`),
 * anything else in the form's general error line. Focuses the first invalid field.
 */
export function showFormError(form: HTMLElement, error: unknown): void {
  clearErrors(form);
  let placed = false;
  if (isApiError(error)) {
    const details = error.details as
      | { issues?: Array<{ path: string[]; message: string }>; field?: string }
      | undefined;
    for (const issue of details?.issues ?? []) {
      placed = setFieldError(form, issue.path.join('.'), issue.message) || placed;
    }
    if (details?.field) placed = setFieldError(form, details.field, error.message) || placed;
  }
  if (!placed) {
    const general = form.querySelector('.form-error');
    if (general) general.textContent = errorMessage(error);
  }
  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
