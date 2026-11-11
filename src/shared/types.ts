import type { ServiceFeeType } from './utils/service-fee';
import type { DecimalString } from './utils/decimal';
import type { FiscalVatMode } from './utils/fiscal-receipt';

/**
 * Data shapes that cross IPC. Plain JSON: money and quantities are DecimalString, dates are ISO
 * strings, ids are numbers. Prisma types never leave the main process.
 */

import type { Permission, Role } from './permissions';
export type { Permission, Role } from './permissions';
export type OrderStatus = 'pending' | 'completed' | 'cancelled';
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type DeliveryStatus = 'PREPARING' | 'ON_THE_WAY' | 'DELIVERED';
export type PaymentMethod = 'cash' | 'card' | 'click' | 'debt';
export type PaymentStatus = 'paid' | 'pending' | 'refunded';
/** An order's method: one of the payment methods, or `mixed` when it was split. */
export type OrderPaymentMethod = PaymentMethod | 'mixed';
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
  fullName: string;
  /** 998XXXXXXXXX; null only for users from before phones (an admin fills it in). */
  phone: string | null;
  role: Role;
  permissions: Permission[];
}

/** An administrator, for the one-time "set the administrator PIN" step (names only). */
export interface AdminChoiceDto {
  id: number;
  fullName: string;
}

/** A login that also hands over a new recovery code (shown once, never stored in clear). */
export interface LoginWithCodeDto {
  user: CurrentUser;
  recoveryCode: string;
}

export interface UserDto extends CurrentUser {
  isActive: boolean;
  /** Has a PIN for the lock screen / PIN login (the PIN itself never leaves main). */
  hasPin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** Feature F17: share of their sales, percent ("0".."100"). */
  earningsPercent: DecimalString;
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
  /** Payment options (F1-C). */
  splitPaymentEnabled: boolean;
  debtEnabled: boolean;
  lanEnabled: boolean;
  /** Feature F10: pictures on the order screen, for categories and for dishes. */
  showCategoryImages: boolean;
  showMenuImages: boolean;
  /** Feature F17: service fee on table orders: off, percent of the dishes, or so'm per guest. */
  serviceFeeType: ServiceFeeType;
  serviceFeePercent: DecimalString;
  serviceFeePerGuest: DecimalString;
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

/** One order type's receipt layout (feature F3); `saved` false = inherited, not stored yet. */
/** Software update (main/updater/updater.ts). */
export type UpdateState =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatusDto {
  state: UpdateState;
  currentVersion: string;
  /** The newer version, once one is known. */
  version: string | null;
  releaseDate: string | null;
  /** Download progress, 0-100 while downloading. */
  percent: number | null;
  /** Uzbek, when state is error. */
  message: string | null;
  /** ISO time of the last answer from the server. */
  checkedAt: string | null;
}

export interface ReceiptLayoutDto {
  orderType: OrderType;
  showAddress: boolean;
  showPhone: boolean;
  showDateTime: boolean;
  showOrderNumber: boolean;
  showCustomer: boolean;
  footerNote: string;
  /** File name in the image store, shown through `savdochef-img:`. */
  topImage: string | null;
  topImageWidth: number;
  bottomImage: string | null;
  bottomImageWidth: number;
  saved: boolean;
}

/**
 * The pre-bill's layout (feature F9), one for every order type. `saved` false: never saved, it
 * prints with General's switches and footer and no pictures.
 */
export type PreBillLayoutDto = Omit<ReceiptLayoutDto, 'orderType' | 'showCustomer'>;

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

/** Feature F11: a printer the till prints to: the main one, or a kitchen/bar printer. */
export interface PrinterDto {
  id: number;
  label: string | null;
  /** Windows printer name; null = pick automatically (main printer only). */
  windowsName: string | null;
  isMain: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Active dishes that send their kitchen ticket here. */
  menuItemCount: number;
}

// ── LAN: satellite tills (feature F12) ────────────────────────────────────────────────────────

export interface LanDeviceDto {
  id: number;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  revoked: boolean;
}

/** The main till's view of its satellites (Settings -> Satellitlar). */
export interface LanStatusDto {
  /** Accept satellites (lan_enabled). */
  enabled: boolean;
  port: number;
  /** Listening right now (enabled and a satellite or an open code; lan/serve-policy.ts). */
  serving: boolean;
  /** Why it is not listening although it should (port taken...), Uzbek. */
  error: string | null;
  /** This computer's IPv4 addresses on the shop's network, for the satellite's form. */
  addresses: string[];
  pairing: { code: string; expiresAt: string } | null;
  devices: LanDeviceDto[];
  /** Satellites the plan allows (terminals - 1); null = no limit. */
  deviceLimit: number | null;
}

/**
 * How a satellite's line to its main till stands. `online`: working; `connecting`: first contact;
 * `unreachable`: no answer (off, unplugged, wrong address); `unpaired`: the main till no longer
 * knows this satellite; `superseded`: another till answers at the address; `version`: the two
 * tills run versions that cannot talk.
 */
export type LanLinkState =
  | 'connecting'
  | 'online'
  | 'unreachable'
  | 'unpaired'
  | 'superseded'
  | 'version';

/** This till's role; for a satellite, its main till and the line's state. */
export interface LanLinkDto {
  role: 'main' | 'satellite';
  mainUrl: string | null;
  state: LanLinkState | null;
  mainVersion: string | null;
  lastContactAt: string | null;
}

/** A kitchen ticket that did not print (feature F11), for the reprint prompt. */
export interface KitchenTicketDto {
  id: number;
  orderId: number;
  orderNumber: string;
  tableNumber: number | null;
  kind: 'NEW' | 'ADD' | 'CANCEL' | 'MOVE';
  printerId: number;
  printerLabel: string | null;
  printerWindowsName: string | null;
  createdAt: string;
  error: string | null;
}

// ── Debt (nasiya) ────────────────────────────────────────────────────────────────────────────

export interface DebtorDto {
  /** null: imported legacy debt that has no customer yet. */
  customerId: number | null;
  name: string | null;
  phone: string | null;
  /** Owed now: debt rows minus repayments and write-offs (computed, never stored). */
  balance: DecimalString;
  /** Unpaid debt checks, and the oldest and the next due date among them. */
  openChecks: number;
  oldestDebtAt: string | null;
  nextDueDate: string | null;
  overdue: boolean;
}

export interface DebtChargeDto {
  paymentId: number;
  orderId: number;
  orderNumber: string;
  amount: DecimalString;
  paidAt: string;
  dueDate: string | null;
  /** When repayments covered it (oldest first); null while (partly) unpaid. */
  settledAt: string | null;
}

export interface DebtRepaymentDto {
  id: number;
  kind: 'PAYMENT' | 'WRITE_OFF';
  method: 'cash' | 'card' | 'click' | null;
  amount: DecimalString;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface DebtorDetailDto {
  customer: {
    id: number;
    phone: string;
    name: string | null;
    address: string | null;
    landmark: string | null;
    note: string | null;
  } | null;
  balance: DecimalString;
  charges: DebtChargeDto[];
  repayments: DebtRepaymentDto[];
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
  /** Feature F10: picture file name in the image store, or null. */
  imageFile: string | null;
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
  /** Feature F11: the kitchen/bar printer for this dish's tickets; null = none. */
  printerId: number | null;
  /** Feature F18: MXIK (17 digits) and package code; null = the defaults from fiscal settings. */
  mxik: string | null;
  packageCode: string | null;
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
  /** 0 for an unlimited dish: use `unlimited`. */
  remainingQuantity: DecimalString;
  /** Not counted in this shift (feature F6): no limit, no leftover. */
  unlimited: boolean;
}

export interface SessionDto {
  id: number;
  status: SessionStatus;
  openedAt: string;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
  items: SessionItemDto[];
  /**
   * The drawer (feature F6). Null counted/expected: still open, or closed before F6. All three are
   * null for a user without the shifts permission.
   */
  openingCash: DecimalString | null;
  countedCash: DecimalString | null;
  expectedCash: DecimalString | null;
}

export type CashMovementType = 'PAY_IN' | 'PAY_OUT';

export interface CashMovementDto {
  id: number;
  type: CashMovementType;
  amount: DecimalString;
  note: string;
  createdAt: string;
  createdBy: string | null;
}

/**
 * A shift's drawer (feature F6, like posgro). expected = opening + cash sales + cash debt
 * repayments + cash in - cash out; for a closed shift `expectedCash` is the figure frozen at close.
 */
export interface ShiftCashSummaryDto {
  sessionId: number;
  status: SessionStatus;
  openedAt: string;
  closedAt: string | null;
  openingCash: DecimalString;
  /** Paid checks of this shift, by method (debt = sold on credit). */
  sales: { cash: DecimalString; card: DecimalString; click: DecimalString; debt: DecimalString };
  salesTotal: DecimalString;
  /** Feature F17: service fees inside salesTotal. */
  serviceFees: DecimalString;
  checksCount: number;
  /** Debt repaid in cash while the shift was open (not voided). */
  debtRepaymentsCash: DecimalString;
  payIn: DecimalString;
  payOut: DecimalString;
  expectedCash: DecimalString;
  countedCash: DecimalString | null;
  /** counted - expected: negative = shortage, positive = overage. */
  difference: DecimalString | null;
  /**
   * A closed shift whose checks or cash repayments were corrected after the close: what the
   * breakdown (from today's data) is short of the frozen expected (frozen - live), so the lines
   * still add up to it; null when nothing changed.
   */
  correctionAfterClose: DecimalString | null;
  movements: CashMovementDto[];
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
  /** Feature F18: why sending receipts or closing the VCR Z-report failed (the shift is closed). */
  fiscalWarning?: string | null;
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
  /** paid; a debt row is pending until repayments cover it. */
  status: PaymentStatus;
  paidAt: string;
  /** Debt rows: who owes it (null = imported legacy debt), when it is due, when it was covered. */
  customerId: number | null;
  customerName: string | null;
  dueDate: string | null;
  settledAt: string | null;
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
  paymentMethod: OrderPaymentMethod | null;
  /** Send back as expectedVersion when saving, to detect edits from another device. */
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdBy: string | null;
  /** Who opened it (F13: only they, or a user with `ordersOthers`, may change it). */
  createdById: number | null;
  /** Takeaway/delivery: the customer as saved with the order (phone 998XXXXXXXXX). */
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryNote: string | null;
  /** Included in totalAmount; '0' unless delivery. */
  deliveryFee: DecimalString;
  /** Feature F17: included in totalAmount; '0' when off and on takeaway/delivery. */
  serviceFee: DecimalString;
  /** Guests at the table; null when nobody entered it. */
  guestCount: number | null;
  deliveryStatus: DeliveryStatus | null;
  courierName: string | null;
  lines: OrderLineDto[];
  payments: PaymentDto[];
  /** Feature F18: its fiscal receipt; null when fiscal receipts were off when it was paid. */
  fiscal: OrderFiscalDto | null;
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
  createdById: number | null;
  createdBy: string | null;
  /** For a change straight from the grid (moving to another table). */
  version: number;
  orderNumber: string;
  totalAmount: DecimalString;
  lineCount: number;
  updatedAt: string;
}

/**
 * Feature F13: a table whose order page is open on some till (a lease on the main till). Other
 * tills cannot open that table until it is released or runs out.
 */
export interface TableLockDto {
  tableNumber: number;
  userName: string;
  /** Held by the asking till (window or satellite). */
  mine: boolean;
}

/** What orders:lockTable answers: `held` false = the page opens read-only (someone else's order). */
export interface TableLockResultDto {
  held: boolean;
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
/** One paid order in the checks list (its payments summed; split checks list every method). */
export interface CheckDto {
  orderId: number;
  orderNumber: string;
  orderType: OrderType;
  tableNumber: number | null;
  customerName: string | null;
  methods: PaymentMethod[];
  /** The debt part, and how much of it is still unpaid. */
  debtAmount: DecimalString;
  debtOpen: DecimalString;
  /** Sum of the order's payments (= its total). */
  amount: DecimalString;
  /** pending while any of its debt is unpaid. */
  status: PaymentStatus;
  /** When it was paid (its first payment). */
  paidAt: string;
  /** Feature F18: null = fiscal receipts were off when it was paid. */
  fiscalStatus: FiscalStatus | null;
  fiscalError: string | null;
}

// ── Fiscal receipts (feature F18, REGOS:VCR) ─────────────────────────────────────────────────

/**
 * PENDING: waiting to be sent (or VCR was unreachable); FISCALIZED: VCR registered it; FAILED:
 * VCR refused its data (MXIK, VAT); DEFERRED_DEBT: waits until its debt is repaid; REFUNDED: VCR
 * registered its refund (the check is then cancelled).
 */
export type FiscalStatus = 'PENDING' | 'FISCALIZED' | 'FAILED' | 'DEFERRED_DEBT' | 'REFUNDED';

export interface OrderFiscalDto {
  status: FiscalStatus;
  error: string | null;
  /** As VCR answered; since VCR 2026-10-30 these may be "***" (only the paper receipt has them). */
  receiptNo: string | null;
  fiscalSign: string | null;
  qrUrl: string | null;
  terminalId: string | null;
  fiscalAt: string | null;
  refundedAt: string | null;
}

export interface FiscalConfigDto {
  enabled: boolean;
  host: string;
  port: number;
  login: string;
  /** The password itself never leaves main. */
  hasPassword: boolean;
  vatMode: FiscalVatMode;
  defaultMxik: string;
  defaultPackage: string;
  serviceMxik: string;
  servicePackage: string;
  deliveryMxik: string;
  deliveryPackage: string;
  /** A development run talks to the URL in SAVDOCHEF_VCR_URL instead of host and port. */
  urlOverride: boolean;
}

export interface FiscalConnectionDto {
  terminalId: string;
  appletVersion: string;
  freeZReports: number;
  freeUnsentReceipts: number;
}

export interface FiscalStatusDto {
  enabled: boolean;
  /** Paid checks waiting to be sent, and those VCR refused. */
  pending: number;
  failed: number;
}

export interface FiscalZReportDto {
  open: boolean;
  terminalId: string;
  number: number;
  openTime: string;
  closeTime: string;
  saleCount: number;
  saleCash: DecimalString;
  saleCard: DecimalString;
  refundCount: number;
  refundCash: DecimalString;
  refundCard: DecimalString;
}

export interface FiscalRetryAllDto {
  sent: number;
  failed: number;
  pending: number;
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
  /** Feature F17: service fees inside `dineIn`, each order counted once. */
  serviceFees: DecimalString;
  /** Debt repaid that day (money received for older checks), by method; and forgiven debt. */
  repayments: DecimalString;
  repaymentCash: DecimalString;
  repaymentCard: DecimalString;
  repaymentClick: DecimalString;
  writtenOff: DecimalString;
  /** Money actually received that day: cash + card + click + repayments (debt excluded). */
  received: DecimalString;
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

/**
 * Feature F17, Xodimlar bo'yicha hisobot: one row per user who opened paid orders in the range.
 * `sales` is the dishes total (no service or delivery fee), the base of the earnings.
 */
export interface StaffReportRow {
  userId: number | null;
  /** null: orders without an opener (imported from the legacy app). */
  fullName: string | null;
  orders: number;
  guests: number;
  sales: DecimalString;
  serviceFees: DecimalString;
  /** The user's percent now (the earnings use each order's percent at payment). */
  currentPercent: DecimalString | null;
  earnings: DecimalString;
}

export interface StaffReport {
  rows: StaffReportRow[];
  totals: Omit<StaffReportRow, 'userId' | 'fullName' | 'currentPercent'>;
}
