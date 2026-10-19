import type { z } from 'zod';
import type {
  diningTableInput,
  hallInput,
  tableRangeInput,
  updateDiningTableInput,
  updateHallInput,
} from '@shared/schemas';
import type { DiningTableDto, HallDto } from '@shared/types';
import type { Db, DbOrTx, Tx } from '../domain/db';
import { conflict, isUniqueViolation, notFound } from '../domain/errors';

/**
 * Halls (rooms/areas) and their tables. Table numbers are unique across the restaurant and are
 * what orders store, so nothing here touches orders; the rules below only protect the table an
 * unpaid order is sitting on, and keep tables and halls with history from disappearing.
 */

export const DEFAULT_HALL_NAME = 'Asosiy zal';
/** Settings key marking that the first hall was created (seed runs on every start). */
export const HALLS_SEEDED_KEY = 'halls_seeded';

const HALL_TAKEN = 'Bunday nomli zal bor';

type TableRow = {
  id: number;
  number: number;
  hallId: number;
  label: string | null;
  seats: number | null;
  isActive: boolean;
};

const toTableDto = (t: TableRow): DiningTableDto => ({
  id: t.id,
  number: t.number,
  hallId: t.hallId,
  label: t.label,
  seats: t.seats,
  isActive: t.isActive,
});

export async function listHalls(
  db: DbOrTx,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<HallDto[]> {
  const rows = await db.hall.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      tables: {
        where: includeInactive ? {} : { isActive: true },
        orderBy: { number: 'asc' },
      },
    },
  });
  return rows.map((h) => ({
    id: h.id,
    name: h.name,
    sortOrder: h.sortOrder,
    isActive: h.isActive,
    tables: h.tables.map(toTableDto),
  }));
}

async function oneHall(db: DbOrTx, id: number): Promise<HallDto> {
  const found = (await listHalls(db, { includeInactive: true })).find((h) => h.id === id);
  if (!found) throw notFound('Zal');
  return found;
}

export async function createHall(db: Db, input: z.infer<typeof hallInput>): Promise<HallDto> {
  try {
    const last = await db.hall.aggregate({ _max: { sortOrder: true } });
    const created = await db.hall.create({
      data: { name: input.name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    return oneHall(db, created.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(HALL_TAKEN, { field: 'name' });
    throw error;
  }
}

export async function updateHall(db: Db, input: z.infer<typeof updateHallInput>): Promise<HallDto> {
  const { id, ...data } = input;
  const hall = await db.hall.findUnique({
    where: { id },
    include: { _count: { select: { tables: { where: { isActive: true } } } } },
  });
  if (!hall) throw notFound('Zal');
  if (data.isActive === false && hall._count.tables > 0) {
    throw conflict("Zalda faol stollar bor. Avval ularni boshqa zalga o'tkazing yoki yashiring", {
      activeTables: hall._count.tables,
    });
  }
  try {
    await db.hall.update({ where: { id }, data });
    return oneHall(db, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(HALL_TAKEN, { field: 'name' });
    throw error;
  }
}

/** Sets every hall's position at once; `ids` must list each hall exactly once. */
export async function reorderHalls(db: Db, ids: number[]): Promise<HallDto[]> {
  await db.$transaction(async (tx) => {
    const existing = (await tx.hall.findMany({ select: { id: true } })).map((h) => h.id);
    const same =
      ids.length === existing.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => existing.includes(id));
    if (!same) throw conflict("Zallar ro'yxati o'zgargan. Sahifani yangilang", { reason: 'STALE' });
    for (const [sortOrder, id] of ids.entries()) {
      await tx.hall.update({ where: { id }, data: { sortOrder } });
    }
  });
  return listHalls(db, { includeInactive: true });
}

/** Only a hall that never had a table; one with tables (even hidden) is hidden instead. */
export async function deleteHall(db: Db, id: number): Promise<void> {
  const hall = await db.hall.findUnique({
    where: { id },
    include: { _count: { select: { tables: true } } },
  });
  if (!hall) throw notFound('Zal');
  if (hall._count.tables > 0) {
    throw conflict("Zalda stollar bor. Zalni o'chirish o'rniga yashiring", {
      tables: hall._count.tables,
    });
  }
  await db.hall.delete({ where: { id } });
}

async function requireActiveHall(db: DbOrTx, hallId: number): Promise<void> {
  const hall = await db.hall.findUnique({ where: { id: hallId } });
  if (!hall) throw notFound('Zal');
  if (!hall.isActive) throw conflict('Zal yashirilgan. Avval uni faollashtiring');
}

/** A taken number names the table holding it, hidden ones included, so the owner can find it. */
async function numberTaken(db: DbOrTx, numbers: number[], exceptId?: number) {
  const taken = await db.diningTable.findMany({
    where: { number: { in: numbers }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    include: { hall: { select: { name: true } } },
    orderBy: { number: 'asc' },
  });
  if (taken.length === 0) return;
  const list = taken.map((t) => `${t.number} (${t.hall.name}${t.isActive ? '' : ', yashirin'})`);
  throw conflict(`Bu raqamli stol bor: ${list.join(', ')}`, {
    field: 'number',
    numbers: taken.map((t) => t.number),
  });
}

async function pendingOrderOn(db: DbOrTx, tableNumber: number): Promise<boolean> {
  return (await db.order.count({ where: { pendingTable: tableNumber } })) > 0;
}

export async function createTable(
  db: Db,
  input: z.infer<typeof diningTableInput>,
): Promise<DiningTableDto> {
  return db.$transaction(async (tx) => {
    await requireActiveHall(tx, input.hallId);
    await numberTaken(tx, [input.number]);
    return toTableDto(await tx.diningTable.create({ data: input }));
  });
}

export async function createTableRange(
  db: Db,
  input: z.infer<typeof tableRangeInput>,
): Promise<DiningTableDto[]> {
  const numbers = Array.from({ length: input.to - input.from + 1 }, (_, i) => input.from + i);
  return db.$transaction(async (tx) => {
    await requireActiveHall(tx, input.hallId);
    await numberTaken(tx, numbers);
    await tx.diningTable.createMany({
      data: numbers.map((number) => ({ number, hallId: input.hallId })),
    });
    const rows = await tx.diningTable.findMany({
      where: { number: { in: numbers } },
      orderBy: { number: 'asc' },
    });
    return rows.map(toTableDto);
  });
}

/**
 * Edits, moves or hides a table. Renumbering or hiding is refused while an unpaid order sits on
 * it (the order would lose its table). Old paid orders keep the number they were made with.
 */
export async function updateTable(
  db: Db,
  input: z.infer<typeof updateDiningTableInput>,
): Promise<DiningTableDto> {
  const { id, ...data } = input;
  return db.$transaction(async (tx) => {
    const table = await tx.diningTable.findUnique({ where: { id } });
    if (!table) throw notFound('Stol');

    const renumbered = data.number !== undefined && data.number !== table.number;
    const hidden = data.isActive === false && table.isActive;
    if ((renumbered || hidden) && (await pendingOrderOn(tx, table.number))) {
      throw conflict("Stolda to'lanmagan buyurtma bor. Avval uni yoping", {
        reason: 'PENDING_ORDER',
        tableNumber: table.number,
      });
    }
    if (renumbered) await numberTaken(tx, [data.number!], id);
    if (data.hallId !== undefined && data.hallId !== table.hallId)
      await requireActiveHall(tx, data.hallId);
    // Showing a table again in a hidden hall would make it unreachable.
    if (data.isActive === true && !table.isActive)
      await requireActiveHall(tx, data.hallId ?? table.hallId);

    return toTableDto(await tx.diningTable.update({ where: { id }, data }));
  });
}

/** Only a table no order ever used; otherwise it is hidden instead, so history keeps it. */
export async function deleteTable(db: Db, id: number): Promise<void> {
  await db.$transaction(async (tx) => {
    const table = await tx.diningTable.findUnique({ where: { id } });
    if (!table) throw notFound('Stol');
    const used = await tx.order.count({ where: { tableNumber: table.number } });
    if (used > 0) {
      throw conflict("Bu stolda buyurtmalar bo'lgan. O'chirish o'rniga yashiring", {
        reason: 'HAS_ORDERS',
        orders: used,
      });
    }
    await tx.diningTable.delete({ where: { id } });
  });
}

/**
 * First hall on an install (runs from seed on every start, acts once): "Asosiy zal" with tables
 * 1..N, N = the old table-count setting or the highest table number any order used, whichever
 * is larger, so every table an existing order refers to exists.
 */
export async function ensureDefaultHall(tx: Tx, tableCount: number): Promise<void> {
  if (await tx.setting.findUnique({ where: { key: HALLS_SEEDED_KEY } })) return;
  if ((await tx.hall.count()) === 0) {
    const used = await tx.order.aggregate({ _max: { tableNumber: true } });
    const n = Math.max(tableCount, used._max.tableNumber ?? 0);
    await tx.hall.create({
      data: {
        name: DEFAULT_HALL_NAME,
        sortOrder: 0,
        tables: { create: Array.from({ length: n }, (_, i) => ({ number: i + 1 })) },
      },
    });
  }
  await tx.setting.create({ data: { key: HALLS_SEEDED_KEY, value: 'true' } });
}

/**
 * Setup wizard: the first hall gets exactly tables 1..count. Only on a database without orders
 * (setup runs once, on a fresh one); otherwise the existing tables stay as they are.
 */
export async function setDefaultTables(tx: Tx, count: number): Promise<void> {
  if ((await tx.order.count()) > 0) return;
  const hall =
    (await tx.hall.findFirst({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })) ??
    (await tx.hall.create({ data: { name: DEFAULT_HALL_NAME } }));
  await tx.diningTable.deleteMany({});
  await tx.diningTable.createMany({
    data: Array.from({ length: count }, (_, i) => ({ number: i + 1, hallId: hall.id })),
  });
}

/**
 * Adds a table, in the first hall, for every number an order uses that has no table yet (after a
 * legacy import into a database whose first hall already exists).
 */
export async function ensureTablesForOrders(tx: Tx): Promise<number> {
  const used = await tx.order.findMany({
    where: { tableNumber: { gt: 0 } },
    select: { tableNumber: true },
    distinct: ['tableNumber'],
  });
  const have = new Set(
    (await tx.diningTable.findMany({ select: { number: true } })).map((t) => t.number),
  );
  const missing = used.map((o) => o.tableNumber).filter((n) => !have.has(n) && n <= 999);
  if (missing.length === 0) return 0;
  const hall =
    (await tx.hall.findFirst({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })) ??
    (await tx.hall.create({ data: { name: DEFAULT_HALL_NAME } }));
  await tx.diningTable.createMany({
    data: missing.map((number) => ({ number, hallId: hall.id })),
  });
  return missing.length;
}
