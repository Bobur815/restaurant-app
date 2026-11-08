import type { z } from 'zod';
import type { previewReceiptInput, testPrintInput } from '@shared/schemas';
import type { OrderDto, ReceiptLayoutDto, ReceiptSettingsDto } from '@shared/types';
import type { Db } from '../domain/db';
import { conflict } from '../domain/errors';
import { getOrder } from '../orders/orders';
import { getReceiptSettings } from '../settings/settings';
import { getReceiptLayout, preBillReceiptLayout } from './layouts';
import { mainPrinterName } from './printers';
import type { PrinterService, PrintResult } from './printer';
import { buildReceiptHtml, receiptLanguage, sampleOrder } from './receipt';

/** A stored picture as a `data:` URL, or null (images/image-store.ts `imageDataUrl`). */
export type ImageLoader = (fileName: string) => string | null;

async function settingsOrThrow(db: Db): Promise<ReceiptSettingsDto> {
  const settings = await getReceiptSettings(db);
  if (!settings) throw conflict('Chek sozlamalari kiritilmagan', { reason: 'NO_RECEIPT_SETTINGS' });
  return settings;
}

/**
 * Prints an order's receipt with its type's layout (General, takeaway, delivery). The content
 * comes from the database, never from the caller.
 */
export async function printOrderReceipt(
  db: Db,
  printer: PrinterService,
  orderId: number,
  image: ImageLoader,
): Promise<PrintResult> {
  const order = await getOrder(db, orderId);
  if (order.status === 'cancelled')
    throw conflict('Bekor qilingan buyurtma uchun chek chiqarilmaydi');
  const settings = await settingsOrThrow(db);
  const layout = await getReceiptLayout(db, order.orderType);
  return printer.print(buildReceiptHtml(order, settings, { layout, image }), {
    preferredName: await mainPrinterName(db),
  });
}

/**
 * The pre-bill ("Hisob", feature F9): a pending order's lines and total for the guest who asks,
 * with the pre-bill layout. Reads the order only: nothing about the order, payments or stock
 * changes. A paid order already has its receipt (Cheklar), a cancelled one has nothing to pay.
 */
export async function printPreBill(
  db: Db,
  printer: PrinterService,
  orderId: number,
  image: ImageLoader,
): Promise<PrintResult> {
  const order = await getOrder(db, orderId);
  if (order.status === 'cancelled')
    throw conflict('Bekor qilingan buyurtma uchun hisob chiqarilmaydi');
  if (order.status === 'completed')
    throw conflict("To'langan buyurtma uchun hisob chiqarilmaydi, chekni Cheklar bo'limidan oling");
  // Only an order still to be paid, whatever statuses come later.
  if (order.status !== 'pending') throw conflict('Bu buyurtma uchun hisob chiqarilmaydi');
  const settings = await settingsOrThrow(db);
  const layout = await preBillReceiptLayout(db, order.orderType);
  return printer.print(buildReceiptHtml(order, settings, { layout, image, preBill: true }), {
    preferredName: await mainPrinterName(db),
  });
}

/** The sample order as a pre-bill shows it: not paid yet. */
function sampleFor(settings: ReceiptSettingsDto, type: OrderDto['orderType'], preBill: boolean) {
  const order = sampleOrder(receiptLanguage(settings), type);
  return preBill
    ? { ...order, status: 'pending' as const, completedAt: null, payments: [] }
    : order;
}

async function layoutFor(
  db: Db,
  type: OrderDto['orderType'],
  preBill: boolean,
): Promise<ReceiptLayoutDto> {
  return preBill ? preBillReceiptLayout(db, type) : getReceiptLayout(db, type);
}

/** One order type's sample receipt, or the sample pre-bill, to the printer (settings page). */
export async function printTestReceipt(
  db: Db,
  printer: PrinterService,
  input: z.infer<typeof testPrintInput>,
  image: ImageLoader,
): Promise<PrintResult> {
  const settings = await settingsOrThrow(db);
  const layout = await layoutFor(db, input.orderType, input.preBill);
  const order = sampleFor(settings, input.orderType, input.preBill);
  return printer.print(
    buildReceiptHtml(order, settings, { layout, image, preBill: input.preBill }),
    { preferredName: await mainPrinterName(db) },
  );
}

/**
 * Image of one order type's sample receipt with the saved settings and layout plus unsaved form
 * values, rendered by the same builder and window the printer uses.
 */
export async function previewReceipt(
  db: Db,
  printer: PrinterService,
  input: z.infer<typeof previewReceiptInput>,
  image: ImageLoader,
): Promise<string> {
  const settings: ReceiptSettingsDto = { ...(await settingsOrThrow(db)), ...input.receipt };
  const layout = {
    ...(await layoutFor(db, input.orderType, input.preBill)),
    ...input.layout,
  };
  const order = sampleFor(settings, input.orderType, input.preBill);
  return printer.preview(
    buildReceiptHtml(order, settings, { layout, image, preBill: input.preBill }),
  );
}
