import { loadPrefs, savePrefs } from './app';

describe('per-machine preferences', () => {
  beforeEach(() => localStorage.clear());

  it('saves patches without losing the other preferences', () => {
    savePrefs({ language: 'ru' });
    savePrefs({ sidebarCollapsed: true });
    savePrefs({ theme: 'dark' });
    expect(loadPrefs()).toEqual({ language: 'ru', theme: 'dark', sidebarCollapsed: true });
  });

  it('ignores invalid or corrupt stored values', () => {
    localStorage.setItem(
      'savdochef.ui',
      JSON.stringify({ language: 'en', theme: 7, sidebarCollapsed: 'yes' }),
    );
    expect(loadPrefs()).toEqual({});
    localStorage.setItem('savdochef.ui', '{not json');
    expect(loadPrefs()).toEqual({});
  });
});
