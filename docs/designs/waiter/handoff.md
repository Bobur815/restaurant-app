# SavdoChef Ofitsiant — React Native handoff

Nov 21, 2026 · @Boburmirzo Ergashev

## Overview

This handoff covers the presentation layer of the waiter app only: 12 components, 6 phone screens and 160 uz/ru strings, with no logic or networking. The source of truth is the **v2** page of the [Design canvas](https://claude.ai/code/artifact/0dd07460-6def-46cf-9115-9364f1aa8d20#page-v2); the v1 page is the earlier exploration and is superseded.

Two files come with it:

- `theme/tokens.ts`: colours for light and dark, spacing, radius, type, sizes, border widths and Android elevations, as one `tokens` object.
- `i18n/strings.ts`: every UI string as `key → { uz, ru }`, with `StringKey` and `Locale` types.

Conventions that apply everywhere:

- **Frame:** portrait only, designed at 360×800 dp and checked at 412×915. Layouts stretch horizontally; nothing is fixed-width except dialogs (max 328).
- **Theme:** follow `useColorScheme()`; every screen exists in light and dark.
- **Type:** the Android system font (Roboto), sizes 12/13/15/18/24/30, weights 400/500/700. Use the presets in `tokens.text`.
- **Icons:** `lucide-react-native`, outline, `strokeWidth={2}`, sizes 16/20/24.
- **Touch:** every tappable area is at least 48×48. Text buttons are 48 high; chips look 40 high inside a 48 hit area (`hitSlop` or a padded `Pressable`).
- **Money:** whole so'm, thousands grouped with a no-break space: `274 000 so'm` / `274 000 сум`.
- **Decimals:** comma for weight (`0,450 kg`). Portion labels are shown as the POS sends them (`0.7 porsiya`).
- **Depth:** no blur, gradients or CSS shadows. Bars and cards use a 1dp border; sheets, dialogs, toasts and the cart bar use `elevation`.
- **Out of scope:** the Windows till screen "Yo'ldosh kassalar" (Electron) shares the colour tokens but is not part of this app.

## Design tokens

All values live in `tokens.ts`; read colours as `tokens.color[scheme].<name>`, never as hex in components. Seven tokens were added to your brief's palette so that small text passes 4.5:1: `primaryText`, `warningText`, the three `*Soft` fills for success, warning and danger, and the disabled pair.

| Colour | Light | Dark | Used for |
| --- | --- | --- | --- |
| `bg` | #F6F7F9 | #111418 | Screen background |
| `surface` | #FFFFFF | #1A1F25 | Top bar, cards, sheets, dialogs, cart bar |
| `surface2` | #F0F2F5 | #222830 | Segmented control, keypad keys, thumbnails, locked table cards |
| `border` | #DDE1E6 | #2C333C | 1dp borders and dividers |
| `text` | #1B1F24 | #E8EAED | Main text; active chip fill |
| `muted` | #5B6573 | #9AA4B1 | Secondary text, unit prices, captions |
| `brand` | #F8901F | #F8901F | Logo tile only |
| `primary` / `onPrimary` | #B4530B / #FFFFFF | #F8901F / #1A0F00 | Primary buttons, selected borders, filled PIN dots |
| `primarySoft` | #FDF0E3 | #3A2614 | Busy and mine table cards, selected options, steppers |
| `primaryText` | #9A4609 | #F8901F | Text and icons on primarySoft or white |
| `success` / `successSoft` | #1E7A3C / #E5F2E9 | #4CC27A / #16291D | Connected, online, success icons |
| `warning` | #B26A00 | #F0A83C | Warning icons, borders, dots (not small text) |
| `warningText` / `warningSoft` | #8A5300 / #FCF1DD | #F0A83C / #33270F | Banners, "Qoldi: 3", "Yangi" |
| `danger` / `dangerSoft` | #C62828 / #FBE9E9 | #EF6B6B / #3A1C1C | Errors, "Tugadi", destructive buttons |
| `onDanger` | #FFFFFF | #1A0606 | Text on a filled danger button |
| `disabledBg` / `disabledFg` | #E4E7EB / #A3ABB5 | #2A3038 / #4F5862 | Disabled buttons and keys |
| `inverseBg` / `inverseFg` | #1B1F24 / #E8EAED | #E8EAED / #1B1F24 | Toasts |
| `inverseSuccess` / `inverseDanger` / `inverseAction` | #4CC27A / #EF6B6B / #F8901F | #1E7A3C / #C62828 / #9A4609 | Toast icons and the toast action |
| `scrim` | rgba(17,20,24,0.5) | rgba(0,0,0,0.6) | Behind sheets and dialogs |
| `cameraBg`, `qrDark`, `qrLight` | #0B0D10, #111418, #FFFFFF | same | Scanner and QR, identical in both themes |

| Scale | Values |
| --- | --- |
| Spacing (`space`) | 4dp grid: 0, 4, 8, 12, 16, 20, 24, 32, 40. Screen padding 16, PIN keypad padding 24 |
| Radius (`radius`) | sm 6 tags · md 10 buttons, cards, inputs · lg 16 sheets, dialogs, PIN keys · pill 999 chips |
| Text (`text`) | display 30/36 bold · title 24/30 bold · heading 18/24 bold · button 18/24 medium · body 15/20 · meta 13/18 · caption 12/16 medium |
| Sizes (`size`) | top bar 64 · button 48 · PIN key 72 · numpad key 56 · table card 100 high · dish row 72 (60 without pictures) · thumbnail 56 · avatar 40 |
| Border width (`borderWidth`) | hairline 1 · strong 1.5 · selected 2 · mine-table left edge 4 |

Android elevation replaces every shadow. Anything not listed sits at 0 with a 1dp `border`.

| Surface | `elevation` |
| --- | --- |
| Top bar, cards, table cards, dish list | 0 (border instead) |
| Toast | 6 |
| Cart bar | 8 |
| Bottom sheet | 16 |
| Dialog | 24 |

`tokens.motion` holds suggested timings (PIN shake 250 ms over 8dp, sheet 250 ms, toast 3 s); the frames do not specify motion.

## Components

Twelve components cover every v2 frame; screens only compose them. Strings come in as props already translated (`t(key)`), and amounts arrive as numbers that the component formats as so'm.

| Component | Look (from the frames) | States |
| --- | --- | --- |
| `Button` | 48 high, radius 10, label 18/500 (primary) or 15/500 (others), optional leading icon 20–22 | primary, secondary (surface + 1.5 border), ghost (text only), danger (filled); loading (spinner + label, e.g. "Saqlanmoqda…"), disabled (`disabledBg` + `muted`) |
| `PinDots` | 4 dots, 18 dp, 20 apart | empty (2dp `muted` ring), filled (`primary`), error (all `danger` + shake), checking (all filled, keypad disabled) |
| `PinKeypad` | 3×4 grid, keys 72 high, radius 16, gap 12, digits 30/400; slot 10 empty, slot 12 erase icon | enabled, disabled (keys `surface2`, digits `disabledFg`) |
| `TableCard` | 100 high, radius 10, number 30/700 top-left; amount 13/700, name and clock line 12 | free (white, number only), busy (`primarySoft`), mine (busy + 4dp `primary` left edge + "Siz" pill), locked (`surface2`, lock icon, "Kassada ochiq" or a name), dimmed (offline / no shift) |
| `CategoryChip` | pill 40 visible in a 48 hit area; optional 28dp picture; optional count | default, selected (`text` fill, `bg` label), with or without picture; also used for hall pills |
| `DishRow` | 72 high with a 56 thumbnail, 60 without; name 15/500, price 13 | addable ("+" 48), added (`QtyStepper`), low stock ("Qoldi: n" warning tag), out of stock ("Tugadi" tag, row `surface2`, "+" disabled), weight dish ("kg" tag) |
| `QtyStepper` | buttons 48×48, value min 28 wide, 18/700 | tinted (menu: `primarySoft` + 1.5 `primary` border), neutral (cart sheet: `surface2` buttons), at 1 the minus becomes a red trash, picker (a 120×48 pill showing "0,450 kg" or "0.7 porsiya" that opens a sheet) |
| `CartBar` | sticky bottom, `surface`, top border, elevation 8; summary on the left, Save on the right | unsaved (orange dot on the chevron tile), empty ("Taom qo'shing · 0 so'm", Save disabled), saving (Save loading) |
| `BottomSheet` | `surface`, top radius 16, 36×4 handle, header row (title 18/700, subtitle 13, close 48), scrim, elevation 16 | dismissible, non-dismissible (stock shortage) |
| `Banner` | full-width under the top bar | warning (orange block, icon, title + body, optional spinner and action), offline (36 high orange bar with spinner), info (grey, lock icon, read-only order), update (`primarySoft`, "Yangilash" link) |
| `Toast` | `inverseBg`, radius 10, min 52 high, 16 from the sides, 100 above the bottom (above the cart bar), elevation 6 | success, error (with an action button), info |
| `Dialog` | centred, max 328 wide, radius 16, padding 24/20, 48dp round icon, title 18/700, body 15 `muted`, elevation 24 | default, danger (red icon, filled danger confirm), warning; buttons in a row of two or stacked full width; non-dismissible (changed on another device) |

Props, presentation only:

```tsx
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react-native';

type Action = { label: string; onPress: () => void };

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps {
  label: string;
  variant?: ButtonVariant; // default 'primary'
  tone?: 'default' | 'warning'; // warning = orange outline (PIN "Qayta urinish")
  icon?: LucideIcon;
  loading?: boolean; // spinner replaces the icon
  loadingLabel?: string; // e.g. t('order.saving')
  disabled?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
}

export interface PinDotsProps {
  filled: 0 | 1 | 2 | 3 | 4;
  state: 'idle' | 'error' | 'checking';
  accessibilityLabel: string; // t('pin.dotsAria')
}

export interface PinKeypadProps {
  disabled?: boolean;
  onDigit: (digit: string) => void;
  onErase: () => void;
}

export type TableStatus = 'free' | 'busy' | 'mine' | 'locked';
export interface TableCardProps {
  number: string;
  status: TableStatus;
  total?: number; // busy, mine
  waiterName?: string; // busy, mine; locked shows it instead of "Kassada ochiq"
  openMinutes?: number; // busy, mine
  dimmed?: boolean; // offline or no shift: greyed, not pressable
  onPress?: () => void;
}

export interface CategoryChipProps {
  label: string;
  count?: number; // hall pills
  selected?: boolean;
  imageUri?: string; // shown only when the menu has pictures
  onPress?: () => void;
}

export interface DishRowProps {
  name: string;
  price: number; // per unit, so'm
  unit?: 'piece' | 'kg' | 'portion';
  imageUri?: string;
  showImage?: boolean; // false: 60 high, no thumbnail
  stockLeft?: number; // low: "Qoldi: n"; 0: "Tugadi" and disabled
  lowStock?: boolean;
  quantity?: number; // 0 or undefined: "+" button
  onAdd?: () => void;
  onIncrease?: () => void;
  onDecrease?: () => void;
}

export type QtyStepperProps =
  | { mode: 'stepper'; value: number; variant: 'tinted' | 'neutral'; onIncrease: () => void; onDecrease: () => void; disabled?: boolean }
  | { mode: 'picker'; label: string; onPress: () => void; accessibilityLabel: string };

export interface CartBarProps {
  count: number; // 0: empty state
  total: number;
  unsaved: boolean;
  saving?: boolean;
  onOpen: () => void;
  onSave: () => void;
}

export interface BottomSheetProps {
  title: string;
  subtitle?: string;
  dismissible?: boolean; // default true
  onClose?: () => void;
  footer?: ReactNode; // buttons pinned to the bottom of the sheet
  children: ReactNode;
}

export interface BannerProps {
  kind: 'warning' | 'offline' | 'info' | 'update';
  title: string;
  body?: string;
  busy?: boolean; // spinner
  action?: Action;
}

export interface ToastProps {
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: Action; // error only
}

export interface DialogProps {
  tone?: 'default' | 'danger' | 'warning';
  icon: LucideIcon;
  title: string;
  body?: string;
  actions: Array<Action & { variant: ButtonVariant }>;
  layout?: 'row' | 'stack'; // 2 actions: row; 3: stack
  dismissible?: boolean; // false for "changed on another device"
}
```

## Screens

Every screen keeps its top bar and its bottom actions fixed and scrolls only the middle, so the waiter's thumb always finds the main action in the same place. Trees below use the component names above; `Screen`, `TopBar`, `IconButton`, `Text` and `Spinner` are thin layout wrappers.

### PIN

Nothing scrolls: the layout fits 360×800. Below about 720 dp of height, wrap the centre block in a `ScrollView` and keep the keypad fixed.

```tsx
<Screen bg="bg">
  <TopBar transparent>                                 {/* 64, fixed */}
    <CategoryChip label={t('pin.langChip')} />          {/* RU / UZ */}
    <IconButton icon={Settings} label={t('pin.connectAria')} />  {/* → Connect */}
  </TopBar>
  {offline && <Banner kind="warning" busy title={t('pin.offline.title')} body={t('pin.offline.body')} />}
  {paired ? (
    <>
      <Center flex={1}>
        <LogoTile size={56} />
        <Text style="title">{restaurantName}</Text>
        <Text style="body" color="muted">{t('pin.prompt')}</Text>
        <PinDots filled={n} state={state} />
        {wrong && <Text color="danger">{t('pin.wrong')}</Text>}
        {checking && <Spinner label={t('pin.checking')} />}
        {locked && <LockNotice countdown="04:59" />}       {/* warningSoft box */}
      </Center>
      <PinKeypad disabled={locked || offline || checking} />
      {offline && <Button variant="secondary" tone="warning" icon={RefreshCw} label={t('common.retry')} fullWidth />}
    </>
  ) : (
    <>
      <EmptyState logo phoneToTill title={t('pin.unpaired.title')} body={t('pin.unpaired.body')} />
      <Button icon={ScanLine} label={t('pin.unpaired.cta')} fullWidth />  {/* → Connect */}
    </>
  )}
  <ConnectionLine dot={success | warning | muted} text={t('pin.conn.ok')} />  {/* 44, fixed */}
</Screen>
```

### Connect

The scanner is full-bleed camera with nothing scrolling; the other states put a `ScrollView` between a fixed top bar and a fixed footer. Manual entry sits in a `KeyboardAvoidingView` so "Ulash" stays above the keyboard.

```tsx
// Scanning
<Screen bg="cameraBg">
  <CameraView style={fill} />
  <Viewfinder size={248} radius={24} cornerColor="brand" scrim="rgba(0,0,0,0.58)" />
  <TopBar transparent tint="#FFFFFF" back title={t('connect.title')} />
  <BottomPanel>                                          {/* surface, top radius 16 */}
    <Text style="meta">{t('connect.scan.where')}</Text>
    <Text style="bodyStrong">{t('connect.scan.path')}</Text>
    <Text style="body">{t('connect.scan.hint')}</Text>
    <Button variant="ghost" icon={Keyboard} label={t('connect.manualEntry')} />
  </BottomPanel>
</Screen>

// Denied, manual, pairing, success, errors, already paired
<Screen>
  <TopBar back title={t('connect.title')} />
  <ScrollView>{/* state body: icon + text, or the two fields, or the error card, or the paired card */}</ScrollView>
  <Footer>{/* 1–2 Buttons, e.g. Ruxsat berish + Qo'lda kiritish, Ulash, Davom etish, Qayta urinish */}</Footer>
</Screen>
```

The pairing code is six separate inputs, 64 high, digits 30/700. Error messages appear in one slot above the footer, one at a time: wrong code in `danger`, expired, not found and version mismatch in `warning`, plan limit in neutral grey.

### Tables

Only the grid scrolls (`FlatList`, `numColumns={3}`, gap 8, padding 16). Top bar, banners, hall pills and the filter stay fixed.

```tsx
<Screen>
  <TopBar>
    <Avatar initial="D" statusDot={online ? 'success' : 'warning'} />
    <Title name={waiterName} subtitle={t('tables.role')} />
    <IconButton icon={Lock} label={t('tables.lock')} />   {/* → PIN */}
  </TopBar>
  {updateAvailable && <Banner kind="update" title={t('tables.update.banner')} action={{ label: t('tables.update.cta'), onPress }} />}
  {noShift && <Banner kind="warning" title={t('tables.noShift.title')} body={t('tables.noShift.body')} />}
  {offline && <Banner kind="offline" busy title={t('tables.offline')} />}
  {halls.length > 1 && <HorizontalScroll>{halls.map(h => <CategoryChip label={h.name} count={h.tables} />)}</HorizontalScroll>}
  <Segmented options={[t('tables.filter.all'), t('tables.filter.mine')]} counts={[18, 4]} />
  <FlatList numColumns={3} data={tables}
    renderItem={TableCard}            // loading: 18 grey skeleton cards
    ListEmptyComponent={<EmptyState title={t('tables.empty.title')} body={t('tables.empty.body')} />} />
</Screen>
```

No shift and offline keep the cards visible but dimmed and not pressable.

### Order

The dish list scrolls between a fixed search and chip row above and the fixed `CartBar` below. The read-only version scrolls the order lines and pins the totals and "Oldindan chek".

```tsx
<Screen>
  <TopBar back>
    <Text style="title">{t('common.table', { n: 7 })}</Text>     {/* 24/700, on purpose */}
    <GuestsChip count={4} />                                  {/* → Guests sheet */}
    {editable && <IconButton icon={MoreVertical} />}          {/* menu: order.menu.move, order.menu.cancel */}
  </TopBar>
  {readonly && <Banner kind="info" title={t('order.readonly.owner')} body={t('order.readonly.only')} />}
  {editable ? (
    <>
      <SearchField placeholder={t('order.search')} />
      <HorizontalScroll>{categories.map(c => <CategoryChip label={c.name} imageUri={c.image} />)}</HorizontalScroll>
      <FlatList data={dishes} renderItem={DishRow} />        {/* inside one bordered card, dividers */}
      <CartBar count={5} total={187000} unsaved onOpen={openSheet} onSave={save} />
    </>
  ) : (
    <>
      <ScrollView>{/* order lines: qty ×, name, unit price, line total */}</ScrollView>
      <Footer><Totals /><Button icon={Printer} label={t('order.prebill')} fullWidth /></Footer>
    </>
  )}
  <BottomSheet title={t('order.sheet.title', { table })} subtitle="7 ta taom">
    <ScrollView maxHeight="55%">{/* lines: name + Yangi tag, QtyStepper or picker pill, line total */}</ScrollView>
    <Totals subtotal service={10} total />
    <Footer row><Button variant="secondary" icon={Printer} label={t('order.prebill')} /><Button label={t('order.save')} /></Footer>
  </BottomSheet>
  <Toast kind="success" message={t('order.saved')} />            {/* 100 above the bottom */}
</Screen>
```

Removing a line: swipe left on a cart-sheet line, or press minus at quantity 1 (it shows a trash icon).

### Sheets and dialogs

All sheets open over the order screen with the scrim; content longer than the sheet scrolls inside it and the buttons stay pinned.

| Surface | Kind | Body | Actions |
| --- | --- | --- | --- |
| Portion | Sheet | 3 options, 72 high, portion 24/700 + price 18 | Tap an option to add it |
| Weight | Sheet | Display 88 high ("0,450 kg" 30/700, "= 54 000 so'm"), numpad 3×4 keys 56 with "," | Qo'shish |
| Guests | Sheet | Round −/+ 64, big number, chips 1–8 in a 4×2 grid | Saqlash |
| Move | Sheet | Free tables only, grouped by hall, 4 per row, 64 high; confirm strip "Stol 7 → Stol 12 ga ko'chirilsinmi?" | Bekor qilish, Ko'chirish |
| Stock shortage | Sheet, not dismissible by swipe | Warning card "Lavash · so'raldi 4, qoldi 2" | Tuzatish, Yopish |
| Cancel order | Dialog, danger | Red trash icon, title, body | Yo'q, Bekor qilish (filled danger) |
| Unsaved changes | Dialog | Warning icon, title, body | Stacked: Saqlash, Saqlamasdan chiqish (red text), Qolish |
| Changed elsewhere | Dialog, not dismissible | Refresh icon, title, body | Yangilash |
| Toasts | Toast | success, error (with Qayta urinish), info | — |

### Update

The app card and the state card scroll; the buttons are a fixed footer.

```tsx
<Screen>
  <TopBar back title={t('update.title')} />
  <ScrollView padding={16} gap={12}>
    <AppCard logo name="SavdoChef Ofitsiant" version={t('update.installed')} />
    {/* upToDate: green check + lastCheck | available: version, size tag, whatsNew list | downloading: ProgressBar 8 high + "18,4 / 32,0 MB" | ready: check + downloaded | error: danger card */}
  </ScrollView>
  <Footer>
    {ready && <Text style="meta" center>{t('update.androidHint')}</Text>}
    {/* upToDate: Tekshirish (secondary) | available: Yuklab olish + Keyinroq | downloading: Bekor qilish | ready: O'rnatish | error: Qayta urinish */}
  </Footer>
</Screen>
```
