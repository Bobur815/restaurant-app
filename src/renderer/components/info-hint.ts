import { t } from '../i18n';
import { icon } from '../ui/icons';

let uid = 0;
/** The one hint open by tap at a time (opening another closes it). */
let openClose: (() => void) | null = null;

/**
 * An (i) button that explains the thing next to it (feature F14): the text shows on hover and on
 * keyboard focus (CSS), and a tap opens it on the touch-screen till; a tap outside or Esc closes
 * it. The text is the button's description for screen readers. Replaces grey hint paragraphs.
 */
export function infoHint(text: string): HTMLElement {
  const id = `info-hint-${++uid}`;
  const wrap = document.createElement('span');
  wrap.className = 'info-hint';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'info-hint-button';
  button.setAttribute('aria-label', t('app.moreInfo'));
  button.setAttribute('aria-describedby', id);
  button.setAttribute('aria-expanded', 'false');
  button.append(icon('info', 16));

  const tip = document.createElement('span');
  tip.className = 'info-hint-tip';
  tip.id = id;
  tip.setAttribute('role', 'tooltip');
  tip.textContent = text;

  /** Opens towards the side with room, so the text stays inside the modal or the page. */
  const place = () => {
    const box = (
      button.closest('.modal-body, .card, main') ?? document.body
    ).getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth * 0.7);
    wrap.classList.toggle('align-end', b.left + width > box.right && b.right - width >= box.left);
  };
  wrap.addEventListener('pointerenter', place);
  button.addEventListener('focus', place);

  const outside = (e: Event) => {
    if (!wrap.isConnected || !wrap.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    // A hint taken off the page while open (view re-rendered): just stop listening.
    if (!wrap.isConnected) {
      close();
      return;
    }
    if (e.key !== 'Escape') return;
    // Esc closes the hint only: preventDefault keeps a native <dialog> around it open.
    e.preventDefault();
    e.stopPropagation();
    close();
    button.focus();
  };
  function close() {
    if (!wrap.classList.contains('is-open')) return;
    wrap.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    if (openClose === close) openClose = null;
  }
  function open() {
    openClose?.();
    place();
    wrap.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    openClose = close;
  }

  button.addEventListener('click', (e) => {
    // Inside a form or a label: the tap is for the hint only.
    e.preventDefault();
    e.stopPropagation();
    if (wrap.classList.contains('is-open')) close();
    else open();
  });
  // Focus moving on (Tab, another field) closes it like a tap outside.
  button.addEventListener('blur', close);

  wrap.append(button, tip);
  return wrap;
}

/** A heading's text with an (i) hint after it, for section titles (`h1`/`h2`/`h3`/`legend`). */
export function withInfo(text: string, hint: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(document.createTextNode(text), infoHint(hint));
  return f;
}
