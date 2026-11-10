import { appStore } from '../store/app';
import { createShell, initials } from './shell';

jest.mock('../api', () => ({ api: { auth: { logout: jest.fn(async () => undefined) } } }));

describe('avatar initials', () => {
  it('takes the first letters of the first two words, else the first two letters', () => {
    expect(initials('Bobur Ergashev')).toBe('BE');
    expect(initials('  aziz   kassir  extra ')).toBe('AK');
    expect(initials('owner')).toBe('OW');
    expect(initials('Ф')).toBe('Ф');
    expect(initials('')).toBe('?');
  });
});

describe('pages menu next to the profile', () => {
  it('replaces the sidebar: the gear opens it; a choice, Esc or a tap outside closes it', () => {
    // jsdom has no matchMedia: the logo reads the theme from <html data-theme>.
    document.documentElement.dataset['theme'] = 'light';
    appStore.set({
      user: { id: 1, fullName: 'Ali Valiyev', phone: null, role: 'STAFF', permissions: ['orders'] },
    });
    const shell = createShell(() => undefined);
    document.body.append(shell.el);
    shell.update('/tables');
    const button = shell.el.querySelector<HTMLButtonElement>('.nav-menu-button')!;
    const menu = shell.el.querySelector<HTMLElement>('.nav-menu')!;
    expect(shell.el.querySelector('.sidebar')).toBeNull();
    // Only the pages this user may open.
    const paths = [...menu.querySelectorAll<HTMLAnchorElement>('.nav-link')].map(
      (a) => a.dataset['path'],
    );
    expect(paths).toContain('/tables');
    expect(paths).not.toContain('/settings');
    expect(menu.hidden).toBe(true);

    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(menu.querySelector('[data-path="/tables"]'));

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);

    button.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);

    button.click();
    menu.querySelector<HTMLAnchorElement>('[data-path="/sessions"]')!.click();
    expect(menu.hidden).toBe(true);
    shell.destroy();
    shell.el.remove();
  });
});
