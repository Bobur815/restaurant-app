import { z } from 'zod';
import { dec, isDecimalString } from './utils/decimal';
import { PORTION_FACTORS } from './utils/order-line';
import { digitsOnly, isUzPhoneComplete, normalizeUzPhone } from './utils/phone';
import { TENDER_METHODS } from './utils/split-payment';
import { cleanPermissions, PERMISSIONS } from './permissions';

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

/** A money amount someone types at the till: > 0, at most 2 decimals, at most 1 billion. */
/** A money amount someone types at the till, 0 allowed: at most 2 decimals, at most 1 billion. */
export const moneyOrZero = nonNegativeDecimal
  .refine((s) => !/\.\d{3,}$/.test(s), { message: "Ko'pi bilan 2 ta kasr raqam" })
  .refine(
    (s) => s.replace(/^0+(?=\d)/, '').split('.')[0]!.length <= 10 && dec(s).lte(1_000_000_000),
    { message: 'Juda katta summa' },
  );

/** The same, and more than 0 (repayments, write-offs). */
export const moneyAmount = moneyOrZero.refine((s) => dec(s).gt(0), {
  message: "Noldan katta bo'lishi kerak",
});

/** A money amount someone types (delivery fee): so'm with at most 2 decimals, at most 10 mln. */
export const feeAmount = nonNegativeDecimal
  .refine((s) => !/\.\d{3,}$/.test(s), { message: "Ko'pi bilan 2 ta kasr raqam" })
  .refine((s) => s.replace(/^0+(?=\d)/, '').split('.')[0]!.length <= 8 && Number(s) <= 10_000_000, {
    message: "Juda katta summa (ko'pi bilan 10 000 000)",
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

/** YYYY-MM-DD that exists in the calendar (2026-02-31 does not). */
function isRealDate(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local YYYY-MM-DD, `days` from today. */
export function localDate(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const role = z.enum(['ADMIN', 'CASHIER', 'STAFF']);
export const paymentMethod = z.enum(['cash', 'card', 'click', 'debt']);
export const paymentStatus = z.enum(['paid', 'pending', 'refunded']);
export const tableNumber = z.number().int().min(1).max(999);
export const orderType = z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
export const deliveryStatus = z.enum(['PREPARING', 'ON_THE_WAY', 'DELIVERED']);

/** An Uzbek phone number in any typed form, stored as 998XXXXXXXXX; empty -> null. */
export const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .nullish()
  .transform((v) => (v && digitsOnly(v) && digitsOnly(v) !== '998' ? v : null))
  .refine((v) => v === null || isUzPhoneComplete(v), {
    message: "Telefon raqami to'liq emas: +998 (90) 123-45-67",
  })
  .transform((v) => (v === null ? null : normalizeUzPhone(v)));

export const empty = z.undefined();

const page = {
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(200).default(20),
};

/** A phone that must be there (debt needs a customer). */
export const requiredPhone = optionalPhone.refine((v): v is string => v !== null, {
  message: 'Telefon raqami kerak',
});

// ── Auth & users ─────────────────────────────────────────────────────────────────────────────

/** The login PIN: exactly 4 digits, unique among users (feature F2). */
export const pinCode = z
  .string()
  .regex(/^\d{4}$/, { message: "PIN kod 4 ta raqamdan iborat bo'lishi kerak" });

export const permission = z.enum(PERMISSIONS);
export const permissionList = z
  .array(permission)
  .max(PERMISSIONS.length)
  .transform((list) => cleanPermissions(list));

const userName = trimmed(1, 64, 'Ism');

export const pinLoginInput = z.object({ pin: pinCode });

/** Recovery code (shown once to the admin) and the new PIN for the owner admin. */
export const recoverInput = z.object({
  code: z.string().trim().min(8).max(32),
  pin: pinCode,
});

/** Upgrade with nobody able to log in: the PIN of an administrator, once. */
export const bootstrapPinInput = z.object({ userId: id, pin: pinCode });

export const updateProfileInput = z.object({
  fullName: userName.optional(),
  phone: requiredPhone.optional(),
});

export const createUserInput = z.object({
  fullName: userName,
  phone: requiredPhone,
  role: role.default('STAFF'),
  /** Omitted: the role's defaults. */
  permissions: permissionList.optional(),
  /** Omitted or null: the user cannot log in until a PIN is set. */
  pin: pinCode.nullish(),
});

export const updateUserInput = z.object({
  id,
  fullName: userName.optional(),
  phone: requiredPhone.optional(),
  role: role.optional(),
  permissions: permissionList.optional(),
  isActive: z.boolean().optional(),
  /** A new PIN; null removes it; omitted keeps it. */
  pin: pinCode.nullable().optional(),
});

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
  admin: z.object({ fullName: userName, phone: requiredPhone, pin: pinCode }),
  receipt: receiptSettingsInput,
  tableCount: z.number().int().min(1).max(200).default(10),
});

export const updateSettingsInput = z
  .object({
    language: z.enum(['uz', 'ru']),
    theme: z.enum(['system', 'light', 'dark']),
    clickSound: z.boolean(),
    printAfterPayment: z.boolean(),
    takeawayEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryFeeDefault: feeAmount,
    splitPaymentEnabled: z.boolean(),
    debtEnabled: z.boolean(),
    lanEnabled: z.boolean(),
  })
  .partial();

// ── Halls & tables ───────────────────────────────────────────────────────────────────────────

const hallName = trimmed(1, 40, 'Zal nomi');
const sortOrder = z.number().int().min(0).max(10_000);
const seats = z.number().int().min(1).max(100).nullable();

export const listHallsInput = z
  .object({ includeInactive: z.boolean().default(false) })
  .default({ includeInactive: false });
export const hallInput = z.object({ name: hallName });
export const updateHallInput = z.object({
  id,
  name: hallName.optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/** Every hall's id, in the new order (hidden halls included). */
export const reorderHallsInput = z.object({ ids: z.array(id).min(1).max(100) });

export const diningTableInput = z.object({
  hallId: id,
  number: tableNumber,
  label: optionalText(40),
  seats: seats.default(null),
});
export const updateDiningTableInput = z.object({
  id,
  hallId: id.optional(),
  number: tableNumber.optional(),
  label: optionalText(40).optional(),
  seats: seats.optional(),
  isActive: z.boolean().optional(),
});
/** Adds tables from..to (inclusive) to a hall in one go; at most 100 at a time. */
export const tableRangeInput = z
  .object({ hallId: id, from: tableNumber, to: tableNumber })
  .refine((r) => r.from <= r.to, {
    message: "Boshlang'ich raqam oxirgisidan katta bo'lmasin",
    path: ['to'],
  })
  .refine((r) => r.to - r.from < 100, {
    message: "Bir martada ko'pi bilan 100 ta stol",
    path: ['to'],
  });

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

const orderLines = z.array(orderLineInput).min(1, { message: "Buyurtma bo'sh" }).max(200);

export const saveTableOrderInput = z.object({
  tableNumber,
  lines: orderLines,
  /** Version the client last saw; omit only when creating. */
  expectedVersion: z.number().int().min(0).optional(),
});

/**
 * A takeaway or delivery order: created without orderId, saved again with orderId and the
 * version last seen. Delivery needs a phone and an address.
 */
export const saveOpenOrderInput = z
  .object({
    orderId: id.optional(),
    expectedVersion: z.number().int().min(0).optional(),
    orderType: z.enum(['TAKEAWAY', 'DELIVERY']),
    customerPhone: optionalPhone,
    customerName: optionalText(60),
    deliveryAddress: optionalText(200),
    deliveryNote: optionalText(200),
    /** Omitted: the order's current fee (edit) or the default from settings (new). */
    deliveryFee: feeAmount.optional(),
    lines: orderLines,
  })
  .superRefine((v, ctx) => {
    if (v.orderType !== 'DELIVERY') return;
    if (!v.customerPhone)
      ctx.addIssue({
        code: 'custom',
        path: ['customerPhone'],
        message: 'Yetkazib berish uchun telefon raqami kerak',
      });
    if (!v.deliveryAddress)
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddress'],
        message: 'Yetkazib berish manzili kerak',
      });
  });

export const orderIdInput = z.object({
  orderId: id,
  expectedVersion: z.number().int().min(0).optional(),
});

export const deliveryStatusInput = z.object({
  orderId: id,
  status: deliveryStatus,
  courierName: optionalText(60).optional(),
  expectedVersion: z.number().int().min(0).optional(),
});

export const phoneLookupInput = z.object({ phone: z.string().trim().max(32) });

export const tableInput = z.object({ tableNumber });
export const cancelTableOrderInput = z.object({
  tableNumber,
  expectedVersion: z.number().int().min(0).optional(),
});
export const orderNumberInput = z.object({ orderNumber: z.string().regex(/^\d{4}-\d{5,}$/) });

const tenderLine = z.object({ method: z.enum(TENDER_METHODS), amount: moneyOrZero });
const tenders = z.array(tenderLine).min(1, { message: "To'lov usulini tanlang" }).max(8);

/**
 * Who owes the debt part of a payment: found or created by phone (a new customer needs a name),
 * with an optional due date. Optional when the order already has a customer (takeaway/delivery).
 */
export const debtCustomerInput = z.object({
  phone: requiredPhone,
  name: optionalText(60),
  dueDate: isoDate
    .refine(isRealDate, { message: "Bunday sana yo'q" })
    .refine((s) => s <= localDate(366), { message: "Muddat ko'pi bilan bir yil" })
    .nullish()
    .transform((v) => v ?? null),
});

/**
 * Pays an order: `tenders` (split payment, shared/utils/split-payment.ts), or the legacy single
 * `method` for the whole total. Debt needs `debtCustomer` unless the order has a customer.
 */
export const payOrderInput = z
  .object({
    orderId: id,
    method: paymentMethod.optional(),
    tenders: tenders.optional(),
    debtCustomer: debtCustomerInput.optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .refine((v) => (v.method === undefined) !== (v.tenders === undefined), {
    message: "To'lov usulini tanlang",
    path: ['tenders'],
  });

export const listChecksInput = z.object({
  startDate: isoDate,
  endDate: isoDate,
  method: paymentMethod.optional(),
  status: paymentStatus.optional(),
  tableNumber: tableNumber.optional(),
  orderType: orderType.optional(),
  sortBy: z.enum(['paidAt', 'tableNumber', 'amount']).default('paidAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

/** Admin correction of a paid check: its payments replaced, checked like a new payment. */
export const editCheckInput = z.object({
  orderNumber: z.string().regex(/^\d{4}-\d{5,}$/),
  tenders,
  debtCustomer: debtCustomerInput.optional(),
  /** The order version the admin saw (another device may have changed the check since). */
  expectedVersion: z.number().int().min(0).optional(),
});

// ── Debt (nasiya) ────────────────────────────────────────────────────────────────────────────

export const listDebtorsInput = z
  .object({
    q: z.string().trim().max(60).optional(),
    /** Also customers who owe nothing now (paid off). */
    includeSettled: z.boolean().default(false),
  })
  .default({ includeSettled: false });

/** customerId null: imported legacy debt without a customer. */
export const debtorInput = z.object({ customerId: id.nullable() });

export const repayInput = z.object({
  customerId: id,
  amount: moneyAmount,
  method: z.enum(['cash', 'card', 'click']),
  note: optionalText(200),
});

export const writeOffInput = z.object({
  customerId: id,
  amount: moneyAmount,
  note: trimmed(1, 200, 'Sabab'),
});

export const voidRepaymentInput = z.object({ repaymentId: id, reason: trimmed(1, 200, 'Sabab') });

/** Gives an imported (customer-less) debt to a customer, found or created by phone. */
export const assignDebtInput = z.object({
  paymentId: id,
  phone: requiredPhone,
  name: optionalText(60),
});

export const updateCustomerInput = z.object({
  id,
  phone: requiredPhone.optional(),
  name: optionalText(60).optional(),
  address: optionalText(200).optional(),
  landmark: optionalText(200).optional(),
  note: optionalText(200).optional(),
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
export type SaveOpenOrderInput = z.infer<typeof saveOpenOrderInput>;
/** As the renderer sends it (before schema defaults). */
export type UpdateReceiptSettingsInput = z.input<typeof updateReceiptSettingsInput>;
