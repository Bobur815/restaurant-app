# SavdoChef feature inventory (legacy, tag `legacy-js-express`)

Parity checklist for Phase 8. Source: `origin/main` @ `46542d8` (2026-01-14). One line per feature; `[ ]` = not yet ported/verified in the rewrite.

## Startup and setup
- [ ] First run: copy seed `app.db` into `<userData>/data`, boot Express, poll `/api/setup/status`, open `setup.html` or login (`main.js`).
- [ ] Setup status: complete if `Setting.setup_complete === true` OR (an ADMIN exists AND a receipt-settings row exists) (`router/setup.js`).
- [ ] Setup wizard: create first ADMIN (username ≥ 3, password ≥ 6, refused if an admin exists) + receipt settings (`html/setup.html`, IPC `setup:submit`, `setup:done`).

## Auth and users
- [ ] Login by username/password, inactive users rejected; current user held in main process (`attempt-login`, `auth:me`, `auth:logout`).
- [ ] Single-user profile: view/change username, change password (min 6) — always targets the first ADMIN (`Users.service.js`, `renderer/settings/setting.js`).
- [ ] `Permission` table and STAFF role exist in schema but are not used anywhere.

## Main window / navigation
- [ ] Sidebar pages loaded into one window by fetching HTML fragments: `buyurtma` (orders), `menu`, `session`, `cheklar` (checks), `hisobotlar` (reports), `settings` (`renderer/mainrenderer.js`).
- [ ] Brand name in header from receipt settings (falls back to hard-coded "Shoxona").
- [ ] Table count configurable, stored in `localStorage.table_count` (default 10).
- [ ] Click sound on buttons (`sounds/click.mp3`).

## Menu and categories
- [ ] Menu list filtered by category + search (`GET /menu?category&search`), all items (`/menu/all`), by id.
- [ ] Create/update/delete dish in a child window: name (unique), price, description, category, image, `portions` flag, `soldByWeight` flag (`add-item.html`, `add_items.js`).
- [ ] Image picked via native dialog, copied into app image dir, resolved by `get-image-path` IPC.
- [ ] Category CRUD in a child window, unique name (`category.settings.html`).
- [ ] Menu child windows refresh the main window via `menu-updated` → `reload-menu`.

## Orders (table screen)
- [ ] Table grid; per table at most one `pending` order (`GET /orders/:tableNumber` returns its items + `remainingQuantity` from the open session).
- [ ] Add dishes to cart; portions selector (1 / 0.7 / 0.5) for `portions` dishes; weight entry (units + kg) for `soldByWeight` dishes (`order_items.js`, `orderPageHelpers.js`, `utils/config_porsiya.js`).
- [ ] Client-side stock guards using `remainingQuantity`.
- [ ] Create order: requires an open session; stock check per dish against session remaining; `orderNumber` `YYYY-NNNNN` from `Counter` inside the create transaction.
- [ ] Update pending order: replace items, recompute total, apply sold-quantity delta to the session.
- [ ] Cancel pending order: revert session sold quantities, delete items + order (`cancelOrder.js`).

## Payment and printing
- [ ] Payment modal window: method cash / card / click / debt (aliases `klik`, `nasiya`, `credit`), status paid/pending/refunded; payment + order→`completed` in one transaction (`payment.html`, `confirmPayment.js`).
- [ ] Receipt print after payment: HTML receipt from receipt settings, silent print to a Windows driver printer, matching "XP-80"/"XP-80C" by name (80 mm thermal) (`printing.js`).
- [ ] Receipt settings: restaurant name, address, phone, extra phones, footer, locale, currency, width px, separator char/count, show address/phone/datetime/order number, logo (`settings/receipt-setting.js`).

## Checks (cheklar)
- [ ] Payment list with filters: date range, method, status, table; sort by table / date / amount (`GET /payment`).
- [ ] Edit a check (amount, method, status, date) by order number (`PUT /payment/:orderNumber`, `editCheck.js`).
- [ ] Delete a check's payments by order number (`DELETE /payment/:orderNumber`).
- [ ] Reprint a check (`checks.js` → `print-receipt`).
- [ ] View order details by query (`GET /orders?…`, `getOrderByQuery.js`).

## Reports (hisobotlar)
- [ ] Per-day: number of orders, total, cash, card, click, plastic (= card + click), debt, expenses (residual write-off / waste / breakage, qty) (`GET /payment/report`).
- [ ] Products sold per day (sums `OrderItem.quantity`, not effective qty).
- [ ] Date range presets (`utils/setReportDate.js`), sort by date or amount. Chart.js is a dependency.

## Sessions (smena), residuals, expenses
- [ ] Session list with items (initial / sold / remaining), open/edit/close in a child window (`session.html`, `session-create.html`).
- [ ] Open session: only one `open`; items `{menuId, initialQuantity}`; pending CARRY residuals marked `applied` to the new session; UI pre-fills carried quantities (`handleResiduals.js`).
- [ ] Edit open session: change initial quantities; rejected (409) if below sold or below quantity in pending orders; new dishes can be added; dishes are never removed.
- [ ] Close session: per leftover dish choose carry-to-next / write-off (default: all carry); write-off creates an `Expense` (`residual_writeoff`, unit cost = menu price) linked from a WRITE_OFF residual.
- [ ] Residual list with filters/pagination/totals by action (`GET /residual`); apply selected residuals to a session (`POST /residual/apply`).
- [ ] Expense list with filters/pagination/totals by type (`GET /expense`); no UI to create `waste`/`breakage` expenses.
- [ ] Delete session (cascades items, residuals, expenses).

## Legacy behaviour to pin down with characterization tests (decide: keep or fix)
1. Stock math is inconsistent between operations (`Order.service.js`):
   - create: weight dish uses `qty × weightKg`, portion dish `qty × portions`;
   - update delta: weight dish uses `qty × 1` (ignores `weightKg`), portion dish `qty × portions`;
   - cancel: reverts `-qty` for every dish (ignores both portions and weight).
   → sold quantities drift after edits/cancels of portion or weight items.
2. `createOrder` / `updateOrder` / `cancelOrder` call `recordSale` **outside** the order transaction, one dish at a time; a failure mid-loop leaves partial stock updates.
3. Order total is taken from client-sent `totalPrice`, not recomputed from menu prices.
4. `Session.close` is not transactional (residuals, expenses and the close are separate writes).
5. `Residual @@unique([sessionId, menuId, status])` vs. upsert keyed on `(sessionId, menuId, action)`: if one dish is split at close (part carry → `pending`, part write-off → `applied`), opening the next session flips the carry row to `applied` and hits the unique constraint (P2002), so the new session is created but its carry residuals stay `pending`. Verify with a test before fixing.
6. `mode: "insensitive"` in residual/expense note search is unsupported on SQLite → `q` filter throws.
7. Reports "products sold" sum raw `quantity` (a 0.5 portion counts as 1; weight items count units).
8. `Menu.portions` is a Boolean flag, `OrderItem.portions` is the factor; allowed factors are not enforced server-side.
9. Payment `DELETE` removes payments but leaves the order `completed`.
10. Seed `app.db` is shipped to every install and contains one restaurant's real-looking data (name, address, phone, 9 orders, plaintext admin password).
