import type { z } from 'zod';
import type { previewReceiptInput } from '@shared/schemas';
import type { ReceiptSettingsDto } from '@shared/types';
import type { Db } from '../domain/db';
import { conflict } from '../domain/errors';
import { getOrder } from '../orders/orders';
import { getReceiptSettings } from '../settings/settings';
import type { PrinterService, PrintResult } from './printer';
import { buildReceiptHtml, receiptLanguage, sampleOrder } from './receipt';

async function settingsOrThrow(db: Db): Promise<ReceiptSettingsDto> {
  const settings = await getReceiptSettings(db);
  if (!settings) throw conflict('Chek sozlamalari kiritilmagan', { reason: 'NO_RECEIPT_SETTINGS' });
  return settings;
}

/** Prints an order's receipt. The content comes from the database, never from the caller. */
export async function printOrderReceipt(
  db: Db,
  printer: PrinterService,
  orderId: number,
): Promise<PrintResult> {
  const order = await getOrder(db, orderId);
  if (order.status === 'cancelled')
    throw conflict('Bekor qilingan buyurtma uchun chek chiqarilmaydi');
  const settings = await settingsOrThrow(db);
  return printer.print(buildReceiptHtml(order, settings), {
    preferredName: settings.printerName,
    widthPx: settings.printWidthPx,
  });
}

/** Sample receipt to the configured printer (settings page). */
export async function printTestReceipt(db: Db, printer: PrinterService): Promise<PrintResult> {
  const settings = await settingsOrThrow(db);
  return printer.print(buildReceiptHtml(sampleOrder(receiptLanguage(settings)), settings), {
    preferredName: settings.printerName,
    widthPx: settings.printWidthPx,
  });
}

/**
 * Image of the sample receipt with the saved settings plus unsaved form values, rendered by the
 * same builder and window the printer uses.
 */
export async function previewReceipt(
  db: Db,
  printer: PrinterService,
  overrides: z.infer<typeof previewReceiptInput>,
): Promise<string> {
  const settings: ReceiptSettingsDto = { ...(await settingsOrThrow(db)), ...overrides };
  const html = buildReceiptHtml(sampleOrder(receiptLanguage(settings)), settings);
  return printer.preview(html, settings.printWidthPx);
}
