import type { KitchenTicketDto, Language, OrderType } from '@shared/types';
import { dec, type Dec, type DecimalString } from '@shared/utils/decimal';
import { escapeHtml } from '@shared/utils/escape-html';
import { formatDate, formatQty, formatTime, localName } from '@shared/utils/format';
import type { Actor, Db, Tx } from '../domain/db';
import { AppError, conflict, notFound } from '../domain/errors';
import { getReceiptSettings } from '../settings/settings';
import type { PrinterService, PrintResult } from './printer';
import { receiptLanguage } from './receipt';

/**
 * Feature F11: kitchen tickets. When an order is saved, cancelled or moved, the dishes that changed
 * go to their printers (MenuItem.printerId) as a short ticket: table, waiter, time and the lines,
 * no prices. The tickets are written in the same transaction as the order change (so a refused
 * save writes none) and printed afterwards, in the background, by the caller: a printer problem
 * never holds up or undoes the order. Each row remembers whether it printed, for the reprint.
 */

export type TicketKind = 'NEW' | 'ADD' | 'CANCEL' | 'MOVE';

export interface KitchenLine {
  nameUz: string;
  nameRu: string | null;
  /** Pieces, or units of a weight dish. */
  qty: DecimalString;
  portion: DecimalString | null;
  /** Per unit, weight dishes only. */
  weightKg: DecimalString | null;
  soldByWeight: boolean;
}

/** What a ticket says, frozen when it is written (kitchen_tickets.payload, JSON). */
export interface KitchenPayload {
  orderNumber: string;
  orderType: OrderType;
  tableNumber: number | null;
  hallName: string | null;
  /** MOVE: the table the guests left. */
  fromTable: number | null;
  customerName: string | null;
  waiter: string;
  at: string;
  printerLabel: string | null;
  /** Added (or, for CANCEL, every line of the cancelled order). */
  lines: KitchenLine[];
  /** Taken off the order on a later save. */
  cancelled: KitchenLine[];
}

/** An order line as the database or the save stores it. */
export interface ItemLike {
  menuItemId: number;
  quantity: { toString(): string };
  portion: { toString(): string } | null;
  weightKg: { toString(): string } | null;
  soldByWeight: boolean;
}

export interface LineChange {
  menuItemId: number;
  portion: DecimalString | null;
  weightKg: DecimalString | null;
  soldByWeight: boolean;
  /** Positive: more of it; negative: less. Never zero. */
  delta: Dec;
}

/** A whole portion is the same dish as no portion (older or imported lines store either). */
const normPortion = (v: { toString(): string } | null): DecimalString | null => {
  const n = v === null ? null : dec(v.toString()).toFixed();
  return n === '1' ? null : n;
};

const norm = (v: { toString(): string } | null): DecimalString | null =>
  v === null ? null : dec(v.toString()).toFixed();

/**
 * What changed between the saved lines and the new ones, per dish + portion + weight: a portion
 * or weight change is the old line taken off and a new one added, which is what the cook needs to
 * know. Order of the result: the new lines' order, then lines that disappeared.
 */
export function diffLines(oldItems: ItemLike[], newItems: ItemLike[]): LineChange[] {
  const keyOf = (i: ItemLike) =>
    `${i.menuItemId}|${normPortion(i.portion) ?? ''}|${norm(i.weightKg) ?? ''}`;
  const changes = new Map<string, LineChange>();
  const add = (i: ItemLike, sign: 1 | -1) => {
    const key = keyOf(i);
    const q = dec(i.quantity.toString()).times(sign);
    const found = changes.get(key);
    if (found) found.delta = found.delta.plus(q);
    else
      changes.set(key, {
        menuItemId: i.menuItemId,
        portion: normPortion(i.portion),
        weightKg: norm(i.weightKg),
        soldByWeight: i.soldByWeight,
        delta: q,
      });
  };
  for (const i of newItems) add(i, 1);
  for (const i of oldItems) add(i, -1);
  return [...changes.values()].filter((c) => !c.delta.isZero());
}

interface WriteArgs {
  orderId: number;
  kind: TicketKind;
  actor: Actor | null;
  /** The lines before the change (empty for a new order). */
  oldItems: ItemLike[];
  /** The lines after it (for CANCEL and MOVE, the order's lines as they are). */
  newItems: ItemLike[];
  fromTable?: number;
}

/**
 * Writes the tickets for one order change inside the caller's transaction; returns their ids for
 * the caller to print once it has committed. Dishes without a printer, or whose printer is hidden,
 * send nothing; a change that touches no printer writes nothing.
 */
export async function writeKitchenTickets(tx: Tx, args: WriteArgs): Promise<number[]> {
  const changes: LineChange[] =
    args.kind === 'CANCEL'
      ? diffLines(args.oldItems, [])
      : args.kind === 'MOVE'
        ? diffLines([], args.newItems)
        : diffLines(args.oldItems, args.newItems);
  if (changes.length === 0) return [];

  const dishes = await tx.menuItem.findMany({
    where: { id: { in: [...new Set(changes.map((c) => c.menuItemId))] } },
    select: {
      id: true,
      nameUz: true,
      nameRu: true,
      printer: { select: { id: true, label: true, isActive: true } },
    },
  });
  const byId = new Map(dishes.map((d) => [d.id, d]));

  type Group = { label: string | null; lines: KitchenLine[]; cancelled: KitchenLine[] };
  const groups = new Map<number, Group>();
  for (const c of changes) {
    const dish = byId.get(c.menuItemId);
    const printer = dish?.printer;
    if (!dish || !printer || !printer.isActive) continue;
    const group = groups.get(printer.id) ?? { label: printer.label, lines: [], cancelled: [] };
    groups.set(printer.id, group);
    const line: KitchenLine = {
      nameUz: dish.nameUz,
      nameRu: dish.nameRu,
      qty: c.delta.abs().toFixed(),
      portion: c.portion,
      weightKg: c.weightKg,
      soldByWeight: c.soldByWeight,
    };
    // A cancelled order lists what the kitchen should stop; a move lists nothing but who moved.
    if (args.kind === 'CANCEL') group.lines.push(line);
    else if (args.kind === 'MOVE') continue;
    else if (c.delta.isPositive()) group.lines.push(line);
    else group.cancelled.push(line);
  }
  if (groups.size === 0) return [];

  const order = await tx.order.findUniqueOrThrow({
    where: { id: args.orderId },
    select: {
      orderNumber: true,
      orderType: true,
      tableNumber: true,
      customerName: true,
    },
  });
  const dineIn = order.orderType === 'DINE_IN' && order.tableNumber > 0;
  const table = dineIn
    ? await tx.diningTable.findUnique({
        where: { number: order.tableNumber },
        select: { hall: { select: { name: true } } },
      })
    : null;
  const at = new Date().toISOString();

  const ids: number[] = [];
  for (const [printerId, group] of groups) {
    const payload: KitchenPayload = {
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableNumber: dineIn ? order.tableNumber : null,
      hallName: table?.hall.name ?? null,
      fromTable: args.fromTable ?? null,
      customerName: order.customerName,
      waiter: args.actor?.fullName ?? '',
      at,
      printerLabel: group.label,
      lines: group.lines,
      cancelled: group.cancelled,
    };
    const row = await tx.kitchenTicket.create({
      data: {
        orderId: args.orderId,
        printerId,
        kind: args.kind,
        payload: JSON.stringify(payload),
        createdById: args.actor?.id ?? null,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

// ── The ticket document ──────────────────────────────────────────────────────────────────────

type LabelKey =
  | TicketKind
  | 'CHANGE'
  | 'cancelled'
  | 'table'
  | 'order'
  | 'waiter'
  | 'TAKEAWAY'
  | 'DELIVERY'
  | 'customer'
  | 'portion07'
  | 'portionHalf'
  | 'sample';

const LABELS: Record<Language, Record<LabelKey, string>> = {
  uz: {
    NEW: 'YANGI BUYURTMA',
    ADD: "QO'SHIMCHA",
    CHANGE: "O'ZGARISH",
    CANCEL: 'BUYURTMA BEKOR QILINDI',
    MOVE: "STOL O'ZGARDI",
    cancelled: 'BEKOR',
    table: 'Stol',
    order: 'Buyurtma',
    waiter: 'Ofitsiant',
    TAKEAWAY: 'Olib ketish',
    DELIVERY: 'Yetkazib berish',
    customer: 'Mijoz',
    portion07: '70%',
    portionHalf: 'yarim',
    sample: 'Sinov',
  },
  ru: {
    NEW: 'НОВЫЙ ЗАКАЗ',
    ADD: 'ДОЗАКАЗ',
    CHANGE: 'ИЗМЕНЕНИЕ',
    CANCEL: 'ЗАКАЗ ОТМЕНЁН',
    MOVE: 'СМЕНА СТОЛА',
    cancelled: 'ОТМЕНА',
    table: 'Стол',
    order: 'Заказ',
    waiter: 'Официант',
    TAKEAWAY: 'С собой',
    DELIVERY: 'Доставка',
    customer: 'Клиент',
    portion07: '70%',
    portionHalf: 'половина',
    sample: 'Тест',
  },
};

function lineText(l: KitchenLine, lang: Language): { qty: string; name: string } {
  const L = LABELS[lang];
  const portion =
    l.portion === '0.7' ? ` (${L.portion07})` : l.portion === '0.5' ? ` (${L.portionHalf})` : '';
  const weight = l.soldByWeight && l.weightKg ? ` ${formatQty(l.weightKg, lang, true)}` : '';
  return { qty: `${formatQty(l.qty, lang)} ×`, name: `${localName(l, lang)}${portion}${weight}` };
}

/**
 * The ticket as a standalone HTML document (same window and paper as the receipt, printer.ts).
 * Every value is escaped; the document's CSP allows no scripts and no images.
 */
export function buildKitchenTicketHtml(
  kind: TicketKind,
  p: KitchenPayload,
  lang: Language,
  sample = false,
): string {
  const L = LABELS[lang];
  const e = escapeHtml;
  const heading = kind === 'ADD' && p.lines.length === 0 ? L.CHANGE : L[kind];
  const where =
    p.tableNumber !== null
      ? `${L.table} ${p.fromTable !== null ? `${p.fromTable} → ` : ''}${p.tableNumber}`
      : p.orderType === 'DINE_IN'
        ? ''
        : L[p.orderType];
  const row = (l: KitchenLine) => {
    const t = lineText(l, lang);
    return `<div class="line"><span class="qty">${e(t.qty)}</span><span>${e(t.name)}</span></div>`;
  };
  const at = new Date(p.at);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>${e(p.orderNumber)}</title>
<style>
  @page { size: 72.1mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { width: 72.1mm; padding: 0 2mm 6mm; font: 15px/1.3 Arial, sans-serif; overflow-wrap: anywhere; }
  .kind { margin: 0 0 4px; font-size: 20px; font-weight: 700; text-align: center; letter-spacing: 1px; }
  .where { margin: 2px 0; font-size: 26px; font-weight: 700; text-align: center; }
  .hall, .printer { text-align: center; font-size: 13px; }
  .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  hr { margin: 6px 0; border: 0; border-top: 1px dashed #000; }
  .line { display: flex; gap: 6px; margin: 5px 0; font-size: 18px; font-weight: 700; }
  .qty { white-space: nowrap; }
  .cancelled { margin: 8px 0 2px; font-size: 18px; font-weight: 700; text-align: center; border: 2px solid #000; }
  .cancelled-lines .line { text-decoration: line-through; }
</style>
</head>
<body>
${sample ? `<div class="printer">${e(L.sample)}</div>` : ''}
<div class="kind">${e(heading)}</div>
<div class="where">${e(where)}</div>
${p.hallName ? `<div class="hall">${e(p.hallName)}</div>` : ''}
${p.customerName && p.tableNumber === null ? `<div class="hall">${e(L.customer)}: ${e(p.customerName)}</div>` : ''}
<hr />
<div class="meta"><span>${e(L.order)} ${e(p.orderNumber)}</span><span>${e(formatDate(at))} ${e(formatTime(at))}</span></div>
${p.waiter ? `<div class="meta"><span>${e(L.waiter)}: ${e(p.waiter)}</span></div>` : ''}
${p.printerLabel ? `<div class="printer">${e(p.printerLabel)}</div>` : ''}
${p.lines.length ? `<hr />${p.lines.map(row).join('')}` : ''}
${p.cancelled.length ? `<div class="cancelled">${e(L.cancelled)}</div><div class="cancelled-lines">${p.cancelled.map(row).join('')}</div>` : ''}
</body>
</html>`;
}

// ── Printing ─────────────────────────────────────────────────────────────────────────────────

const printerOf = { printer: { select: { label: true, windowsName: true, isMain: true } } };

async function languageOf(db: Db): Promise<Language> {
  const settings = await getReceiptSettings(db);
  return settings ? receiptLanguage(settings) : 'uz';
}

/**
 * Sends one document to a printer row. The main printer may pick automatically (as receipts do);
 * a kitchen printer must be the one named, or the ticket fails loudly instead of coming out of
 * the cashier's printer.
 */
function printTo(
  printer: PrinterService,
  target: { windowsName: string | null; isMain: boolean },
  html: string,
): Promise<PrintResult> {
  if (!target.isMain && !target.windowsName) {
    throw new AppError('CONFLICT', 'Printer tanlanmagan', { reason: 'NO_PRINTER' });
  }
  return printer.print(html, { preferredName: target.windowsName, exact: !target.isMain });
}

function errorText(error: unknown): string {
  // A print that timed out may still come out of the spooler: say so before anyone reprints.
  if (
    error instanceof AppError &&
    (error.details as { reason?: string } | undefined)?.reason === 'TIMEOUT'
  )
    return `${error.message} (chiqqan bo'lishi mumkin, printerni tekshiring)`;
  return error instanceof AppError ? error.message : "Chop etib bo'lmadi";
}

/**
 * Prints the given tickets one after the other, recording each outcome. Never throws: this runs
 * after the order is saved, in the background. Returns the ids that failed.
 */
export async function printKitchenTickets(
  db: Db,
  printer: PrinterService,
  ids: number[],
  log: (message: string, error?: unknown) => void,
): Promise<number[]> {
  const failed: number[] = [];
  if (ids.length === 0) return failed;
  let lang: Language = 'uz';
  try {
    lang = await languageOf(db);
  } catch {
    // Uzbek, as the receipt does without settings.
  }
  for (const id of ids) {
    try {
      await printOne(db, printer, id, lang);
    } catch (error) {
      failed.push(id);
      log(`[kitchen] ticket ${id} failed`, error);
    }
  }
  return failed;
}

async function printOne(
  db: Db,
  printer: PrinterService,
  id: number,
  lang: Language,
): Promise<PrintResult> {
  const ticket = await db.kitchenTicket.findUnique({ where: { id }, include: printerOf });
  if (!ticket) throw notFound('Oshxona cheki');
  const payload = JSON.parse(ticket.payload) as KitchenPayload;
  let result: PrintResult;
  try {
    result = await printTo(
      printer,
      ticket.printer,
      buildKitchenTicketHtml(ticket.kind, payload, lang),
    );
  } catch (error) {
    await db.kitchenTicket
      .update({ where: { id }, data: { error: errorText(error) } })
      .catch(() => undefined);
    throw error;
  }
  // The paper is out: failing to record it must not offer the ticket for a reprint.
  await db.kitchenTicket
    .update({ where: { id }, data: { printedAt: new Date(), error: null } })
    .catch(() => undefined);
  return result;
}

/** How far back the reprint prompt looks: today's service, not last week's. */
const FAILED_WINDOW_MS = 12 * 60 * 60 * 1000;
/** A ticket never tried this long after it was written (app closed, error after the save). */
const NEVER_TRIED_MS = 2 * 60 * 1000;

/**
 * Prints one ticket again (the waiter's "Qayta"); throws when it fails, like a receipt. Only a
 * ticket that has not printed, from today's service, to a printer that is still shown: a second
 * press, or an old ticket, must not send the kitchen the same dishes twice.
 */
export async function reprintKitchenTicket(
  db: Db,
  printer: PrinterService,
  ticketId: number,
): Promise<PrintResult> {
  const ticket = await db.kitchenTicket.findUnique({
    where: { id: ticketId },
    include: { printer: { select: { isActive: true } } },
  });
  if (!ticket) throw notFound('Oshxona cheki');
  if (ticket.printedAt) throw conflict('Bu chek allaqachon chiqqan', { reason: 'ALREADY_PRINTED' });
  if (!ticket.printer.isActive) throw conflict('Printer yashirilgan', { reason: 'PRINTER_HIDDEN' });
  if (ticket.createdAt.getTime() < Date.now() - FAILED_WINDOW_MS)
    throw conflict('Chek eskirgan', { reason: 'TOO_OLD' });
  return printOne(db, printer, ticketId, await languageOf(db));
}

/** Tickets that did not print (failed, or never tried) in the last 12 hours, newest first. */
export async function listFailedTickets(db: Db): Promise<KitchenTicketDto[]> {
  const now = Date.now();
  const rows = await db.kitchenTicket.findMany({
    where: {
      printedAt: null,
      printer: { isActive: true },
      createdAt: { gte: new Date(now - FAILED_WINDOW_MS) },
      OR: [{ error: { not: null } }, { createdAt: { lt: new Date(now - NEVER_TRIED_MS) } }],
    },
    include: {
      ...printerOf,
      order: { select: { orderNumber: true, orderType: true, tableNumber: true } },
    },
    orderBy: { id: 'desc' },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order.orderNumber,
    tableNumber:
      r.order.orderType === 'DINE_IN' && r.order.tableNumber > 0 ? r.order.tableNumber : null,
    kind: r.kind,
    printerId: r.printerId,
    printerLabel: r.printer.label,
    printerWindowsName: r.printer.windowsName,
    createdAt: r.createdAt.toISOString(),
    error: r.error,
  }));
}

/** A sample ticket to one printer (settings page). */
export async function printTestTicket(
  db: Db,
  printer: PrinterService,
  printerId: number,
): Promise<PrintResult> {
  const target = await db.printer.findUnique({ where: { id: printerId } });
  if (!target) throw notFound('Printer');
  const lang = await languageOf(db);
  const sample: KitchenPayload = {
    orderNumber: `${new Date().getFullYear()}-00000`,
    orderType: 'DINE_IN',
    tableNumber: 5,
    hallName: null,
    fromTable: null,
    customerName: null,
    waiter: '',
    at: new Date().toISOString(),
    printerLabel: target.label,
    lines: [
      {
        nameUz: 'Osh',
        nameRu: 'Плов',
        qty: '2',
        portion: null,
        weightKg: null,
        soldByWeight: false,
      },
      {
        nameUz: "Lag'mon",
        nameRu: 'Лагман',
        qty: '1',
        portion: '0.5',
        weightKg: null,
        soldByWeight: false,
      },
    ],
    cancelled: [],
  };
  return printTo(printer, target, buildKitchenTicketHtml('NEW', sample, lang, true));
}
