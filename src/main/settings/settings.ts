import { z } from 'zod';
import { SERVICE_FEE_TYPES, type ServiceFeeRule } from '@shared/utils/service-fee';
import {
  nonNegativeDecimal,
  percentAmount,
  type updateReceiptSettingsInput,
  type updateSettingsInput,
} from '@shared/schemas';
import type { AppSettings, ReceiptSettingsDto } from '@shared/types';
import type { DbOrTx } from '../domain/db';
import { notFound } from '../domain/errors';
import { DEFAULT_SETTINGS } from '../database/seed';

/** The receipt settings singleton's primary key (see schema.sqlite.prisma). */
export const RECEIPT_SETTINGS_ID = 1;

/** AppSettings field → settings.key, with the schema each stored JSON value must satisfy. */
const SETTING_KEYS = {
  tableCount: { key: 'table_count', schema: z.number().int().min(1).max(200) },
  language: { key: 'language', schema: z.enum(['uz', 'ru']) },
  theme: { key: 'theme', schema: z.enum(['system', 'light', 'dark']) },
  clickSound: { key: 'click_sound', schema: z.boolean() },
  printAfterPayment: { key: 'print_after_payment', schema: z.boolean() },
  takeawayEnabled: { key: 'takeaway_enabled', schema: z.boolean() },
  deliveryEnabled: { key: 'delivery_enabled', schema: z.boolean() },
  deliveryFeeDefault: { key: 'delivery_fee_default', schema: nonNegativeDecimal },
  splitPaymentEnabled: { key: 'split_payment_enabled', schema: z.boolean() },
  debtEnabled: { key: 'debt_enabled', schema: z.boolean() },
  lanEnabled: { key: 'lan_enabled', schema: z.boolean() },
  showCategoryImages: { key: 'show_category_images', schema: z.boolean() },
  showMenuImages: { key: 'show_menu_images', schema: z.boolean() },
  serviceFeeType: { key: 'service_fee_type', schema: z.enum(SERVICE_FEE_TYPES) },
  serviceFeePercent: { key: 'service_fee_percent', schema: percentAmount },
  serviceFeePerGuest: { key: 'service_fee_per_guest', schema: nonNegativeDecimal },
  setupComplete: { key: 'setup_complete', schema: z.boolean() },
} as const satisfies Record<keyof AppSettings, { key: string; schema: z.ZodType }>;

function parseStored(raw: string | undefined, schema: z.ZodType, fallback: unknown): unknown {
  if (raw === undefined) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback; // corrupt JSON: behave as the default rather than break startup
  }
}

export async function getSettings(db: DbOrTx): Promise<AppSettings> {
  const rows = await db.setting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const result: Record<string, unknown> = {};
  for (const [field, { key, schema }] of Object.entries(SETTING_KEYS)) {
    result[field] = parseStored(byKey.get(key), schema, DEFAULT_SETTINGS[key]);
  }
  return result as unknown as AppSettings;
}

/** Feature F17: the service fee settings as the shared formula takes them. */
export function serviceFeeRule(s: AppSettings): ServiceFeeRule {
  return { type: s.serviceFeeType, percent: s.serviceFeePercent, perGuest: s.serviceFeePerGuest };
}

export async function setSetting<K extends keyof AppSettings>(
  db: DbOrTx,
  field: K,
  value: AppSettings[K],
): Promise<void> {
  const { key, schema } = SETTING_KEYS[field];
  const json = JSON.stringify(schema.parse(value));
  await db.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
}

export async function updateSettings(
  db: DbOrTx,
  input: z.infer<typeof updateSettingsInput>,
): Promise<AppSettings> {
  for (const [field, value] of Object.entries(input)) {
    if (value !== undefined) await setSetting(db, field as keyof AppSettings, value as never);
  }
  return getSettings(db);
}

type ReceiptRow = ReceiptSettingsDto & { id: number; createdAt: Date; updatedAt: Date };

export function toReceiptDto(row: ReceiptRow): ReceiptSettingsDto {
  const { id: _id, createdAt: _c, updatedAt: _u, ...dto } = row;
  return dto;
}

export async function getReceiptSettings(db: DbOrTx): Promise<ReceiptSettingsDto | null> {
  const row = await db.receiptSettings.findUnique({ where: { id: RECEIPT_SETTINGS_ID } });
  return row ? toReceiptDto(row) : null;
}

export async function updateReceiptSettings(
  db: DbOrTx,
  input: z.infer<typeof updateReceiptSettingsInput>,
): Promise<ReceiptSettingsDto> {
  const existing = await db.receiptSettings.findUnique({ where: { id: RECEIPT_SETTINGS_ID } });
  if (!existing) throw notFound('Chek sozlamalari');
  const write = async (tx: DbOrTx) => {
    const row = await tx.receiptSettings.update({
      where: { id: RECEIPT_SETTINGS_ID },
      data: input,
    });
    if (input.printerName !== undefined) await setMainPrinterWindowsName(tx, input.printerName);
    return row;
  };
  // Both or neither (F11): receipts follow the printer row, the page shows the setting.
  const row =
    input.printerName !== undefined && '$transaction' in db
      ? await db.$transaction((tx) => write(tx))
      : await write(db);
  return toReceiptDto(row);
}

/**
 * Feature F11: the main printer row (printers, isMain) is where receipts look for their printer;
 * a receipt-settings write that names a printer keeps it in step (printing/printers.ts keeps the
 * other direction).
 */
export async function setMainPrinterWindowsName(
  db: DbOrTx,
  windowsName: string | null,
): Promise<void> {
  await db.printer.updateMany({ where: { isMain: true }, data: { windowsName } });
}
