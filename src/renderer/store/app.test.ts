import { loadPrefs, menuLayout, savePrefs } from './app';

describe('per-machine preferences', () => {
  beforeEach(() => localStorage.clear());

  it('saves patches without losing the other preferences', () => {
    savePrefs({ language: 'ru' });
    savePrefs({ theme: 'dark' });
    expect(loadPrefs()).toEqual({ language: 'ru', theme: 'dark' });
  });

  it('keeps the order-screen menu layout, horizontal by default', () => {
    expect(menuLayout()).toBe('horizontal');
    savePrefs({ menuLayout: 'vertical' });
    savePrefs({ language: 'ru' });
    expect(menuLayout()).toBe('vertical');
    localStorage.setItem('savdochef.ui', JSON.stringify({ menuLayout: 'diagonal' }));
    expect(menuLayout()).toBe('horizontal');
  });

  it('ignores invalid or corrupt stored values', () => {
    localStorage.setItem(
      'savdochef.ui',
      JSON.stringify({ language: 'en', theme: 7, sidebarCollapsed: true }),
    );
    expect(loadPrefs()).toEqual({});
    localStorage.setItem('savdochef.ui', '{not json');
    expect(loadPrefs()).toEqual({});
  });
});
