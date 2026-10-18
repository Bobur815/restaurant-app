import { isApiError } from '../api';
import { errorMessage } from './toast';

let uid = 0;
/** Unique per element: a modal's form can sit over a page form with the same field names. */
const fieldId = (name: string) => `f-${name.replace(/\W/g, '-')}-${++uid}`;

function wrapField(id: string, labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const error = document.createElement('div');
  error.className = 'field-error';
  error.id = `${id}-error`;
  control.setAttribute('aria-describedby', error.id);
  wrap.append(label, control, error);
  return wrap;
}

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
  const id = fieldId(options.name);
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
  return wrapField(id, options.label, input);
}

export function selectField(options: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value?: string;
}): HTMLElement {
  const id = fieldId(options.name);
  const select = document.createElement('select');
  select.id = id;
  select.name = options.name;
  for (const o of options.options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    opt.selected = o.value === options.value;
    select.append(opt);
  }
  return wrapField(id, options.label, select);
}

export function textareaField(options: {
  name: string;
  label: string;
  value?: string;
  rows?: number;
}): HTMLElement {
  const id = fieldId(options.name);
  const area = document.createElement('textarea');
  area.id = id;
  area.name = options.name;
  area.rows = options.rows ?? 3;
  area.value = options.value ?? '';
  return wrapField(id, options.label, area);
}

/** A checkbox with its label to the right. */
export function checkboxField(options: {
  name: string;
  label: string;
  checked?: boolean;
}): HTMLElement {
  const id = fieldId(options.name);
  const wrap = document.createElement('label');
  wrap.className = 'check-field';
  wrap.htmlFor = id;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = id;
  box.name = options.name;
  box.checked = options.checked ?? false;
  const text = document.createElement('span');
  text.textContent = options.label;
  wrap.append(box, text);
  return wrap;
}

export function checked(form: ParentNode, name: string): boolean {
  return form.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`)?.checked ?? false;
}

/** A form-error line for showFormError to write general (non-field) failures into. */
export function formError(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'form-error';
  el.setAttribute('role', 'alert');
  return el;
}

export function value(form: ParentNode, name: string): string {
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
