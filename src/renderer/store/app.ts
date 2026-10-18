import type {
  AppSettings,
  CurrentUser,
  Language,
  ReceiptSettingsDto,
  SessionDto,
  SetupStatus,
} from '@shared/types';
import { createStore } from './store';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface AppState {
  setup: SetupStatus | null;
  user: CurrentUser | null;
  settings: AppSettings | null;
  receipt: ReceiptSettingsDto | null;
  /** The open shift, or null when none is open; undefined until first loaded. */
  openSession: SessionDto | null | undefined;
  /** This machine's UI choices (localStorage), defaulting to the shop settings. */
  language: Language;
  theme: ThemeChoice;
  /** Sidebar shows icons only. Default: collapsed on narrow screens until the user chooses. */
  sidebarCollapsed: boolean;
}

export const appStore = createStore<AppState>({
  setup: null,
  user: null,
  settings: null,
  receipt: null,
  openSession: undefined,
  language: 'uz',
  theme: 'system',
  sidebarCollapsed: false,
});

// ── Per-machine UI preferences ──────────────────────────────────────────────────────────────
// localStorage is fine here: losing it only resets these to the defaults.

const PREFS_KEY = 'savdochef.ui';

export type Prefs = Pick<AppState, 'language' | 'theme' | 'sidebarCollapsed'>;

export function loadPrefs(): Partial<Prefs> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    const out: Partial<Prefs> = {};
    if (parsed['language'] === 'uz' || parsed['language'] === 'ru') {
      out.language = parsed['language'];
    }
    if (parsed['theme'] === 'system' || parsed['theme'] === 'light' || parsed['theme'] === 'dark') {
      out.theme = parsed['theme'];
    }
    if (typeof parsed['sidebarCollapsed'] === 'boolean') {
      out.sidebarCollapsed = parsed['sidebarCollapsed'];
    }
    return out;
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored preferences. */
export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // Private mode or blocked storage: preferences simply do not persist.
  }
}
