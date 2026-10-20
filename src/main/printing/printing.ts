import type { z } from 'zod';
import type { previewReceiptInput } from '@shared/schemas';
import type { OrderType, ReceiptSettingsDto } from '@shared/types';
import type { Db } from '../domain/db';
import { conflict } from '../domain/errors';
import { getOrder } from '../orders/orders';
import { getReceiptSettings } from '../settings/settings';
import { getReceiptLayout } from './layouts';
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
    preferredName: settings.printerName,
  });
}

/** One order type's sample receipt to the configured printer (settings page). */
export async function printTestReceipt(
  db: Db,
  printer: PrinterService,
  orderType: OrderType,
  image: ImageLoader,
): Promise<PrintResult> {
  const settings = await settingsOrThrow(db);
  const layout = await getReceiptLayout(db, orderType);
  const order = sampleOrder(receiptLanguage(settings), orderType);
  return printer.print(buildReceiptHtml(order, settings, { layout, image }), {
    preferredName: settings.printerName,
  });
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
  const layout = { ...(await getReceiptLayout(db, input.orderType)), ...input.layout };
  const order = sampleOrder(receiptLanguage(settings), input.orderType);
  return printer.preview(buildReceiptHtml(order, settings, { layout, image }));
}
