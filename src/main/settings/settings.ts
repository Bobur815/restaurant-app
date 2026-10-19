import { z } from 'zod';
import {
  nonNegativeDecimal,
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
  lanEnabled: { key: 'lan_enabled', schema: z.boolean() },
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
  const row = await db.receiptSettings.update({ where: { id: RECEIPT_SETTINGS_ID }, data: input });
  return toReceiptDto(row);
}
