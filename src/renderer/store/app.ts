import { hasPermission, type Permission } from '@shared/permissions';
import type {
  AppSettings,
  CurrentUser,
  Language,
  ReceiptSettingsDto,
  SessionDto,
  SetupStatus,
  UpdateStatusDto,
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
  /** The software updater's state, for users with the settings permission; else null. */
  update: UpdateStatusDto | null;
}

export const appStore = createStore<AppState>({
  setup: null,
  user: null,
  settings: null,
  receipt: null,
  openSession: undefined,
  language: 'uz',
  theme: 'system',
  update: null,
});

/** A newer version is known (found, downloading or ready to install): Settings shows a dot. */
export function updatePending(): boolean {
  const state = appStore.get().update?.state;
  return state === 'available' || state === 'downloading' || state === 'downloaded';
}

/**
 * Whether the logged-in user has a permission. Only for showing or hiding controls: main checks
 * every call again (ipc-safe.ts).
 */
export function can(permission: Permission): boolean {
  const user = appStore.get().user;
  return !!user && hasPermission(user, permission);
}

// ── Per-machine UI preferences ──────────────────────────────────────────────────────────────
// localStorage is fine here: losing it only resets these to the defaults.

const PREFS_KEY = 'savdochef.ui';

export type Prefs = Pick<AppState, 'language' | 'theme'>;

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
