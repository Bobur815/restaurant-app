import type { StockShortage } from '@shared/types';
import { dec, toQtyString, type Dec } from '@shared/utils/decimal';
import type { Tx } from '../domain/db';
import { conflict } from '../domain/errors';

/**
 * Applies stock movements to a shift's items: positive = sold, negative = given back. Runs inside
 * the caller's transaction (order save, cancel), so the order and its stock change together or
 * not at all (legacy updated stock outside the transaction, one dish at a time: quirk 2).
 *
 * All-or-nothing: if any dish would go below zero sold or above its initial quantity, nothing is
 * written and a CONFLICT lists every shortage.
 */
export async function applyStockDeltas(
  tx: Tx,
  sessionId: number,
  deltas: ReadonlyMap<number, Dec>,
): Promise<void> {
  const ids = [...deltas.entries()].filter(([, d]) => !d.isZero()).map(([id]) => id);
  if (ids.length === 0) return;

  const items = await tx.sessionItem.findMany({
    where: { sessionId, menuItemId: { in: ids } },
    include: { menuItem: { select: { nameUz: true } } },
  });
  const byMenu = new Map(items.map((i) => [i.menuItemId, i]));

  const shortages: StockShortage[] = [];
  const updates: Array<{ id: number; sold: Dec }> = [];

  for (const menuItemId of ids) {
    const delta = deltas.get(menuItemId)!;
    const item = byMenu.get(menuItemId);
    if (!item) {
      if (delta.gt(0)) {
        const name = await tx.menuItem.findUnique({
          where: { id: menuItemId },
          select: { nameUz: true },
        });
        shortages.push({
          menuItemId,
          nameUz: name?.nameUz ?? `#${menuItemId}`,
          requested: toQtyString(delta),
          remaining: '0',
          reason: 'NOT_IN_SESSION',
        });
      }
      // Giving back stock for a dish the shift never had cannot happen through orders; ignore.
      continue;
    }

    const initial = dec(item.initialQuantity.toString());
    const sold = dec(item.soldQuantity.toString());
    const next = sold.plus(delta);
    if (next.gt(initial)) {
      shortages.push({
        menuItemId,
        nameUz: item.menuItem.nameUz,
        requested: toQtyString(delta),
        remaining: toQtyString(initial.minus(sold)),
        reason: 'INSUFFICIENT',
      });
    } else if (next.lt(0)) {
      // Would mean the books are already wrong; refuse rather than hide it.
      throw conflict(`"${item.menuItem.nameUz}" sotilgan miqdori manfiy bo'lib qoladi`);
    } else {
      updates.push({ id: item.id, sold: next });
    }
  }

  if (shortages.length) throw conflict('Yetarli miqdor yo‘q', { shortages });

  for (const u of updates) {
    await tx.sessionItem.update({ where: { id: u.id }, data: { soldQuantity: u.sold.toFixed() } });
  }
}
