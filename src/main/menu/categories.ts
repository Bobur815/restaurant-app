import type { z } from 'zod';
import type { categoryInput, updateCategoryInput } from '@shared/schemas';
import type { CategoryDto } from '@shared/types';
import type { Db } from '../domain/db';
import { conflict, isUniqueViolation, notFound } from '../domain/errors';

const NAME_TAKEN = 'Bunday nomli kategoriya bor';

export async function listCategories(
  db: Db,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<CategoryDto[]> {
  const rows = await db.category.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { nameUz: 'asc' }],
    include: { _count: { select: { menuItems: { where: { isActive: true } } } } },
  });
  return rows.map((c) => ({
    id: c.id,
    nameUz: c.nameUz,
    nameRu: c.nameRu,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    menuItemCount: c._count.menuItems,
  }));
}

async function one(db: Db, id: number): Promise<CategoryDto> {
  const found = (await listCategories(db, { includeInactive: true })).find((c) => c.id === id);
  if (!found) throw notFound('Kategoriya');
  return found;
}

export async function createCategory(
  db: Db,
  input: z.infer<typeof categoryInput>,
): Promise<CategoryDto> {
  try {
    const created = await db.category.create({ data: input });
    return one(db, created.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(NAME_TAKEN, { field: 'nameUz' });
    throw error;
  }
}

export async function updateCategory(
  db: Db,
  input: z.infer<typeof updateCategoryInput>,
): Promise<CategoryDto> {
  const { id, ...data } = input;
  if (!(await db.category.findUnique({ where: { id } }))) throw notFound('Kategoriya');
  try {
    await db.category.update({ where: { id }, data });
    return one(db, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(NAME_TAKEN, { field: 'nameUz' });
    throw error;
  }
}

/** Only an empty category can be deleted; one with dishes (even hidden ones) is refused. */
export async function deleteCategory(db: Db, id: number): Promise<void> {
  const category = await db.category.findUnique({
    where: { id },
    include: { _count: { select: { menuItems: true } } },
  });
  if (!category) throw notFound('Kategoriya');
  if (category._count.menuItems > 0) {
    throw conflict(
      "Kategoriyada taomlar bor. Avval ularni boshqa kategoriyaga o'tkazing yoki o'chiring",
      {
        menuItemCount: category._count.menuItems,
      },
    );
  }
  await db.category.delete({ where: { id } });
}
