/**
 * SavdoChef Ofitsiant — design tokens for React Native (Expo).
 * Source: Design canvas, page "v2" (2026-11-21). Presentation only: no logic.
 *
 * Usage:
 *   const scheme = useColorScheme() ?? 'light';
 *   const c = tokens.color[scheme];
 *   <View style={{ backgroundColor: c.surface, borderRadius: tokens.radius.md, elevation: tokens.elevation.sheet }} />
 */

const light = {
  // Surfaces
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surface2: '#F0F2F5',
  border: '#DDE1E6',
  scrim: 'rgba(17,20,24,0.5)',

  // Text
  text: '#1B1F24',
  muted: '#5B6573',

  // Brand / primary
  brand: '#F8901F', // logo tile only
  onBrand: '#FFFFFF',
  primary: '#B4530B', // primary buttons, selected borders, filled PIN dots
  onPrimary: '#FFFFFF',
  primarySoft: '#FDF0E3', // busy/mine table fill, selected option fill, stepper fill
  primaryText: '#9A4609', // text and icons ON primarySoft or white (5.8:1); plain #B4530B on primarySoft is 4.48:1

  // Status
  success: '#1E7A3C',
  successSoft: '#E5F2E9',
  warning: '#B26A00', // icons, borders, dots only — fails 4.5:1 as small text
  warningText: '#8A5300', // small warning text, e.g. "Qoldi: 3", "Yangi"
  warningSoft: '#FCF1DD',
  danger: '#C62828',
  onDanger: '#FFFFFF',
  dangerSoft: '#FBE9E9',

  // Disabled
  disabledBg: '#E4E7EB',
  disabledFg: '#A3ABB5', // disabled keypad digits / icons (exempt from contrast rules)

  // Inverse (toasts)
  inverseBg: '#1B1F24',
  inverseFg: '#E8EAED',
  inverseSuccess: '#4CC27A',
  inverseDanger: '#EF6B6B',
  inverseAction: '#F8901F',

  // Fixed (same in both themes)
  cameraBg: '#0B0D10',
  qrDark: '#111418',
  qrLight: '#FFFFFF',
};

export type Palette = { [K in keyof typeof light]: string };

const dark: Palette = {
  bg: '#111418',
  surface: '#1A1F25',
  surface2: '#222830',
  border: '#2C333C',
  scrim: 'rgba(0,0,0,0.6)',

  text: '#E8EAED',
  muted: '#9AA4B1',

  brand: '#F8901F',
  onBrand: '#FFFFFF',
  primary: '#F8901F',
  onPrimary: '#1A0F00',
  primarySoft: '#3A2614',
  primaryText: '#F8901F',

  success: '#4CC27A',
  successSoft: '#16291D',
  warning: '#F0A83C',
  warningText: '#F0A83C',
  warningSoft: '#33270F',
  danger: '#EF6B6B',
  onDanger: '#1A0606',
  dangerSoft: '#3A1C1C',

  disabledBg: '#2A3038',
  disabledFg: '#4F5862',

  inverseBg: '#E8EAED',
  inverseFg: '#1B1F24',
  inverseSuccess: '#1E7A3C',
  inverseDanger: '#C62828',
  inverseAction: '#9A4609',

  cameraBg: '#0B0D10',
  qrDark: '#111418',
  qrLight: '#FFFFFF',
};

/** 4dp grid. Keys are multiples of 4: space[4] = 16. */
const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

const radius = {
  sm: 6, // tags, small badges, keypad-free desktop buttons
  md: 10, // buttons, cards, inputs, steppers, table cards
  lg: 16, // bottom sheets (top corners), dialogs, large cards, PIN keys, logo tile
  pill: 999, // chips, pills, status dots, avatar
} as const;

const font = {
  family: undefined as string | undefined, // Android system font = Roboto. Set 'Roboto' explicitly if bundling.
  size: { xs: 12, sm: 13, md: 15, lg: 18, xl: 24, xxl: 30 },
  lineHeight: { xs: 16, sm: 18, md: 20, lg: 24, xl: 30, xxl: 36 },
  weight: { regular: '400', medium: '500', bold: '700' },
} as const;

/** Ready-made text styles used across the frames. */
const text = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' }, // PIN key digits use 400; totals, big quantity
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' }, // "Stol 7", empty-state headings, sheet total
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' }, // top bar titles, sheet and dialog titles
  button: { fontSize: 18, lineHeight: 24, fontWeight: '500' }, // primary button label
  buttonSmall: { fontSize: 15, lineHeight: 20, fontWeight: '500' }, // secondary/text buttons, chips
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 20, fontWeight: '700' }, // prices, line totals
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' }, // subtitles, unit prices, helper text
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' }, // tags, badges, table-card lines
} as const;

const size = {
  touch: 48, // minimum hit area for anything tappable
  topBar: 64,
  button: 48, // every text button (primary, secondary, ghost, danger)
  pillVisual: 40, // visible height of chips/pills; wrap in a 48 hit area
  iconButton: 48,
  pinKey: 72,
  numpadKey: 56, // weight-entry keypad
  stepperButton: 48,
  stepperQtyMinWidth: 28,
  tableCardHeight: 100,
  dishRow: 72,
  dishRowNoPicture: 60,
  dishThumb: 56,
  logoTile: 56,
  avatar: 40,
  statusDot: 8,
  pinDot: 18,
  offlineBar: 36,
  sheetHandle: { width: 36, height: 4 },
  dialogMaxWidth: 328,
  icon: { sm: 16, md: 20, lg: 24 },
  frame: { compact: { width: 360, height: 800 }, large: { width: 412, height: 915 } },
} as const;

const borderWidth = {
  hairline: 1,
  strong: 1.5, // selected stepper, busy table, warning card
  selected: 2, // selected option / selected table in move sheet
  mineAccent: 4, // left border on "mine" table cards
} as const;

/** Android elevation values (use `elevation`, not CSS shadows). Cards and bars use a 1dp border instead. */
const elevation = {
  none: 0,
  topBar: 0, // border-bottom: border
  card: 0, // border: border
  cartBar: 8,
  toast: 6,
  sheet: 16,
  dialog: 24,
} as const;

/** Suggested motion; not specified in the frames, adjust freely. */
const motion = {
  pinShake: { duration: 250, distance: 8 },
  sheet: 250,
  toastVisible: 3000,
} as const;

export const tokens = {
  color: { light, dark },
  space,
  radius,
  font,
  text,
  size,
  borderWidth,
  elevation,
  motion,
} as const;

export type ThemeName = keyof typeof tokens.color;
export type ColorName = keyof Palette;
export type TextStyleName = keyof typeof tokens.text;
