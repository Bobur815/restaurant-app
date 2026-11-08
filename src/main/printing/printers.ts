import type { z } from 'zod';
import type { listPrintersInput, printerInput, updatePrinterInput } from '@shared/schemas';
import type { PrinterDto } from '@shared/types';
import type { Db, DbOrTx, Tx } from '../domain/db';
import { conflict, invalid, notFound } from '../domain/errors';
import { RECEIPT_SETTINGS_ID } from '../settings/settings';

/**
 * Feature F11: the printers the till prints to. Exactly one is the main printer (receipts,
 * pre-bills, shift reports, test prints); the others are kitchen/bar printers that dishes point
 * at. Printers are hidden, never deleted (kitchen tickets keep pointing at them).
 *
 * The main printer's Windows name is also kept in receipt_settings.printerName, where every
 * build before F11 read it: a till rolled back to an older build still prints its receipts to
 * the right printer.
 */

type PrinterRow = {
  id: number;
  label: string | null;
  windowsName: string | null;
  isMain: boolean;
  isActive: boolean;
  sortOrder: number;
  _count: { menuItems: number };
};

const withCount = { _count: { select: { menuItems: { where: { isActive: true } } } } } as const;

function toDto(p: PrinterRow): PrinterDto {
  return {
    id: p.id,
    label: p.label,
    windowsName: p.windowsName,
    isMain: p.isMain,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    menuItemCount: p._count.menuItems,
  };
}

/** The main printer first, then the others in their order. */
export async function listPrinters(
  db: DbOrTx,
  { includeInactive = false }: Partial<z.infer<typeof listPrintersInput>> = {},
): Promise<PrinterDto[]> {
  const rows = await db.printer.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    include: withCount,
  });
  return rows.map(toDto);
}

async function one(db: DbOrTx, id: number): Promise<PrinterDto> {
  const row = await db.printer.findUnique({ where: { id }, include: withCount });
  if (!row) throw notFound('Printer');
  return toDto(row);
}

/**
 * The Windows name receipts go to: the main printer's, null = pick automatically. A database
 * without a main printer row (should not happen after migration 0015) falls back to the old
 * receipt setting.
 */
export async function mainPrinterName(db: DbOrTx): Promise<string | null> {
  const main = await db.printer.findFirst({ where: { isMain: true } });
  if (main) return main.windowsName;
  const receipt = await db.receiptSettings.findUnique({ where: { id: RECEIPT_SETTINGS_ID } });
  return receipt?.printerName ?? null;
}

async function mirrorToReceiptSettings(tx: Tx, windowsName: string | null): Promise<void> {
  await tx.receiptSettings.updateMany({
    where: { id: RECEIPT_SETTINGS_ID },
    data: { printerName: windowsName },
  });
}

export async function createPrinter(
  db: Db,
  input: z.infer<typeof printerInput>,
): Promise<PrinterDto> {
  const last = await db.printer.aggregate({ _max: { sortOrder: true } });
  const created = await db.printer.create({
    data: {
      label: input.label,
      windowsName: input.windowsName,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
  return one(db, created.id);
}

export async function updatePrinter(
  db: Db,
  input: z.infer<typeof updatePrinterInput>,
): Promise<PrinterDto> {
  const { id, ...data } = input;
  await db.$transaction(async (tx) => {
    const current = await tx.printer.findUnique({ where: { id } });
    if (!current) throw notFound('Printer');
    if (current.isMain && data.isActive === false) {
      throw conflict("Asosiy printerni yashirib bo'lmaydi. Avval boshqasini asosiy qiling", {
        reason: 'MAIN_PRINTER',
      });
    }
    // Only the main printer may pick automatically; a kitchen ticket needs a real printer.
    if (!current.isMain && data.windowsName === null) {
      throw invalid('Printerni tanlang', { field: 'windowsName' });
    }
    await tx.printer.update({ where: { id }, data });
    if (current.isMain && data.windowsName !== undefined) {
      await mirrorToReceiptSettings(tx, data.windowsName);
    }
  });
  return one(db, id);
}

/**
 * Makes another shown printer the main one. The old main stays as an ordinary printer (its dishes
 * keep printing there). Release first, then take: the database allows one main printer at a time
 * (printers.mainGuard, migration 0015), so the other order would be refused.
 */
export async function setMainPrinter(db: Db, printerId: number): Promise<PrinterDto[]> {
  await db.$transaction(async (tx) => {
    const target = await tx.printer.findUnique({ where: { id: printerId } });
    if (!target || !target.isActive) throw notFound('Printer');
    if (target.isMain) return;
    // The main printer may pick automatically; a kitchen printer may not. If dishes send their
    // tickets to a main printer without a name, it needs one before it stops being the main.
    const current = await tx.printer.findFirst({
      where: { isMain: true },
      include: { _count: { select: { menuItems: { where: { isActive: true } } } } },
    });
    if (current && !current.windowsName && current._count.menuItems > 0) {
      throw conflict(
        'Asosiy printerga taomlar biriktirilgan, lekin printer tanlanmagan. Avval uni tanlang',
        { reason: 'NO_PRINTER' },
      );
    }
    await tx.printer.updateMany({ where: { isMain: true }, data: { isMain: false } });
    await tx.printer.update({ where: { id: printerId }, data: { isMain: true } });
    await mirrorToReceiptSettings(tx, target.windowsName);
  });
  return listPrinters(db, { includeInactive: true });
}
