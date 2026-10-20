import type { z } from 'zod';
import type { updateReceiptLayoutInput } from '@shared/schemas';
import type { OrderType, ReceiptLayoutDto, ReceiptSettingsDto } from '@shared/types';
import type { DbOrTx } from '../domain/db';
import { getReceiptSettings } from '../settings/settings';

/** Settings order: General (tables) first, then takeaway and delivery. */
export const LAYOUT_TYPES: readonly OrderType[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];

export const DEFAULT_TOP_IMAGE_WIDTH = 60;
export const DEFAULT_BOTTOM_IMAGE_WIDTH = 40;

type LayoutRow = Omit<ReceiptLayoutDto, 'saved' | 'orderType'> & {
  orderType: string;
  updatedAt: Date;
};

const toDto = (row: LayoutRow): ReceiptLayoutDto => ({
  orderType: row.orderType as OrderType,
  showAddress: row.showAddress,
  showPhone: row.showPhone,
  showDateTime: row.showDateTime,
  showOrderNumber: row.showOrderNumber,
  showCustomer: row.showCustomer,
  footerNote: row.footerNote,
  topImage: row.topImage,
  topImageWidth: row.topImageWidth,
  bottomImage: row.bottomImage,
  bottomImageWidth: row.bottomImageWidth,
  saved: true,
});

/**
 * General before it was ever saved: what receipts printed before layouts existed (the old
 * receipt_settings switches and footer), no images.
 */
export function legacyLayout(settings: ReceiptSettingsDto | null): ReceiptLayoutDto {
  return {
    orderType: 'DINE_IN',
    showAddress: settings?.printShowAddress ?? true,
    showPhone: settings?.printShowPhone ?? true,
    showDateTime: settings?.printShowDateTime ?? true,
    showOrderNumber: settings?.printShowOrderNumber ?? true,
    showCustomer: true,
    footerNote: settings?.footerNote ?? '',
    topImage: null,
    topImageWidth: DEFAULT_TOP_IMAGE_WIDTH,
    bottomImage: null,
    bottomImageWidth: DEFAULT_BOTTOM_IMAGE_WIDTH,
    saved: false,
  };
}

/**
 * Every type's layout, General first. A type never saved prints like General (Delivery and
 * Takeaway "start as copies of General"); General never saved prints like the old settings.
 */
export async function getReceiptLayouts(db: DbOrTx): Promise<ReceiptLayoutDto[]> {
  const rows = await db.receiptLayout.findMany();
  const byType = new Map(rows.map((r) => [r.orderType as string, toDto(r)]));
  const general = byType.get('DINE_IN') ?? legacyLayout(await getReceiptSettings(db));
  return LAYOUT_TYPES.map(
    (type) => byType.get(type) ?? { ...general, orderType: type, saved: false },
  );
}

export async function getReceiptLayout(db: DbOrTx, type: OrderType): Promise<ReceiptLayoutDto> {
  return (await getReceiptLayouts(db)).find((l) => l.orderType === type)!;
}

/** Saves one type's layout: the given values over what it prints now (inherited or stored). */
export async function updateReceiptLayout(
  db: DbOrTx,
  input: z.infer<typeof updateReceiptLayoutInput>,
): Promise<ReceiptLayoutDto> {
  const { orderType, ...values } = input;
  const { saved: _saved, orderType: _type, ...current } = await getReceiptLayout(db, orderType);
  const data = { ...current, ...values };
  const row = await db.receiptLayout.upsert({
    where: { orderType },
    create: { orderType, ...data },
    update: data,
  });
  return toDto(row);
}

/** Pictures the layouts use: the image cleanup must keep them. */
export async function receiptImageNames(db: DbOrTx): Promise<string[]> {
  const rows = await db.receiptLayout.findMany({
    select: { topImage: true, bottomImage: true },
  });
  return rows.flatMap((r) => [r.topImage, r.bottomImage]).filter((n): n is string => !!n);
}
