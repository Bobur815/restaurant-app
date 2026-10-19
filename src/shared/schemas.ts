import { z } from 'zod';
import { isDecimalString } from './utils/decimal';
import { PORTION_FACTORS } from './utils/order-line';

/**
 * Input schemas for every IPC channel. The main process parses every payload with these before
 * any domain code runs; the renderer may reuse them for form validation. Messages are Uzbek.
 */

// ── Primitives ───────────────────────────────────────────────────────────────────────────────

export const id = z.number().int().positive();

export const decimalString = z
  .string()
  .refine(isDecimalString, { message: "Son noto'g'ri (masalan 12500 yoki 0.5)" });

export const nonNegativeDecimal = decimalString.refine((s) => !s.startsWith('-'), {
  message: "Manfiy bo'lishi mumkin emas",
});

export const positiveDecimal = nonNegativeDecimal.refine((s) => /[1-9]/.test(s), {
  message: "Noldan katta bo'lishi kerak",
});

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, { message: `${label}: kamida ${min} ta belgi` })
    .max(max, { message: `${label}: ko'pi bilan ${max} ta belgi` });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** YYYY-MM-DD, interpreted in the till's local time. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Sana YYYY-MM-DD' });

export const role = z.enum(['ADMIN', 'STAFF']);
export const paymentMethod = z.enum(['cash', 'card', 'click', 'debt']);
export const paymentStatus = z.enum(['paid', 'pending', 'refunded']);
export const tableNumber = z.number().int().min(1).max(999);

export const empty = z.undefined();

const page = {
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(200).default(20),
};

// ── Auth & users ─────────────────────────────────────────────────────────────────────────────

export const username = trimmed(3, 32, 'Login').regex(/^[\p{L}\p{N}._-]+$/u, {
  message: "Login faqat harf, raqam, '.', '_' va '-' dan iborat bo'lishi mumkin",
});
export const password = z
  .string()
  .min(6, { message: "Parol kamida 6 ta belgidan iborat bo'lishi kerak" })
  .max(128);

export const loginInput = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

/** Lock-screen PIN: exactly 4 digits. */
export const pinCode = z
  .string()
  .regex(/^\d{4}$/, { message: "PIN kod 4 ta raqamdan iborat bo'lishi kerak" });

/** Set or change the PIN (or remove it with `pin: null`); the account password confirms it. */
export const setPinInput = z.object({
  currentPassword: z.string().min(1),
  pin: pinCode.nullable(),
});

export const pinLoginInput = z.object({ userId: id, pin: pinCode });

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const updateProfileInput = z.object({
  username: username.optional(),
  fullName: optionalText(64).optional(),
});

export const createUserInput = z.object({
  username,
  password,
  fullName: optionalText(64),
  role: role.default('STAFF'),
});

export const updateUserInput = z.object({
  id,
  fullName: optionalText(64).optional(),
  role: role.optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordInput = z.object({ id, newPassword: password });

// ── Setup & settings ─────────────────────────────────────────────────────────────────────────

// Update schemas are built from default-free fields: zod 4 applies `.default()` even inside
// `.partial()`, which would silently reset every field an update did not mention.
const receiptFields = {
  restaurantName: trimmed(1, 80, 'Restoran nomi'),
  address: z.string().trim().max(160),
  phone: z.string().trim().max(40),
  extraPhones: z.string().trim().max(120),
  footerNote: z.string().trim().max(200),
  locale: z.enum(['uz', 'ru']),
  currency: z.string().trim().min(1).max(8),
  printerName: optionalText(120),
  printWidthPx: z.number().int().min(200).max(1000),
  printUseStarsSep: z.boolean(),
  printSeparatorChar: z.string().min(1).max(1),
  printSeparatorCount: z.number().int().min(4).max(80),
  printShowAddress: z.boolean(),
  printShowPhone: z.boolean(),
  printShowDateTime: z.boolean(),
  printShowOrderNumber: z.boolean(),
};

export const receiptSettingsInput = z.object({
  ...receiptFields,
  address: receiptFields.address.default(''),
  phone: receiptFields.phone.default(''),
  extraPhones: receiptFields.extraPhones.default(''),
  footerNote: receiptFields.footerNote.default(''),
  locale: receiptFields.locale.default('uz'),
  currency: receiptFields.currency.default('UZS'),
  printWidthPx: receiptFields.printWidthPx.default(420),
  printUseStarsSep: receiptFields.printUseStarsSep.default(true),
  printSeparatorChar: receiptFields.printSeparatorChar.default('*'),
  printSeparatorCount: receiptFields.printSeparatorCount.default(38),
  printShowAddress: receiptFields.printShowAddress.default(true),
  printShowPhone: receiptFields.printShowPhone.default(true),
  printShowDateTime: receiptFields.printShowDateTime.default(true),
  printShowOrderNumber: receiptFields.printShowOrderNumber.default(true),
});

export const updateReceiptSettingsInput = z.object(receiptFields).partial();

/** Receipt preview: the saved settings with these (unsaved) form values on top. */
export const previewReceiptInput = updateReceiptSettingsInput.default({});

export const printReceiptInput = z.object({ orderId: id });

export const setupInput = z.object({
  admin: z.object({ username, password, fullName: optionalText(64) }),
  receipt: receiptSettingsInput,
  tableCount: z.number().int().min(1).max(200).default(10),
});

export const updateSettingsInput = z
  .object({
    tableCount: z.number().int().min(1).max(200),
    language: z.enum(['uz', 'ru']),
    theme: z.enum(['system', 'light', 'dark']),
    clickSound: z.boolean(),
    printAfterPayment: z.boolean(),
    lanEnabled: z.boolean(),
  })
  .partial();

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────

const categoryFields = {
  nameUz: trimmed(1, 60, 'Nomi (uz)'),
  nameRu: optionalText(60),
  sortOrder: z.number().int().min(0).max(10_000),
};
export const categoryInput = z.object({
  ...categoryFields,
  sortOrder: categoryFields.sortOrder.default(0),
});
export const updateCategoryInput = z
  .object(categoryFields)
  .partial()
  .extend({ id, isActive: z.boolean().optional() });

export const listCategoriesInput = z
  .object({ includeInactive: z.boolean().default(false) })
  .default({ includeInactive: false });

export const listMenuInput = z
  .object({
    categoryId: id.optional(),
    search: z.string().trim().max(60).optional(),
    includeInactive: z.boolean().default(false),
  })
  .default({ includeInactive: false });

const imageFile = z
  .string()
  .regex(/^[a-f0-9]{32}\.(jpg|png|webp)$/, { message: "Rasm fayli noto'g'ri" })
  .nullish()
  .transform((v) => v ?? null);

const menuItemFields = {
  nameUz: trimmed(1, 80, 'Nomi (uz)'),
  nameRu: optionalText(80),
  description: optionalText(300),
  price: nonNegativeDecimal,
  /** Optional unit cost (per kg for weight dishes); null clears it. */
  costPrice: nonNegativeDecimal.nullish().transform((v) => v ?? null),
  imageFile,
  categoryId: id,
  hasPortions: z.boolean(),
  soldByWeight: z.boolean(),
};
export const menuItemInput = z
  .object({
    ...menuItemFields,
    hasPortions: menuItemFields.hasPortions.default(false),
    soldByWeight: menuItemFields.soldByWeight.default(false),
  })
  .refine((m) => !(m.hasPortions && m.soldByWeight), {
    message: 'Taom ham porsiyali, ham vaznli bo‘la olmaydi',
    path: ['soldByWeight'],
  });
export const updateMenuItemInput = z
  .object(menuItemFields)
  .partial()
  .extend({ id, isActive: z.boolean().optional() });

export const idInput = z.object({ id });

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────

const sessionItems = z
  .array(z.object({ menuItemId: id, initialQuantity: nonNegativeDecimal }))
  .min(1, { message: "Kamida bitta taom qo'shing" })
  .refine((items) => new Set(items.map((i) => i.menuItemId)).size === items.length, {
    message: 'Bir taom ikki marta kiritilgan',
  });

export const openSessionInput = z.object({ items: sessionItems });
export const updateSessionInput = z.object({ sessionId: id, items: sessionItems });

export const closeSessionInput = z.object({
  sessionId: id,
  actions: z
    .array(
      z.object({
        menuItemId: id,
        carryQuantity: nonNegativeDecimal.default('0'),
        writeOffQuantity: nonNegativeDecimal.default('0'),
        note: z.string().trim().max(200).default(''),
      }),
    )
    .default([]),
});

export const listSessionsInput = z
  .object({
    status: z.enum(['open', 'closed']).optional(),
    limit: z.number().int().min(1).max(500).default(50),
  })
  .default({ limit: 50 });

// ── Orders & payments ────────────────────────────────────────────────────────────────────────

export const orderLineInput = z.object({
  menuItemId: id,
  quantity: z.number().int().min(1).max(999),
  portion: z.enum(PORTION_FACTORS).nullish(),
  weightKg: positiveDecimal.nullish(),
});

export const saveTableOrderInput = z.object({
  tableNumber,
  lines: z.array(orderLineInput).min(1, { message: "Buyurtma bo'sh" }).max(200),
  /** Version the client last saw; omit only when creating. */
  expectedVersion: z.number().int().min(0).optional(),
});

export const tableInput = z.object({ tableNumber });
export const cancelTableOrderInput = z.object({
  tableNumber,
  expectedVersion: z.number().int().min(0).optional(),
});
export const orderNumberInput = z.object({ orderNumber: z.string().regex(/^\d{4}-\d{5,}$/) });

export const payOrderInput = z.object({
  orderId: id,
  method: paymentMethod,
  expectedVersion: z.number().int().min(0).optional(),
});

export const listChecksInput = z.object({
  startDate: isoDate,
  endDate: isoDate,
  method: paymentMethod.optional(),
  status: paymentStatus.optional(),
  tableNumber: tableNumber.optional(),
  sortBy: z.enum(['paidAt', 'tableNumber', 'amount']).default('paidAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export const updatePaymentInput = z.object({
  orderNumber: z.string().regex(/^\d{4}-\d{5,}$/),
  amount: nonNegativeDecimal.optional(),
  method: paymentMethod.optional(),
  status: paymentStatus.optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
});

// ── Residuals, expenses, reports ─────────────────────────────────────────────────────────────

export const listResidualsInput = z.object({
  start: isoDate.optional(),
  end: isoDate.optional(),
  sessionId: id.optional(),
  appliedToSessionId: id.optional(),
  menuItemId: id.optional(),
  status: z.enum(['pending', 'applied']).optional(),
  action: z.enum(['CARRY_TO_NEXT', 'WRITE_OFF']).optional(),
  q: z.string().trim().max(100).optional(),
  sortBy: z.enum(['createdAt', 'quantity']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  ...page,
});

export const applyResidualsInput = z.object({
  residualIds: z.array(id).min(1),
  targetSessionId: id,
});

export const listExpensesInput = z.object({
  start: isoDate.optional(),
  end: isoDate.optional(),
  types: z.array(z.enum(['residual_writeoff', 'waste', 'breakage'])).optional(),
  sessionId: id.optional(),
  menuItemId: id.optional(),
  minAmount: nonNegativeDecimal.optional(),
  maxAmount: nonNegativeDecimal.optional(),
  q: z.string().trim().max(100).optional(),
  sortBy: z.enum(['createdAt', 'amount']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  ...page,
});

export const salesReportInput = z.object({
  start: isoDate,
  end: isoDate,
  sortBy: z.enum(['date', 'total']).default('date'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export type SetupInput = z.infer<typeof setupInput>;
export type SaveTableOrderInput = z.infer<typeof saveTableOrderInput>;
