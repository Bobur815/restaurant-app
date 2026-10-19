import type { DecimalString } from './utils/decimal';

/**
 * Data shapes that cross IPC. Plain JSON: money and quantities are DecimalString, dates are ISO
 * strings, ids are numbers. Prisma types never leave the main process.
 */

export type Role = 'ADMIN' | 'STAFF';
export type OrderStatus = 'pending' | 'completed' | 'cancelled';
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type DeliveryStatus = 'PREPARING' | 'ON_THE_WAY' | 'DELIVERED';
export type PaymentMethod = 'cash' | 'card' | 'click' | 'debt';
export type PaymentStatus = 'paid' | 'pending' | 'refunded';
export type SessionStatus = 'open' | 'closed';
export type ResidualAction = 'CARRY_TO_NEXT' | 'WRITE_OFF';
export type ResidualStatus = 'pending' | 'applied';
export type ExpenseType = 'residual_writeoff' | 'waste' | 'breakage';
export type Language = 'uz' | 'ru';
export type Theme = 'system' | 'light' | 'dark';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'click', 'debt'];
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['paid', 'pending', 'refunded'];

// ── Auth & users ─────────────────────────────────────────────────────────────────────────────

/** The logged-in user as the UI sees it (also the server-side "actor"). */
export interface CurrentUser {
  id: number;
  username: string;
  fullName: string | null;
  role: Role;
}

/** A user who can unlock with a PIN: what the lock screen lists (never any secret). */
export interface PinUserDto {
  id: number;
  username: string;
  fullName: string | null;
}

export interface UserDto extends CurrentUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ── Setup & settings ─────────────────────────────────────────────────────────────────────────

export interface SetupStatus {
  setupComplete: boolean;
  hasAdmin: boolean;
}

export interface AppSettings {
  tableCount: number;
  language: Language;
  theme: Theme;
  clickSound: boolean;
  /** Print the customer receipt automatically after a payment. */
  printAfterPayment: boolean;
  /** Order types offered on the tables screen (F1-B); dine-in is always on. */
  takeawayEnabled: boolean;
  deliveryEnabled: boolean;
  /** Pre-filled delivery fee, editable per order. */
  deliveryFeeDefault: DecimalString;
  lanEnabled: boolean;
  setupComplete: boolean;
}

export interface ReceiptSettingsDto {
  restaurantName: string;
  address: string;
  phone: string;
  extraPhones: string;
  footerNote: string;
  locale: string;
  currency: string;
  logoPath: string | null;
  printerName: string | null;
  printWidthPx: number;
  printUseStarsSep: boolean;
  printSeparatorChar: string;
  printSeparatorCount: number;
  printShowAddress: boolean;
  printShowPhone: boolean;
  printShowDateTime: boolean;
  printShowOrderNumber: boolean;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

// ── Halls & tables ───────────────────────────────────────────────────────────────────────────

export interface DiningTableDto {
  id: number;
  /** Unique across the restaurant; what orders store as tableNumber. */
  number: number;
  hallId: number;
  label: string | null;
  seats: number | null;
  isActive: boolean;
}

export interface HallDto {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Sorted by number. Inactive tables only when listed with includeInactive. */
  tables: DiningTableDto[];
}

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────

export interface CategoryDto {
  id: number;
  nameUz: string;
  nameRu: string | null;
  sortOrder: number;
  isActive: boolean;
  menuItemCount: number;
}

export interface MenuItemDto {
  id: number;
  nameUz: string;
  nameRu: string | null;
  description: string | null;
  price: DecimalString;
  /** Unit cost for write-offs; null = not set (write-offs use the sale price). */
  costPrice: DecimalString | null;
  imageFile: string | null;
  categoryId: number;
  categoryNameUz: string;
  hasPortions: boolean;
  soldByWeight: boolean;
  isActive: boolean;
}

/** Result of a delete request: removed, or hidden because history refers to it. */
export type DeleteOutcome = 'deleted' | 'deactivated';

// ── Sessions (shifts) ────────────────────────────────────────────────────────────────────────

export interface SessionItemDto {
  menuItemId: number;
  nameUz: string;
  nameRu: string | null;
  soldByWeight: boolean;
  imageFile: string | null;
  initialQuantity: DecimalString;
  soldQuantity: DecimalString;
  remainingQuantity: DecimalString;
}

export interface SessionDto {
  id: number;
  status: SessionStatus;
  openedAt: string;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
  items: SessionItemDto[];
}

export interface PendingCarryDto {
  residualId: number;
  sessionId: number;
  menuItemId: number;
  nameUz: string;
  quantity: DecimalString;
  note: string;
}

export interface SessionCloseResult {
  sessionId: number;
  closedAt: string;
  carried: Array<{ menuItemId: number; quantity: DecimalString }>;
  writtenOff: Array<{ menuItemId: number; quantity: DecimalString; amount: DecimalString }>;
}

// ── Orders & payments ────────────────────────────────────────────────────────────────────────

export interface OrderLineDto {
  id: number;
  menuItemId: number;
  nameUz: string;
  nameRu: string | null;
  imageFile: string | null;
  soldByWeight: boolean;
  hasPortions: boolean;
  quantity: DecimalString;
  portion: DecimalString | null;
  weightKg: DecimalString | null;
  unitPrice: DecimalString;
  totalPrice: DecimalString;
  stockQuantity: DecimalString;
}

export interface PaymentDto {
  id: number;
  orderId: number;
  amount: DecimalString;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
}

export interface OrderDto {
  id: number;
  orderNumber: string;
  orderType: OrderType;
  /** Dine-in only; null for takeaway and delivery (and legacy orders without a table). */
  tableNumber: number | null;
  status: OrderStatus;
  sessionId: number;
  totalAmount: DecimalString;
  paymentMethod: PaymentMethod | null;
  /** Send back as expectedVersion when saving, to detect edits from another device. */
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdBy: string | null;
  /** Takeaway/delivery: the customer as saved with the order (phone 998XXXXXXXXX). */
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryNote: string | null;
  /** Included in totalAmount; '0' unless delivery. */
  deliveryFee: DecimalString;
  deliveryStatus: DeliveryStatus | null;
  courierName: string | null;
  lines: OrderLineDto[];
  payments: PaymentDto[];
}

/** An unpaid takeaway or delivery order, for the strip on the tables screen. */
export interface OpenOrderSummaryDto {
  orderId: number;
  orderNumber: string;
  orderType: Exclude<OrderType, 'DINE_IN'>;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryStatus: DeliveryStatus | null;
  totalAmount: DecimalString;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the order form may learn from a phone number (any logged-in user can ask): only what
 * autofill needs. Ids, notes and (F1-C) debt stay out of it.
 */
export interface CustomerLookupDto {
  name: string | null;
  address: string | null;
  landmark: string | null;
}

export interface TableSummaryDto {
  tableNumber: number;
  orderId: number;
  orderNumber: string;
  totalAmount: DecimalString;
  lineCount: number;
  updatedAt: string;
}

/** Stock shortfall reported in CONFLICT details when an order asks for more than remains. */
export interface StockShortage {
  menuItemId: number;
  nameUz: string;
  requested: DecimalString;
  remaining: DecimalString;
  reason: 'NOT_IN_SESSION' | 'INSUFFICIENT';
}

/** One row of the checks (cheklar) list. */
export interface CheckDto {
  paymentId: number;
  orderId: number;
  orderNumber: string;
  orderType: OrderType;
  tableNumber: number | null;
  customerName: string | null;
  amount: DecimalString;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
}

// ── Residuals, expenses, reports ─────────────────────────────────────────────────────────────

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface ResidualDto {
  id: number;
  sessionId: number;
  menuItemId: number;
  menuNameUz: string;
  quantity: DecimalString;
  action: ResidualAction;
  status: ResidualStatus;
  appliedToSessionId: number | null;
  expenseId: number | null;
  note: string;
  createdAt: string;
}

export interface ResidualList extends Paged<ResidualDto> {
  totals: Partial<Record<ResidualAction, { count: number; quantity: DecimalString }>>;
}

export interface ExpenseDto {
  id: number;
  sessionId: number | null;
  menuItemId: number | null;
  menuNameUz: string | null;
  type: ExpenseType;
  note: string;
  quantity: DecimalString;
  unitCost: DecimalString;
  amount: DecimalString;
  createdAt: string;
}

export interface ExpenseList extends Paged<ExpenseDto> {
  totals: {
    totalAmount: DecimalString;
    byType: Partial<
      Record<ExpenseType, { count: number; amount: DecimalString; quantity: DecimalString }>
    >;
  };
}

export interface DailyReportRow {
  /** YYYY-MM-DD, local time of the till. */
  date: string;
  numberOfOrders: number;
  total: DecimalString;
  cash: DecimalString;
  card: DecimalString;
  click: DecimalString;
  debt: DecimalString;
  /** card + click (legacy "plastik"). */
  plastic: DecimalString;
  /** Payments by order type (F1-B); they add up to total. */
  dineIn: DecimalString;
  takeaway: DecimalString;
  delivery: DecimalString;
  /** Delivery fees inside `delivery`, each order counted once. */
  deliveryFees: DecimalString;
  expenseTotal: DecimalString;
  residualWriteOff: DecimalString;
  waste: DecimalString;
  breakage: DecimalString;
  expenseQuantity: DecimalString;
}

export interface ProductSalesRow {
  menuItemId: number;
  nameUz: string;
  /** Units ordered, as legacy reported it (a half portion counts as 1). */
  quantity: DecimalString;
  /** Stock actually used (portions and kg applied). */
  stockQuantity: DecimalString;
  revenue: DecimalString;
}

export interface SalesReport {
  daily: DailyReportRow[];
  productsByDate: Array<{ date: string; products: ProductSalesRow[] }>;
}
