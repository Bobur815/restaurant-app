import type { Language, ReceiptSettingsDto, SessionDto, ShiftCashSummaryDto } from '@shared/types';
import { dec } from '@shared/utils/decimal';
import { escapeHtml } from '@shared/utils/escape-html';
import { formatDate, formatMoney, formatQty, formatTime, localName } from '@shared/utils/format';
import type { Db } from '../domain/db';
import { conflict } from '../domain/errors';
import { getReceiptSettings } from '../settings/settings';
import { getCashSummary } from '../sessions/cash';
import { getSession } from '../sessions/sessions';
import type { PrinterService, PrintResult } from './printer';
import { receiptLanguage } from './receipt';

/**
 * The shift report (feature F6, posgro's X/Z report) as a standalone HTML document for the receipt
 * printer, built in main from the database like the receipt (every value escaped, own CSP, no
 * scripts or remote loads). X = the open shift so far; Z = a closed shift with its cash count.
 */

const UZ = {
  X: 'X-HISOBOT',
  Z: 'Z-HISOBOT',
  shift: 'Smena',
  opened: 'Ochildi',
  closed: 'Yopildi',
  printed: 'Chop etildi',
  checks: 'Cheklar soni',
  sales: 'Savdo',
  cash: 'Naqd',
  card: 'Karta',
  click: 'Click',
  debt: 'Nasiya',
  total: 'Jami savdo',
  drawer: 'Kassa',
  opening: "Boshlang'ich naqd",
  cashSales: 'Naqd savdo',
  repayments: "Qarz to'lovlari (naqd)",
  payIn: 'Kirim',
  payOut: 'Chiqim',
  expected: 'Kutilayotgan naqd',
  counted: 'Haqiqiy naqd',
  shortage: 'Kamomad',
  overage: 'Ortiqcha',
  exact: 'Farq',
  correction: 'Yopilgandan keyingi tuzatish',
  movements: 'Kassa harakati',
  dishes: 'Sotilgan taomlar',
  unlimited: 'cheksiz',
};

const LABELS: Record<Language, Record<keyof typeof UZ, string>> = {
  uz: UZ,
  ru: {
    X: 'X-ОТЧЁТ',
    Z: 'Z-ОТЧЁТ',
    shift: 'Смена',
    opened: 'Открыта',
    closed: 'Закрыта',
    printed: 'Напечатано',
    checks: 'Чеков',
    sales: 'Продажи',
    cash: 'Наличные',
    card: 'Карта',
    click: 'Click',
    debt: 'В долг',
    total: 'Итого продаж',
    drawer: 'Касса',
    opening: 'Начальная сумма',
    cashSales: 'Продажи наличными',
    repayments: 'Погашение долгов (наличные)',
    payIn: 'Внесение',
    payOut: 'Изъятие',
    expected: 'Ожидается в кассе',
    counted: 'Фактически',
    shortage: 'Недостача',
    overage: 'Излишек',
    exact: 'Разница',
    correction: 'Исправления после закрытия',
    movements: 'Движение по кассе',
    dishes: 'Проданные блюда',
    unlimited: 'без лимита',
  },
};

const e = (value: string | number | null | undefined) => escapeHtml(String(value ?? ''));

export function buildShiftReportHtml(
  kind: 'X' | 'Z',
  session: SessionDto,
  cash: ShiftCashSummaryDto,
  settings: ReceiptSettingsDto,
  printedAt: Date = new Date(),
): string {
  const lang = receiptLanguage(settings);
  const L = LABELS[lang];
  const money = (v: string) => e(formatMoney(v, lang));
  const row = (label: string, value: string, cls = '') =>
    `<div class="row ${cls}"><span>${e(label)}</span><span class="amount">${value}</span></div>`;
  const when = (iso: string) => `${formatDate(new Date(iso))} ${formatTime(new Date(iso))}`;

  const meta = [
    row(`${L.shift} №`, e(session.id)),
    row(L.opened, `${e(when(session.openedAt))}`),
    session.openedBy ? `<div class="muted right">${e(session.openedBy)}</div>` : '',
    session.closedAt ? row(L.closed, e(when(session.closedAt))) : '',
    session.closedAt && session.closedBy
      ? `<div class="muted right">${e(session.closedBy)}</div>`
      : '',
    row(L.printed, e(`${formatDate(printedAt)} ${formatTime(printedAt)}`)),
  ].join('');

  const sales = [
    row(L.checks, e(cash.checksCount)),
    row(L.cash, money(cash.sales.cash)),
    row(L.card, money(cash.sales.card)),
    row(L.click, money(cash.sales.click)),
    row(L.debt, money(cash.sales.debt)),
    row(L.total, money(cash.salesTotal), 'strong'),
  ].join('');

  const diff = cash.difference === null ? null : dec(cash.difference);
  const drawer = [
    row(L.opening, money(cash.openingCash)),
    row(L.cashSales, money(cash.sales.cash)),
    row(L.repayments, money(cash.debtRepaymentsCash)),
    row(L.payIn, money(cash.payIn)),
    row(L.payOut, `−${money(cash.payOut)}`),
    cash.correctionAfterClose !== null
      ? row(
          L.correction,
          `${dec(cash.correctionAfterClose).gt(0) ? '+' : ''}${money(cash.correctionAfterClose)}`,
        )
      : '',
    row(L.expected, money(cash.expectedCash), 'strong'),
    kind === 'Z' && cash.countedCash !== null
      ? row(L.counted, money(cash.countedCash), 'strong')
      : '',
    kind === 'Z' && diff !== null
      ? row(
          diff.isZero() ? L.exact : diff.lt(0) ? L.shortage : L.overage,
          `${diff.gt(0) ? '+' : ''}${money(cash.difference!)}`,
          'strong',
        )
      : '',
  ].join('');

  const movements = cash.movements.length
    ? `<hr /><div class="title">${e(L.movements)}</div>` +
      cash.movements
        .map(
          (m) =>
            row(
              `${formatTime(new Date(m.createdAt))} ${m.type === 'PAY_IN' ? L.payIn : L.payOut}`,
              `${m.type === 'PAY_IN' ? '+' : '−'}${money(m.amount)}`,
            ) + (m.note ? `<div class="muted">${e(m.note)}</div>` : ''),
        )
        .join('')
    : '';

  const sold = session.items.filter((i) => dec(i.soldQuantity).gt(0));
  const dishes = sold.length
    ? `<hr /><div class="title">${e(L.dishes)}</div>` +
      sold
        .map((i) =>
          row(
            `${localName(i, lang)}${i.unlimited ? ` (${L.unlimited})` : ''}`,
            e(formatQty(i.soldQuantity, lang, i.soldByWeight)),
          ),
        )
        .join('')
    : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>${e(L[kind])} ${e(session.id)}</title>
<style>
  @page { size: 72.1mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { width: 72.1mm; padding: 2mm 2mm 4mm; font: 13px/1.35 Arial, sans-serif; overflow-wrap: anywhere; }
  .brand { margin: 0 0 2px; font-size: 16px; text-align: center; }
  .kind { margin: 0 0 6px; font-size: 18px; font-weight: 700; text-align: center; letter-spacing: 1px; }
  hr { margin: 6px 0; border: 0; border-top: 1px dashed #000; }
  .title { margin: 2px 0 4px; font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row > span:first-child { min-width: 0; }
  .amount { white-space: nowrap; }
  .strong { font-weight: 700; }
  .muted { font-size: 12px; }
  .right { text-align: right; }
</style>
</head>
<body>
<h1 class="brand">${e(settings.restaurantName)}</h1>
<p class="kind">${e(L[kind])}</p>
${meta}
<hr />
<div class="title">${e(L.sales)}</div>
${sales}
<hr />
<div class="title">${e(L.drawer)}</div>
${drawer}
${movements}
${dishes}
</body>
</html>`;
}

/** Prints the open shift's X-report or a closed shift's Z-report to the receipt printer. */
export async function printShiftReport(
  db: Db,
  printer: PrinterService,
  input: { sessionId: number; kind: 'X' | 'Z' },
): Promise<PrintResult> {
  const session = await getSession(db, input.sessionId);
  if (input.kind === 'X' && session.status !== 'open')
    throw conflict('X-hisobot faqat ochiq smena uchun. Yopilgan smena uchun Z-hisobot');
  if (input.kind === 'Z' && session.status !== 'closed')
    throw conflict('Z-hisobot smena yopilgandan keyin chiqadi');
  const settings = await getReceiptSettings(db);
  if (!settings) throw conflict('Chek sozlamalari kiritilmagan', { reason: 'NO_RECEIPT_SETTINGS' });
  const cash = await getCashSummary(db, session.id);
  return printer.print(buildShiftReportHtml(input.kind, session, cash, settings), {
    preferredName: settings.printerName,
  });
}
