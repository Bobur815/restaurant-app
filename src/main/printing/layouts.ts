import type { z } from 'zod';
import type { updatePreBillLayoutInput, updateReceiptLayoutInput } from '@shared/schemas';
import type {
  OrderType,
  PreBillLayoutDto,
  ReceiptLayoutDto,
  ReceiptSettingsDto,
} from '@shared/types';
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

// ── the pre-bill ("Hisob", feature F9) ─────────────────────────────────────────────────────

/** The single pre_bill_layout row. */
export const PRE_BILL_LAYOUT_ID = 1;

/**
 * One layout for every order type. Never saved: General's switches and footer, but no pictures,
 * so a logo only prints on the guest's bill once the owner chooses it.
 */
export async function getPreBillLayout(db: DbOrTx): Promise<PreBillLayoutDto> {
  const row = await db.preBillLayout.findUnique({ where: { id: PRE_BILL_LAYOUT_ID } });
  if (row) {
    const { id: _id, updatedAt: _updatedAt, ...values } = row;
    return { ...values, saved: true };
  }
  const general = await getReceiptLayout(db, 'DINE_IN');
  return {
    showAddress: general.showAddress,
    showPhone: general.showPhone,
    showDateTime: general.showDateTime,
    showOrderNumber: general.showOrderNumber,
    footerNote: general.footerNote,
    topImage: null,
    topImageWidth: DEFAULT_TOP_IMAGE_WIDTH,
    bottomImage: null,
    bottomImageWidth: DEFAULT_BOTTOM_IMAGE_WIDTH,
    saved: false,
  };
}

/** Saves the pre-bill layout: the given values over what it prints now. */
export async function updatePreBillLayout(
  db: DbOrTx,
  input: z.infer<typeof updatePreBillLayoutInput>,
): Promise<PreBillLayoutDto> {
  const { saved: _saved, ...current } = await getPreBillLayout(db);
  const data = { ...current, ...input };
  await db.preBillLayout.upsert({
    where: { id: PRE_BILL_LAYOUT_ID },
    create: { id: PRE_BILL_LAYOUT_ID, ...data },
    update: data,
  });
  return getPreBillLayout(db);
}

/** The pre-bill layout in the shape the receipt builder takes, for an order of this type. */
export async function preBillReceiptLayout(
  db: DbOrTx,
  orderType: OrderType,
): Promise<ReceiptLayoutDto> {
  const { saved, ...values } = await getPreBillLayout(db);
  // Who it is for follows the type's own receipt (takeaway / delivery).
  const { showCustomer } = await getReceiptLayout(db, orderType);
  return { ...values, orderType, showCustomer, saved };
}

/** Pictures the layouts use: the image cleanup must keep them. */
export async function receiptImageNames(db: DbOrTx): Promise<string[]> {
  const select = { topImage: true, bottomImage: true } as const;
  const rows = [
    ...(await db.receiptLayout.findMany({ select })),
    ...(await db.preBillLayout.findMany({ select })),
  ];
  return rows.flatMap((r) => [r.topImage, r.bottomImage]).filter((n): n is string => !!n);
}
