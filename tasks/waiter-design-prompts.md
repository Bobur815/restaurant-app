# Waiter app: prompts for Claude Design

Paste **Prompt 0** once at the start of the project, then one screen prompt at a time (1 → 8).
Review each screen before you send the next. Prompt 9 is the handoff at the end.

---

## Prompt 0: Project context (paste first)

```
You are designing "SavdoChef Ofitsiant", an Android phone app for waiters in small cafes and
eateries in Uzbekistan. It is the companion of SavdoChef POS, a Windows till app. The phone talks
to the till over the cafe's Wi-Fi. No internet, no cloud.

Who uses it: waiters on the floor, holding the phone in one hand, often hurrying, in bright or dim
rooms. They are not technical. Each waiter signs in with their own 4-digit PIN.

What it does (sales only): pick a table, take or change its order, send it to the kitchen, print a
pre-bill on the till's printer, move an order to another table. What it does NOT do: payments,
menu editing, settings, reports, users, receipts. Don't design anything for those.

Platform and size:
- Android phone, portrait only. Design at 360x800 dp, and check that 412x915 still looks right.
- Touch targets at least 48dp. Main actions sit in the bottom third (thumb reach).
- Built in React Native, so use simple shapes: no blur, no glass effects, no complex gradients.

Brand (same as the POS):
- Brand orange #F8901F (logo tile). Primary actions use #B4530B in light mode (passes contrast
  with white text) and #F8901F in dark mode with #1A0F00 text.
- Light: bg #F6F7F9, surface #FFFFFF, surface-2 #F0F2F5, text #1B1F24, muted #5B6573,
  border #DDE1E6, success #1E7A3C, danger #C62828, warning #B26A00, primary-soft #FDF0E3.
- Dark: bg #111418, surface #1A1F25, surface-2 #222830, text #E8EAED, muted #9AA4B1,
  border #2C333C, success #4CC27A, danger #EF6B6B, warning #F0A83C, primary-soft #3A2614.
- Radius 6/10/16, pill for chips. Spacing on a 4dp grid. Font: Roboto (the Android system font).
  Sizes 12/13/15/18/24/30.
- Logo: an orange rounded tile with a white chef hat and a small rising bar chart. Use a
  placeholder of that shape.
- Icons: Lucide, outline, 2px stroke.

Language: every screen in Uzbek (Latin). Show the Russian version of the busiest screens too:
Russian text is about 30% longer and must not break the layout.
Money: whole so'm, thousands grouped with a space: "125 000 so'm". Quantities can be decimal:
"0,5 kg", "0.7 porsiya".

Design both light and dark for every screen. Keep it calm and dense enough for a busy waiter:
large numbers, clear status colors, no decoration.
```

---

## Prompt 1: PIN screen

```
Design the sign-in screen. It mirrors the POS lock screen.

Layout, top to bottom:
- Top bar: language chip on the left ("RU" when the app is in Uzbek, "UZ" when in Russian), and a
  gear icon button on the right (opens "Kassaga ulash", the connect screen).
- The logo tile (56dp), the restaurant name (e.g. "Oqtepa Lavash"), and under it, muted:
  "PIN kodingizni kiriting".
- 4 PIN dots.
- A 3x4 keypad: 1-9, an empty slot, 0, backspace. Big round or rounded-square keys, at least 72dp.
- Bottom, small and muted: a connection line with a dot, e.g. "● Kassa: 192.168.1.10" (green when
  connected).

States to show, each as its own frame:
1. Empty.
2. Two digits typed.
3. Wrong PIN: the dots shake and turn red, with "PIN noto'g'ri" under them.
4. Locked after too many tries: keypad disabled, "Juda ko'p noto'g'ri urinish. 04:59 dan keyin
   qayta urinib ko'ring" with a countdown.
5. Till not reachable: keypad disabled, an orange banner "Asosiy kassa bilan aloqa yo'q.
   Qayta ulanmoqda…" with a spinner and a "Qayta urinish" button.
6. Not paired yet (first launch): no keypad. A friendly empty state: logo,
   "Telefon hali kassaga ulanmagan", and one primary button "Kassaga ulash" (opens the connect
   screen).
7. Russian version of state 1.
```

---

## Prompt 2: Connect screen (behind the gear)

```
Design "Kassaga ulash", where the phone pairs with the main till. The till shows a QR code in
its settings. The waiter or the owner scans it with this phone.

Frames:
1. Scanning: full-screen camera viewfinder with a rounded square frame and corner marks, a back
   arrow, the title "Kassaga ulash", and the hint "Kassada: Sozlamalar → Yo'ldosh kassalar →
   Telefon qo'shish. Ekrandagi QR kodni skanerlang". At the bottom, a text button
   "Qo'lda kiritish".
2. Camera permission denied: an explanation and a button "Ruxsat berish".
3. Manual fallback: two fields, "Kassa manzili" (placeholder "192.168.1.10") and
   "Juftlash kodi" (6 digits, large spaced digits), plus a primary "Ulash" button.
4. Pairing in progress: spinner, "Ulanmoqda…".
5. Success: a green check, "Ulandi", the restaurant name, "Kassa versiyasi 0.11.0", and a primary
   button "Davom etish" (to the PIN screen).
6. Errors, as one frame with a list of error-message variants in the same slot:
   - "Kod noto'g'ri"
   - "Kodning muddati tugagan. Kassada yangi kod oling"
   - "Kassa topilmadi. Telefon kassa bilan bir Wi-Fi tarmog'idami?"
   - "Tarifingizda ofitsiant ilovasi yo'q (Standard yoki Pro kerak)"
   - "Kassa va ilova versiyalari mos emas. Ilovani yangilang"
7. Already paired (opened from the gear later): a card with the restaurant name, the till
   address, "Oxirgi aloqa: hozir", this phone's name, and the app version. Below it, a secondary
   button "Boshqa kassaga ulash" and a link "Ilova yangilanishi".
```

---

## Prompt 3: Tables screen (home after sign-in)

```
Design the tables screen. The waiter lands here after signing in.

Layout:
- Top bar: the waiter's name with an avatar initial, a connection dot, and a lock icon button
  ("Qulflash", back to the PIN screen).
- Hall tabs as horizontal scrolling pills: "Asosiy zal", "Terassa", "VIP" (hidden when there
  is one hall).
- A filter toggle: "Hammasi" / "Mening stollarim".
- A grid of table cards, 3 per row at 360dp. Each card shows the big table number and its status:
  - Free: plain surface, number only.
  - Busy (another waiter's order): primary-soft fill, the total "245 000 so'm", the waiter's name
    "Aziz", the time open "45 daq".
  - Mine: the same, with an orange left border and a small "Siz" badge.
  - Open on another device right now: a lock icon and "Kassada ochiq" (or the waiter's name),
    looking slightly disabled.
- No floating action button. Tapping a card opens the order screen.

Frames:
1. A normal service: 18 tables, a mix of statuses.
2. No open shift: a warning banner across the top, "Smena ochilmagan. Buyurtma olish uchun
   kassada smenani oching". Tables are shown but tapping one does nothing.
3. Empty hall (no tables): an empty state.
4. Lost connection: a thin orange bar under the top bar, "Aloqa yo'q, qayta ulanmoqda…". The
   data stays visible but greyed.
5. Russian version of frame 1.
```

---

## Prompt 4: Order screen

```
Design the order screen for one table. This is the main working screen; make it the best one.

Header: back arrow, "Stol 7", the guest count as a chip "👥 4" (tap to change), and an overflow
menu with: "Stolni ko'chirish", "Buyurtmani bekor qilish" (danger).

Body, menu browsing:
- A search field: "Taom qidirish".
- Category chips, horizontally scrolling, optionally with a small picture: "Hammasi", "Lavash",
  "Burger", "Ichimliklar", "Salatlar".
- A dish list: one row per dish, with a 56dp thumbnail (optional; there is a no-picture variant),
  the name, the price, and on the right either a "+" button or, once added, a "– 2 +" stepper.
  A stock badge: "Qoldi: 3" in warning color when low; "Tugadi" and the row disabled when 0.
  Dishes sold by weight show "kg" next to the price.

Bottom, the cart:
- A sticky bar: "5 ta taom · 187 000 so'm" and a primary button "Saqlash" (sends to the kitchen).
  An unsaved-changes dot on the bar.
- Tapping the bar opens a bottom sheet with the order lines: name, portion label ("0.7 porsiya"),
  weight ("0,450 kg"), a stepper, the line total. Swipe or a trash icon to remove. Lines already
  sent to the kitchen look normal. New or changed lines get a small "Yangi" tag.
- In the sheet: subtotal, "Xizmat haqi 10%" when it is on, the total, and two buttons:
  "Oldindan chek" (secondary, prints the pre-bill on the till) and "Saqlash" (primary).

Frames:
1. A new order, browsing the menu, with 3 dishes added (cart bar visible).
2. The cart sheet open, with 5 lines including one portion dish and one weight dish.
3. The no-pictures variant of frame 1.
4. Read-only: another waiter's order, which this waiter may not change. A banner: "Bu buyurtma
   Aziz'niki. Faqat oldindan chek chiqarish mumkin". Steppers hidden. Only "Oldindan chek".
5. Saving: the button shows a spinner. Then a toast: "Saqlandi, oshxonaga yuborildi".
6. Russian version of frame 2.
```

---

## Prompt 5: Dialogs and sheets on the order screen

```
Design these as Android bottom sheets (or small centered dialogs where noted), in the same style:

1. Portion picker (dish with portions): three large options, "1 porsiya · 45 000",
   "0.7 porsiya · 31 500", "0.5 porsiya · 22 500".
2. Weight entry (dish sold by weight): a numeric keypad, a big display "0,450 kg", the live price
   "= 54 000 so'm", and "Qo'shish".
3. Guest count: a stepper with a big number, plus quick chips 1-8.
4. Move to another table: a grid of FREE tables only, grouped by hall; tap one, then confirm
   "Stol 7 → Stol 12 ga ko'chirilsinmi?".
5. Cancel order (centered dialog, danger): "Buyurtma bekor qilinsinmi? Oshxonaga bekor qilish
   cheki chiqadi", with "Yo'q" and "Bekor qilish" (danger).
6. Leave with unsaved changes (centered dialog): "Saqlanmagan o'zgarishlar bor", with buttons
   "Saqlash", "Saqlamasdan chiqish", "Qolish".
7. Stock shortage (after Save): "Yetarli emas: Lavash, so'raldi 4, qoldi 2", with
   "Tuzatish" (sets the line to 2).
8. Changed on another device (centered dialog): "Bu buyurtma boshqa qurilmada o'zgartirildi.
   Yangilangan holatni yuklang", with "Yangilash".
9. Toasts: success, error, info.
```

---

## Prompt 6: App update screen

```
Design "Ilova yangilanishi", opened from the connect screen or from a top banner
"Yangi versiya bor: 0.12.0".

Frames:
1. Up to date: the version, "Oxirgi tekshiruv: bugun 09:14", and a "Tekshirish" button.
2. Update available: the version, a short "Nima yangi" list, and a primary "Yuklab olish" button.
3. Downloading: a progress bar, "18,4 / 32,0 MB".
4. Ready: "O'rnatish". Explain in one muted line that Android will ask for permission to install.
5. Error: "Yuklab bo'lmadi. Internet bormi?" with "Qayta urinish".
```

---

## Prompt 7: Till side, adding a phone (desktop, 1366x768)

```
Now design one desktop screen for the Windows POS (same tokens, Segoe UI font, 1366x768).
In Settings → "Yo'ldosh kassalar" there is already a list of paired satellite tills. Add phones:

- A button "Telefon qo'shish (ofitsiant)" next to the existing "Kassa qo'shish".
- On click, a modal: a large QR code (holding the address, port and a one-time code), under it
  the 6-digit code in big spaced digits and the address "192.168.1.10:5180" for manual entry, a
  countdown "9:41 qoldi", and a "Bekor qilish" button. Hint: "Telefonda: ⚙ → Kassaga ulash →
  QR kodni skanerlang".
- The devices list gets a type column with an icon: "Kassa" (monitor) / "Telefon" (smartphone),
  plus the name, last seen ("Onlayn" with a green dot, or "2 soat oldin"), and an "Uzish" (revoke)
  action.
- A plan-limit state: the button disabled with "Tarifingizda ofitsiant ilovasi yo'q. Standard
  yoki Pro tarifiga o'ting".
```

---

## Prompt 8: Consistency pass

```
Put every phone screen on one canvas in flow order:
PIN → connect → tables → order → sheets → update.
Check and fix:
- the same top bar height, paddings, button heights (48dp), and radius everywhere;
- every touch target at least 48dp, and the primary actions within thumb reach;
- contrast at least 4.5:1 for text in light and dark (status colors on soft fills especially);
- Russian frames: no clipped or wrapped-badly text;
- one empty, one loading and one error state per screen.
List anything you changed.
```

---

## Prompt 9: Handoff for React Native

```
Prepare the handoff for a React Native (Expo) developer:
1. Design tokens as one TypeScript object: colors (light and dark), spacing, radius, font sizes,
   and elevations as Android elevation numbers (not CSS shadows).
2. A component inventory with props and states: Button (primary/secondary/ghost/danger,
   loading, disabled), PinKeypad, PinDots, TableCard (free/busy/mine/locked), CategoryChip,
   DishRow, QtyStepper, CartBar, BottomSheet, Banner (warning/offline), Toast, Dialog.
3. For each screen: the layout as a component tree, scroll behavior, and which parts stay fixed.
4. Every UI string as an uz/ru key-value table (keys like "order.save"), taken from the frames.
Don't write app logic or networking; only presentation.
```
