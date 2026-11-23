import { useColorScheme } from 'react-native';
import { tokens, type Palette, type ThemeName } from './tokens';

export { tokens };
export type { Palette, ThemeName };

/** The palette for the phone's light or dark mode (handoff: follow the system setting). */
export function useTheme(): { c: Palette; scheme: ThemeName } {
  const scheme: ThemeName = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { c: tokens.color[scheme], scheme };
}
