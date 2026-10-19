import { t } from '../../i18n';

/** The save button of a settings form. */
export function submitButton(label = t('app.save')): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'submit';
  b.className = 'btn btn-primary';
  b.textContent = label;
  return b;
}

/** A small icon-only button with an accessible name (row actions). */
export function iconButton(label: string, child: Node, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(child);
  b.addEventListener('click', onClick);
  return b;
}
