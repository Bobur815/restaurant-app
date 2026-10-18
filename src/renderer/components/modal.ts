import { t } from '../i18n';
import { html } from '../ui/html';
import { icon } from '../ui/icons';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  /** Return false to keep the modal open (e.g. validation failed). */
  onClick?: () => void | boolean | Promise<void | boolean>;
  /** Submit button of the modal's form: Enter in a field triggers it. */
  submit?: boolean;
}

export interface ModalOptions {
  title: string;
  body: Node;
  actions?: ModalAction[];
  size?: 'sm' | 'md' | 'lg';
  /** Escape / close button allowed (default true). */
  dismissible?: boolean;
  /** Element to focus first (default: first field, else the primary action). */
  initialFocus?: () => HTMLElement | null;
}

export interface ModalHandle {
  dialog: HTMLDialogElement;
  close(): void;
  /** Resolves when the modal closes, by any means. */
  closed: Promise<void>;
  setBusy(busy: boolean): void;
}

/**
 * A modal built on <dialog>.showModal(): the browser traps focus, makes the page behind inert
 * and handles Escape. Replaces legacy's child BrowserWindows (payment, add item, shift, category).
 * Focus returns to the element that opened it.
 */
export function openModal(options: ModalOptions): ModalHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dismissible = options.dismissible ?? true;
  const titleId = `modal-title-${Math.random().toString(36).slice(2)}`;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'icon-button';
  closeButton.setAttribute('aria-label', t('app.close'));
  closeButton.append(icon('close'));
  closeButton.hidden = !dismissible;

  const buttons = (options.actions ?? []).map((action) => {
    const b = document.createElement('button');
    b.type = action.submit ? 'submit' : 'button';
    b.className = `btn btn-${action.kind ?? 'secondary'}`;
    b.textContent = action.label;
    return { b, action };
  });

  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = `modal modal-${options.size ?? 'md'}`;
  form.append(
    html`<header class="modal-header">
        <h2 id="${titleId}" class="modal-title">${options.title}</h2>
        ${closeButton}
      </header>
      <div class="modal-body">${options.body}</div>
      ${buttons.length
        ? html`<footer class="modal-footer">${buttons.map((x) => x.b)}</footer>`
        : ''}`,
  );

  const dialog = document.createElement('dialog');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.append(form);
  document.body.append(dialog);

  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  let busy = false;

  const setBusy = (value: boolean) => {
    busy = value;
    for (const { b } of buttons) b.disabled = value;
    closeButton.disabled = value;
    form.setAttribute('aria-busy', String(value));
  };

  const close = () => {
    if (dialog.open) dialog.close();
  };

  const run = async (action: ModalAction) => {
    if (busy) return;
    if (!action.onClick) return close();
    setBusy(true);
    try {
      const keepOpen = (await action.onClick()) === false;
      if (!keepOpen) close();
    } finally {
      if (dialog.open) setBusy(false);
    }
  };

  for (const { b, action } of buttons) {
    if (!action.submit) b.addEventListener('click', () => void run(action));
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const submit = buttons.find((x) => x.action.submit);
    if (submit) void run(submit.action);
  });
  closeButton.addEventListener('click', () => !busy && close());
  dialog.addEventListener('cancel', (e) => {
    if (!dismissible || busy) e.preventDefault();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    opener?.focus();
    resolveClosed();
  });

  dialog.showModal();
  const first =
    options.initialFocus?.() ??
    form.querySelector<HTMLElement>(
      '.modal-body input:not([disabled]), .modal-body select, .modal-body textarea',
    ) ??
    buttons.find((x) => x.action.kind === 'primary')?.b ??
    null;
  first?.focus();

  return { dialog, close, closed, setBusy };
}

/** Yes/no question; resolves true on confirm. */
export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const body = document.createElement('p');
    body.textContent = options.message;
    const modal = openModal({
      title: options.title,
      body,
      size: 'sm',
      actions: [
        { label: t('app.no'), kind: 'secondary' },
        {
          label: options.confirmLabel ?? t('app.yes'),
          kind: options.danger ? 'danger' : 'primary',
          onClick: () => {
            answer = true;
          },
        },
      ],
    });
    void modal.closed.then(() => resolve(answer));
  });
}
