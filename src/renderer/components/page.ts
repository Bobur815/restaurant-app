import { html } from '../ui/html';

/** The common page header: title on the left, actions on the right. */
export function pageHeader(title: string, ...actions: Node[]): DocumentFragment {
  return html`<header class="page-header">
    <h1>${title}</h1>
    <div class="page-actions">${actions}</div>
  </header>`;
}

export function button(
  label: string,
  kind: 'primary' | 'secondary' | 'danger' | 'danger-ghost' | 'ghost' | 'success' = 'secondary',
  onClick?: () => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn-${kind}`;
  b.textContent = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
