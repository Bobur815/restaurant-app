import type { MenuItemDto, PendingCarryDto, SessionDto } from '@shared/types';
import { dec, isDecimalString, toQtyString, type DecimalString } from '@shared/utils/decimal';
import { api } from '../../api';
import { formError } from '../../components/forms';
import { openModal } from '../../components/modal';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { formatQty, localName, toInputDecimal } from '../../utils/format';

const parseQty = (raw: string): DecimalString | null | 'invalid' => {
  const v = raw.trim().replace(',', '.');
  if (v === '') return null;
  return isDecimalString(v) && !v.startsWith('-') ? toQtyString(v) : 'invalid';
};

/**
 * Open a shift (pre-filled with carried leftovers, exact quantities) or edit the open one
 * (quantities can grow, dishes can be added; nothing below what is sold, nothing removed).
 * Resolves the saved shift, or null when cancelled.
 */
export async function shiftQuantitiesModal(session: SessionDto | null): Promise<SessionDto | null> {
  const lang = appStore.get().language;
  const editing = session !== null;
  const [menu, carry] = await Promise.all([
    api.menu.list({}),
    editing ? Promise.resolve<PendingCarryDto[]>([]) : api.sessions.pendingCarry(),
  ]);

  const existing = new Map((session?.items ?? []).map((i) => [i.menuItemId, i]));
  const carried = new Map<number, string>();
  for (const c of carry)
    carried.set(
      c.menuItemId,
      dec(carried.get(c.menuItemId) ?? '0')
        .plus(c.quantity)
        .toFixed(),
    );

  // Dishes already in the shift first, then carried ones, then the rest, each alphabetically.
  const rank = (m: MenuItemDto) => (existing.has(m.id) ? 0 : carried.has(m.id) ? 1 : 2);
  const dishes = [...menu].sort(
    (a, b) => rank(a) - rank(b) || localName(a, lang).localeCompare(localName(b, lang)),
  );

  const inputs = new Map<number, HTMLInputElement>();
  const rows = dishes.map((dish) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'qty-field';
    input.setAttribute('aria-label', `${t('sessions.quantity')}: ${localName(dish, lang)}`);
    const ex = existing.get(dish.id);
    input.value = toInputDecimal(ex ? ex.initialQuantity : carried.get(dish.id));
    input.required = !!ex; // a dish in the open shift cannot be removed
    inputs.set(dish.id, input);

    const tr = document.createElement('tr');
    tr.dataset['search'] = `${dish.nameUz} ${dish.nameRu ?? ''}`.toLocaleLowerCase();
    const hint = ex
      ? `${t('sessions.sold')}: ${formatQty(ex.soldQuantity, lang, dish.soldByWeight)}`
      : carried.has(dish.id)
        ? t('sessions.carried', { qty: formatQty(carried.get(dish.id)!, lang, dish.soldByWeight) })
        : '';
    tr.append(
      html`<td>
          <div class="line-name">${localName(dish, lang)}</div>
          <div class="muted small">${hint}</div>
        </td>
        <td class="muted">${dish.categoryNameUz}</td>
        <td class="num">
          ${input}${dish.soldByWeight ? html`<span class="unit">kg</span>` : ''}
        </td>`,
    );
    return tr;
  });

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = t('sessions.search');
  search.setAttribute('aria-label', t('sessions.search'));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLocaleLowerCase();
    for (const tr of rows) tr.hidden = !!q && !tr.dataset['search']!.includes(q);
  });

  const error = formError();
  const body = html`<p class="muted">${t('sessions.qtyHint')}</p>
    ${carry.length
      ? html`<p class="notice notice-info">
          ${icon('check')}<span>${t('sessions.carryHint', { count: carried.size })}</span>
        </p>`
      : ''}
    <div class="menu-search">${icon('search', 18)}${search}</div>
    <div class="modal-table">
      <table class="lines-table">
        <thead>
          <tr>
            <th>${t('sessions.dish')}</th>
            <th>${t('sessions.category')}</th>
            <th class="num">${t('sessions.quantity')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${error}`;

  let saved: SessionDto | null = null;
  const modal = openModal({
    title: editing ? t('sessions.editTitle') : t('sessions.openTitle'),
    body,
    size: 'lg',
    initialFocus: () => search,
    actions: [
      { label: t('app.cancel') },
      {
        label: editing ? t('app.save') : t('sessions.open'),
        kind: 'primary',
        onClick: async () => {
          error.textContent = '';
          for (const input of inputs.values()) input.removeAttribute('aria-invalid');
          const items: Array<{ menuItemId: number; initialQuantity: string }> = [];
          for (const [menuItemId, input] of inputs) {
            const qty = parseQty(input.value);
            const ex = existing.get(menuItemId);
            const invalid =
              qty === 'invalid' || (ex && (qty === null || dec(qty).lt(ex.soldQuantity)));
            if (invalid) {
              input.setAttribute('aria-invalid', 'true');
              error.textContent =
                ex && qty !== 'invalid'
                  ? t('sessions.belowSold', { sold: formatQty(ex.soldQuantity, lang) })
                  : t('sessions.invalidQty');
              input.focus();
              return false;
            }
            if (qty !== null) items.push({ menuItemId, initialQuantity: qty });
          }
          if (items.length === 0) {
            error.textContent = t('sessions.nothingSelected');
            return false;
          }
          try {
            saved = editing
              ? await api.sessions.update({ sessionId: session.id, items })
              : await api.sessions.open({ items });
            toast(editing ? t('sessions.updated') : t('sessions.opened_toast'), 'success');
          } catch (e) {
            error.textContent = errorMessage(e);
            return false;
          }
        },
      },
    ],
  });
  await modal.closed;
  return saved;
}
