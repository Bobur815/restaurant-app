import { infoHint, withInfo } from './info-hint';
import { field } from './forms';

describe('info hint (F14)', () => {
  it('describes its button with the text; a tap opens it, a second tap, Esc or a tap outside closes it', () => {
    const hint = infoHint('<b>Tannarx</b> izohi');
    document.body.append(hint);
    const button = hint.querySelector('button')!;
    const tip = hint.querySelector('[role="tooltip"]')!;
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    // Text, never markup.
    expect(tip.textContent).toBe('<b>Tannarx</b> izohi');
    expect(tip.querySelector('b')).toBeNull();

    button.click();
    expect(hint.classList.contains('is-open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click();
    expect(hint.classList.contains('is-open')).toBe(false);

    button.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hint.classList.contains('is-open')).toBe(false);

    button.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(hint.classList.contains('is-open')).toBe(false);
    hint.remove();
  });

  it('Esc is kept from the dialog around it; a hint removed while open stops listening', () => {
    const hint = infoHint('x');
    document.body.append(hint);
    hint.querySelector('button')!.click();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    document.body.dispatchEvent(esc);
    // A cancelled Esc keydown does not close a native <dialog>.
    expect(esc.defaultPrevented).toBe(true);

    hint.querySelector('button')!.click();
    hint.remove();
    const later = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    document.body.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('only one hint is open at a time', () => {
    const a = infoHint('a');
    const b = infoHint('b');
    document.body.append(a, b);
    a.querySelector('button')!.click();
    b.querySelector('button')!.click();
    expect(a.classList.contains('is-open')).toBe(false);
    expect(b.classList.contains('is-open')).toBe(true);
    a.remove();
    b.remove();
  });

  it("sits beside a field's label, outside it, so the input's name stays the label text", () => {
    const f = field({ name: 'costPrice', label: 'Tannarx', info: 'izoh' });
    const label = f.querySelector('label')!;
    expect(label.textContent).toBe('Tannarx');
    expect(label.querySelector('.info-hint')).toBeNull();
    expect(f.querySelector('.field-label-row .info-hint')).not.toBeNull();
    // Without `info`, a field is exactly as before.
    expect(field({ name: 'x', label: 'X' }).querySelector('.field-label-row')).toBeNull();
  });

  it('after a heading text', () => {
    const h = document.createElement('h2');
    h.append(withInfo('Printer', 'izoh'));
    expect(h.firstChild!.textContent).toBe('Printer');
    expect(h.querySelector('.info-hint [role="tooltip"]')!.textContent).toBe('izoh');
  });
});
