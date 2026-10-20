import type {
  Language,
  OrderDto,
  OrderType,
  ReceiptLayoutDto,
  ReceiptSettingsDto,
} from '@shared/types';
import { escapeHtml } from '@shared/utils/escape-html';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatQty,
  formatTime,
  localName,
} from '@shared/utils/format';
import { formatPhone } from '@shared/utils/phone';
import { dec } from '@shared/utils/decimal';
import { legacyLayout } from './layouts';

/**
 * The customer receipt as a standalone HTML document, built in the main process from the
 * order in the database (never from markup the page sends). Every value is escaped. The same
 * document is printed and rendered for the settings preview, so the two cannot drift.
 *
 * Layout follows the legacy receipt: brand, address and phones, separator, table / order /
 * date / time, numbered lines, positions count, total, payment method, footer note. The
 * order type's layout (layouts.ts) decides which parts appear and adds its top and bottom
 * pictures; the shared receipt settings give the shop details, separator and language.
 */

const LABELS: Record<Language, Record<string, string>> = {
  uz: {
    table: 'Stol',
    order: 'Buyurtma',
    date: 'Sana',
    time: 'Soat',
    positions: 'Pozitsiyalar',
    total: "Jami to'lovga",
    method: "To'lov usuli",
    cash: 'Naqd',
    card: 'Karta',
    click: 'Click',
    debt: 'Nasiya',
    portion07: '70%',
    portionHalf: 'yarim',
    sample: 'Namuna',
    TAKEAWAY: 'Olib ketish',
    DELIVERY: 'Yetkazib berish',
    customer: 'Mijoz',
    phone: 'Tel',
    address: 'Manzil',
    note: "Mo'ljal",
    remark: 'Izoh',
    due: 'Qaytarish muddati',
    deliveryFee: 'Yetkazib berish xizmati',
  },
  ru: {
    table: 'Стол',
    order: 'Заказ',
    date: 'Дата',
    time: 'Время',
    positions: 'Позиций',
    total: 'Итого к оплате',
    method: 'Способ оплаты',
    cash: 'Наличные',
    card: 'Карта',
    click: 'Click',
    debt: 'В долг',
    portion07: '70%',
    portionHalf: 'половина',
    sample: 'Образец',
    TAKEAWAY: 'С собой',
    DELIVERY: 'Доставка',
    customer: 'Клиент',
    phone: 'Тел',
    address: 'Адрес',
    note: 'Ориентир',
    remark: 'Комментарий',
    due: 'Вернуть до',
    deliveryFee: 'Услуга доставки',
  },
};

const e = (value: string | number | null | undefined) => escapeHtml(String(value ?? ''));

export interface ReceiptOptions {
  /** Time printed on the receipt; default: when the order was paid, else now. */
  printedAt?: Date;
  /** The order type's layout; default: what receipts printed before layouts (old switches). */
  layout?: ReceiptLayoutDto;
  /**
   * A stored picture as a `data:` URL (the document may load nothing else), or null when it is
   * missing: the receipt then prints without it.
   */
  image?: (fileName: string) => string | null;
}

/** A layout picture, centred at its width in % of the paper; nothing when it cannot be loaded. */
function picture(
  fileName: string | null,
  width: number,
  load: ReceiptOptions['image'],
  cls: string,
): string {
  const src = fileName && load ? load(fileName) : null;
  if (!src || !src.startsWith('data:image/')) return '';
  const pct = Math.min(100, Math.max(20, Math.round(width)));
  return `<div class="picture ${cls}"><img src="${e(src)}" alt="" style="width: ${pct}%" /></div>`;
}

export function receiptLanguage(settings: Pick<ReceiptSettingsDto, 'locale'>): Language {
  return settings.locale.startsWith('ru') ? 'ru' : 'uz';
}

export function buildReceiptHtml(
  order: OrderDto,
  settings: ReceiptSettingsDto,
  options: ReceiptOptions = {},
): string {
  const lang = receiptLanguage(settings);
  const L = LABELS[lang];
  const layout = options.layout ?? legacyLayout(settings);
  const when =
    options.printedAt ?? new Date(order.completedAt ?? order.payments[0]?.paidAt ?? Date.now());
  const separator = settings.printUseStarsSep
    ? `<div class="sep">${e(settings.printSeparatorChar.repeat(Math.max(1, settings.printSeparatorCount)))}</div>`
    : '<hr />';

  const phones = [settings.phone, settings.extraPhones].filter((p) => p.trim()).join(', ');
  const header = [
    `<h1 class="brand">${e(settings.restaurantName)}</h1>`,
    layout.showAddress && settings.address.trim()
      ? `<p class="center">${e(settings.address)}</p>`
      : '',
    layout.showPhone && phones ? `<p class="center">${e(phones)}</p>` : '',
  ].join('');

  const meta = [
    order.orderType !== 'DINE_IN'
      ? `<div><b>${e(L[order.orderType])}</b></div>`
      : order.tableNumber !== null
        ? `<div><b>${e(L.table)}:</b> ${e(order.tableNumber)}</div>`
        : '<div></div>',
    layout.showOrderNumber
      ? `<div class="right"><b>${e(L.order)}:</b> #${e(order.orderNumber)}</div>`
      : '<div></div>',
    layout.showDateTime ? `<div><b>${e(L.date)}:</b> ${e(formatDate(when))}</div>` : '',
    layout.showDateTime
      ? `<div class="right"><b>${e(L.time)}:</b> ${e(formatTime(when))}</div>`
      : '',
  ].join('');

  const lines = order.lines
    .map((line, i) => {
      const variant = line.weightKg
        ? ` (${formatQty(line.weightKg, lang, true)})`
        : line.portion === '0.7'
          ? ` (${L.portion07})`
          : line.portion === '0.5'
            ? ` (${L.portionHalf})`
            : '';
      return `<div class="line">
        <div class="name">${i + 1}. ${e(localName(line, lang))}${e(variant)}</div>
        <div class="calc"><span>${e(formatNumber(line.quantity, 3))} × ${e(formatMoney(line.unitPrice, lang, false))}</span><span class="amount">${e(formatMoney(line.totalPrice, lang))}</span></div>
      </div>`;
    })
    .join('');

  // Takeaway/delivery: who it is for and where it goes, as saved with the order.
  const customer =
    order.orderType === 'DINE_IN' || !layout.showCustomer
      ? ''
      : [
          order.customerName ? `<div><b>${e(L.customer)}:</b> ${e(order.customerName)}</div>` : '',
          order.customerPhone
            ? `<div><b>${e(L.phone)}:</b> ${e(formatPhone(order.customerPhone))}</div>`
            : '',
          order.deliveryAddress
            ? `<div><b>${e(L.address)}:</b> ${e(order.deliveryAddress)}</div>`
            : '',
          // A delivery's note is the landmark; on takeaway it is a free remark.
          order.deliveryNote
            ? `<div><b>${e(order.orderType === 'DELIVERY' ? L.note : L.remark)}:</b> ${e(order.deliveryNote)}</div>`
            : '',
        ].join('');
  const fee = dec(order.deliveryFee).gt(0)
    ? `<div class="row"><span>${e(L.deliveryFee)}</span><span class="amount">${e(formatMoney(order.deliveryFee, lang))}</span></div>`
    : '';

  // One row per payment method (split checks list each); the debt part names who owes it.
  const tenderRow = (p: OrderDto['payments'][number]) =>
    `<div class="row"><span>${e(L[p.method])}${p.method === 'debt' && p.customerName ? ` (${e(p.customerName)})` : ''}</span><span class="amount">${e(formatMoney(p.amount, lang))}</span></div>` +
    (p.method === 'debt' && p.dueDate
      ? `<div class="muted">${e(L.due)}: ${e(formatDate(new Date(p.dueDate)))}</div>`
      : '');
  const paymentBlock =
    order.payments.length > 0
      ? `<div class="muted">${e(L.method)}:</div>${order.payments.map(tenderRow).join('')}`
      : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
<title>${e(order.orderNumber)}</title>
<style>
  /* 72.1 mm = the printable width of 80 mm roll paper (printer.ts RECEIPT_PAGE_MICRONS). */
  @page { size: 72.1mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { width: 72.1mm; padding: 2mm 2mm 4mm; font: 13px/1.35 Arial, sans-serif; overflow-wrap: anywhere; }
  .brand { margin: 0 0 4px; font-size: 18px; text-align: center; }
  .center { margin: 0 0 4px; text-align: center; }
  .sep { margin: 6px 0; overflow: hidden; white-space: nowrap; text-align: center; letter-spacing: 1px; }
  hr { margin: 6px 0; border: 0; border-top: 1px dashed #000; }
  .meta { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; margin: 4px 0; }
  .right { text-align: right; white-space: nowrap; }
  .line { margin: 4px 0; }
  .name { font-weight: 600; }
  .calc, .row { display: flex; justify-content: space-between; gap: 8px; }
  .calc > span:first-child, .row > span:first-child { min-width: 0; }
  .amount { white-space: nowrap; font-weight: 600; }
  .total { display: flex; justify-content: space-between; margin: 8px 0; font-size: 17px; font-weight: 700; }
  .muted { font-size: 12px; }
  .customer { margin: 4px 0; overflow-wrap: anywhere; }
  .footer { margin-top: 10px; text-align: center; }
  .picture { text-align: center; line-height: 0; }
  .picture img { max-width: 100%; height: auto; filter: grayscale(1); }
  .picture-top { margin-bottom: 6px; }
  .picture-bottom { margin-top: 10px; }
</style>
</head>
<body>
${picture(layout.topImage, layout.topImageWidth, options.image, 'picture-top')}
${header}
${separator}
<div class="meta">${meta}</div>
${customer ? `<div class="customer">${customer}</div>` : ''}
<hr />
${lines}
<hr />
<div class="muted">${e(L.positions)}: ${order.lines.length}</div>
${fee}
<div class="total"><span>${e(L.total)}:</span><span class="amount">${e(formatMoney(order.totalAmount, lang))}</span></div>
${paymentBlock}
${layout.footerNote.trim() ? `${separator}<p class="footer">${e(layout.footerNote)}</p>` : ''}
${picture(layout.bottomImage, layout.bottomImageWidth, options.image, 'picture-bottom')}
</body>
</html>`;
}

/** A realistic sample order for the settings preview and the test print. */
export function sampleOrder(lang: Language, type: OrderType = 'DINE_IN'): OrderDto {
  const now = new Date().toISOString();
  const line = (
    id: number,
    nameUz: string,
    nameRu: string,
    quantity: string,
    unitPrice: string,
    totalPrice: string,
    extra: Partial<OrderDto['lines'][0]> = {},
  ) => ({
    id,
    menuItemId: id,
    nameUz,
    nameRu,
    imageFile: null,
    soldByWeight: false,
    hasPortions: false,
    quantity,
    portion: null,
    weightKg: null,
    unitPrice,
    totalPrice,
    stockQuantity: quantity,
    ...extra,
  });
  // Delivery adds a fee; takeaway and delivery carry who it is for.
  const fee = type === 'DELIVERY' ? '10000' : '0';
  const total = dec('129600').plus(fee).toFixed();
  const sample: Record<OrderType, Partial<OrderDto>> = {
    DINE_IN: {},
    TAKEAWAY: { tableNumber: null, customerName: lang === 'ru' ? 'Азиз' : 'Aziz' },
    DELIVERY: {
      tableNumber: null,
      customerName: lang === 'ru' ? 'Азиза' : 'Aziza',
      customerPhone: '998901234567',
      deliveryAddress: lang === 'ru' ? 'Чиланзар 9, дом 12' : 'Chilonzor 9, 12-uy',
      deliveryNote: lang === 'ru' ? 'Возле школы' : 'Maktab yonida',
      deliveryFee: fee,
    },
  };
  return {
    id: 0,
    orderNumber: `${new Date().getFullYear()}-00000`,
    tableNumber: 1,
    customerId: null,
    customerName: null,
    customerPhone: null,
    deliveryAddress: null,
    deliveryNote: null,
    deliveryFee: '0',
    deliveryStatus: null,
    courierName: null,
    status: 'completed',
    sessionId: 0,
    totalAmount: total,
    paymentMethod: 'cash',
    version: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    createdBy: LABELS[lang]['sample'] ?? null,
    lines: [
      line(1, 'Osh', 'Плов', '2', '28000', '56000', { hasPortions: true, portion: '1' }),
      line(2, 'Osh', 'Плов', '1', '19600', '19600', { hasPortions: true, portion: '0.7' }),
      line(3, 'Shashlik', 'Шашлык', '1', '45000', '45000', {
        soldByWeight: true,
        weightKg: '0.25',
        stockQuantity: '0.25',
      }),
      line(4, 'Choy', 'Чай', '3', '3000', '9000'),
    ],
    payments: [
      {
        id: 0,
        orderId: 0,
        amount: total,
        method: 'cash',
        status: 'paid',
        paidAt: now,
        customerId: null,
        customerName: null,
        dueDate: null,
        settledAt: null,
      },
    ],
    ...sample[type],
    orderType: type,
  };
}
