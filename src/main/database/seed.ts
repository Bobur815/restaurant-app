import type { PrismaClient } from '../../generated/prisma-sqlite';
import { newPinKey } from '../auth/auth';
import { ensureDefaultHall } from '../halls/halls';

/**
 * Known settings and their defaults (JSON-encoded in `settings.value`). Upserted on every start
 * with `update: {}`, so a value the user changed is never overwritten and a key added in a later
 * version appears on existing installs.
 */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  // Set to true by the setup wizard (Phase 3) once the first admin and receipt settings exist.
  setup_complete: false,
  // Was localStorage `table_count` in legacy.
  table_count: 10,
  language: 'uz',
  theme: 'system',
  click_sound: true,
  // Legacy printed the receipt right after every payment.
  print_after_payment: true,
  // Order types (feature F1-B): both offered; delivery fee typed per order unless set here.
  takeaway_enabled: true,
  delivery_enabled: true,
  delivery_fee_default: '0',
  // Payment options (feature F1-C): both on.
  split_payment_enabled: true,
  debt_enabled: true,
  // LAN access for waiter phones (Phase 8.5); off until enabled in settings.
  lan_enabled: false,
};

/** Legacy defaults (backend/utils/category-add-init.js), with Russian names. Fresh databases only. */
export const DEFAULT_CATEGORIES: ReadonlyArray<{ nameUz: string; nameRu: string }> = [
  { nameUz: 'Ovqatlar', nameRu: 'Блюда' },
  { nameUz: 'Salatlar', nameRu: 'Салаты' },
  { nameUz: 'Ichimliklar', nameRu: 'Напитки' },
  { nameUz: 'Desertlar', nameRu: 'Десерты' },
  { nameUz: 'Non mahsulotlari', nameRu: 'Хлебобулочные изделия' },
];

export const COUNTERS = ['orders'] as const;

export interface SeedOptions {
  /** True when this start created the database. Sample data (categories) goes in only then. */
  freshDatabase: boolean;
}

export async function seedDatabase(
  prisma: PrismaClient,
  { freshDatabase }: SeedOptions,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await tx.setting.upsert({
        where: { key },
        update: {},
        create: { key, value: JSON.stringify(value) },
      });
    }

    // The per-install key PINs are hashed with (auth.ts): made once, never changed or shown.
    if (!(await tx.setting.findUnique({ where: { key: 'pin_key' } }))) {
      await tx.setting.create({ data: { key: 'pin_key', value: JSON.stringify(newPinKey()) } });
    }

    for (const name of COUNTERS) {
      await tx.counter.upsert({ where: { name }, update: {}, create: { name, value: 0 } });
    }

    // First hall and tables (feature F1-A), sized from the table count the till used so far.
    const tableCount = await tx.setting.findUnique({ where: { key: 'table_count' } });
    let count = Number(DEFAULT_SETTINGS['table_count']);
    try {
      const parsed: unknown = JSON.parse(tableCount?.value ?? '');
      if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 200)
        count = parsed;
    } catch {
      // corrupt value: keep the default
    }
    await ensureDefaultHall(tx, count);

    if (freshDatabase && (await tx.category.count()) === 0) {
      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })),
      });
    }
  });
}
