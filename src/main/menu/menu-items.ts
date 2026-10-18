import type { z } from 'zod';
import type { listMenuInput, menuItemInput, updateMenuItemInput } from '@shared/schemas';
import type { DeleteOutcome, MenuItemDto } from '@shared/types';
import { decStr, type Db } from '../domain/db';
import { conflict, invalid, isUniqueViolation, notFound } from '../domain/errors';

const NAME_TAKEN = 'Bunday nomli taom bor';

type Row = {
  id: number;
  nameUz: string;
  nameRu: string | null;
  description: string | null;
  price: { toString(): string };
  costPrice: { toString(): string } | null;
  imageFile: string | null;
  categoryId: number;
  hasPortions: boolean;
  soldByWeight: boolean;
  isActive: boolean;
  category: { nameUz: string };
};

export function toMenuItemDto(m: Row): MenuItemDto {
  return {
    id: m.id,
    nameUz: m.nameUz,
    nameRu: m.nameRu,
    description: m.description,
    price: decStr(m.price),
    costPrice: decStr(m.costPrice),
    imageFile: m.imageFile,
    categoryId: m.categoryId,
    categoryNameUz: m.category.nameUz,
    hasPortions: m.hasPortions,
    soldByWeight: m.soldByWeight,
    isActive: m.isActive,
  };
}

/**
 * Case-insensitive match that also treats the Uzbek apostrophe variants (o' o‘ oʻ g’) as equal.
 * Done in JS: SQLite's LIKE folds ASCII only, so Cyrillic names would not match.
 */
export function normalizeForSearch(s: string): string {
  return s
    .toLocaleLowerCase('uz')
    .replace(/[‘’ʻʼ`´]/g, "'")
    .trim();
}

export async function listMenuItems(
  db: Db,
  input: z.infer<typeof listMenuInput>,
): Promise<MenuItemDto[]> {
  const rows = await db.menuItem.findMany({
    where: {
      ...(input.includeInactive ? {} : { isActive: true }),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    },
    include: { category: { select: { nameUz: true } } },
    orderBy: [{ category: { sortOrder: 'asc' } }, { nameUz: 'asc' }],
  });
  const needle = input.search ? normalizeForSearch(input.search) : '';
  const matched = needle
    ? rows.filter((m) =>
        [m.nameUz, m.nameRu ?? ''].some((n) => normalizeForSearch(n).includes(needle)),
      )
    : rows;
  return matched.map(toMenuItemDto);
}

export async function getMenuItem(db: Db, id: number): Promise<MenuItemDto> {
  const row = await db.menuItem.findUnique({
    where: { id },
    include: { category: { select: { nameUz: true } } },
  });
  if (!row) throw notFound('Taom');
  return toMenuItemDto(row);
}

async function assertCategory(db: Db, categoryId: number): Promise<void> {
  if (!(await db.category.findUnique({ where: { id: categoryId } }))) {
    throw invalid('Kategoriya topilmadi', { field: 'categoryId' });
  }
}

export async function createMenuItem(
  db: Db,
  input: z.infer<typeof menuItemInput>,
): Promise<MenuItemDto> {
  await assertCategory(db, input.categoryId);
  try {
    const created = await db.menuItem.create({ data: input });
    return getMenuItem(db, created.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(NAME_TAKEN, { field: 'nameUz' });
    throw error;
  }
}

/** Where a dish is "live": the open shift's stock or a not-yet-paid order. */
async function liveUsage(
  db: Db,
  menuItemId: number,
): Promise<{ inOpenSession: boolean; inPendingOrder: boolean }> {
  const [sessionItems, pendingLines] = await Promise.all([
    db.sessionItem.count({ where: { menuItemId, session: { status: 'open' } } }),
    db.orderItem.count({ where: { menuItemId, order: { status: 'pending' } } }),
  ]);
  return { inOpenSession: sessionItems > 0, inPendingOrder: pendingLines > 0 };
}

export async function updateMenuItem(
  db: Db,
  input: z.infer<typeof updateMenuItemInput>,
): Promise<MenuItemDto> {
  const { id, ...data } = input;
  const current = await db.menuItem.findUnique({ where: { id } });
  if (!current) throw notFound('Taom');
  if (data.categoryId !== undefined) await assertCategory(db, data.categoryId);

  const hasPortions = data.hasPortions ?? current.hasPortions;
  const soldByWeight = data.soldByWeight ?? current.soldByWeight;
  if (hasPortions && soldByWeight) {
    throw invalid('Taom ham porsiyali, ham vaznli bo‘la olmaydi', { field: 'soldByWeight' });
  }

  // Switching how a dish is counted (pieces / portions / kg) mid-shift would make its stock and
  // its open orders mean something else. Allowed again once the shift is closed.
  const unitChanges = hasPortions !== current.hasPortions || soldByWeight !== current.soldByWeight;
  if (unitChanges) {
    const usage = await liveUsage(db, id);
    if (usage.inOpenSession || usage.inPendingOrder) {
      throw conflict(
        "Ochiq smena yoki to'lanmagan buyurtmada bor taomning sotish turini o'zgartirib bo'lmaydi",
        usage,
      );
    }
  }

  try {
    await db.menuItem.update({ where: { id }, data });
    return getMenuItem(db, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(NAME_TAKEN, { field: 'nameUz' });
    throw error;
  }
}

/**
 * Deletes a dish nobody refers to; a dish with history (orders, shifts, residuals, expenses) is
 * hidden instead (isActive = false) so reports and old checks keep their names.
 */
export async function deleteMenuItem(db: Db, id: number): Promise<DeleteOutcome> {
  const item = await db.menuItem.findUnique({
    where: { id },
    include: {
      _count: { select: { orderItems: true, sessionItems: true, residuals: true, expenses: true } },
    },
  });
  if (!item) throw notFound('Taom');

  const usage = await liveUsage(db, id);
  if (usage.inOpenSession || usage.inPendingOrder) {
    throw conflict("Ochiq smena yoki to'lanmagan buyurtmada bor taomni o'chirib bo'lmaydi", usage);
  }

  const referenced = Object.values(item._count).some((n) => n > 0);
  if (referenced) {
    await db.menuItem.update({ where: { id }, data: { isActive: false } });
    return 'deactivated';
  }
  await db.menuItem.delete({ where: { id } });
  return 'deleted';
}
