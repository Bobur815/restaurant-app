import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

/**
 * The phone's own theme choice (Ulash screen): follow the system, or always light / dark.
 * Applied through `Appearance.setColorScheme`, so `useColorScheme` (and `useTheme`) everywhere,
 * native pickers and dialogs included, follow it without reading this context.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORE_KEY = 'savdochef.theme';

const apply = (p: ThemePreference) => Appearance.setColorScheme(p === 'system' ? 'unspecified' : p);

interface ThemePreferenceState {
  preference: ThemePreference;
  setPreference(p: ThemePreference): void;
}

const Ctx = createContext<ThemePreferenceState | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setState] = useState<ThemePreference>('system');

  useEffect(() => {
    void SecureStore.getItemAsync(STORE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') {
          setState(saved);
          apply(saved);
        }
      })
      .catch(() => undefined);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setState(p);
    apply(p);
    void SecureStore.setItemAsync(STORE_KEY, p).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemePreference(): ThemePreferenceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useThemePreference outside ThemePreferenceProvider');
  return ctx;
}
