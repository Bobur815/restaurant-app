// printer.js
import { Printer } from '@node-escpos/core';
import USB from '@node-escpos/usb-adapter';
import { showAlert } from './utils/alert';

/** ===== Formatting helpers (80mm, Font A ≈ 42 cols; Font B ≈ 48 cols) ===== */
const COLS = 46;       // try 42 first; if lines wrap, set 48 and call printer.font('B')
const SEP = '-'.repeat(COLS);

function normalizeUz(str = '') {
  return String(str)
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('`', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replaceAll('–', '-')
    .replaceAll('—', '-')
    .replaceAll('·', '-')
    .replaceAll('📍', '');
}

function center(text) {
  const t = normalizeUz(text);
  if (t.length >= COLS) return t; // printer will wrap
  const pad = Math.floor((COLS - t.length) / 2);
  return ' '.repeat(pad) + t;
}

function setFooter(text) {
  const t = normalizeUz(text)
  if (t.length >= COLS) return t;
  const pad = Math.floor((COLS - t.length) / 2);
  return `${'*'.repeat(pad - 1)} ${t} ${'*'.repeat(pad - 1)}`

}

function padLeft(text, width) {
  const t = normalizeUz(text);
  if (t.length >= width) return t.slice(0, width);
  return ' '.repeat(width - t.length) + t;
}

function money(n) {
  const v = Number(n || 0);
  // format as 20,000 so'm without locale commas issues
  return v.toLocaleString('en-US').replaceAll(',', ' ') + " so'm";
}

/** Make "left ..... right" in one line with dots */
function dotLine(left, right) {
  const L = normalizeUz(left).trim();
  const R = normalizeUz(right).trim();
  const space = COLS - L.length - R.length;
  const dots = space > 0 ? '.'.repeat(space) : ' ';
  return L + dots + R;
}

/** Item line: two lines (calc + subtotal), similar to screenshot */
function itemLines(idx, name, qty, unit, factor, lineSubtotal) {

  const fx = (factor && factor !== 1) ? ` (${factor})` : '';
  const line1 = `${idx}. ${name}${fx}`;
  const rightCalc = `${qty} x ${unit * (factor || 1)}`;

  // line 2 only shows the money total, aligned right
  const subStr = money(lineSubtotal);
  const line2 = dotLine(rightCalc, padLeft(subStr, COLS));
  return [line1, line2];
}

/** ===== Main print function ===== */
export async function printReceipt(orderIn, paymentMethod, opts = {}) {
  // ---------- Normalize order root ----------
  const order = orderIn || {};
  const brand =
    (order.restaurantName ?? order.brand ?? 'Shoxona milliy').toString();
  const addr = (order.address ?? '').toString();
  const tel = (order.phone ?? '').toString();
  // accept either footerNote or footNote (from payment.html)
  const footerNote = (order.footerNote ?? order.footNote ?? 'Xaridingiz uchun rahmat !').toString();

  // order meta
  const orderNumber = order.orderNumber ?? order.order_id ?? order.orderId ?? '';
  const tableNumber = order.tableNumber ?? order.table_number ?? '';
  const now = order.orderDate ? new Date(order.orderDate) : new Date();

  // ---------- Normalize items to a common shape ----------
  // For each item, produce: { name, unitPrice, quantity, factor }
  const rawItems = Array.isArray(order.items) ? order.items : [];
  const items = rawItems.map((it) => {
    // name: checks.js => it.menu?.name ; payment.html => it.name
    const name =
      (it?.menu && typeof it.menu === 'object' ? it.menu.name : it?.name) ?? '';

    // unit price: checks.js => it.unitPrice ; payment.html => it.price
    const unitPrice = Number(
      it?.unitPrice ?? it?.price ?? 0
    );

    // quantity: string/number, fallback 1
    const quantity = Math.max(0, Number(it?.quantity ?? 1));

    // factor: weight (if provided) OR portion OR 1
    const weight = it?.weightKg ?? it?.weight_kg ?? it?.weightValue;
    const portion = it?.portions != null ? Number(it.portions) : undefined;
    const factor = Number(
      (weight != null && weight !== '' ? weight : (portion != null ? portion : 1))
    ) || 1;

    return { name: String(name), unitPrice, quantity, factor };
  });

  // ---------- Printer ----------
  const device = new USB();
  try {
    await new Promise((res, rej) => device.open(err => err ? rej(err) : res()));
  } catch (e) {
    await showAlert("Printer not accessible. On Windows, install WinUSB with Zadig, then replug the printer.");
  }
  const p = new Printer(device, { encoding: 'CP437' }); // or 'CP858' if accents needed

  let total = 0;
  try {
    p.hardware('INIT');
    p.font('A'); // 42 cols

    // Header
    p.style('B').size(1.5, 1.5).text(center(brand));
    p.style('NORMAL').size(1, 1);
    if (addr) p.text(center(addr));
    if (tel) p.text(center(`Tel: ${tel}`));
    p.text('');
    p.text('*'.repeat(COLS));
    p.text('');

    // Meta
    p.text(dotLine(`Stol: ${tableNumber ?? ''}`, `Buyurtma: #${String(orderNumber ?? '')}`));
    p.text(dotLine(
      `Sana: ${now.toLocaleDateString('uz-UZ')}`,
      `Soat: ${now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', hour12: false })}`
    ));
    p.text(SEP); p.text(SEP); p.text('');

    // Lines
    items.forEach((it, i) => {
      const lineSum = it.quantity * it.factor * it.unitPrice;
      total += lineSum;

      const [l1, l2] = itemLines(i + 1, it.name, it.quantity, it.unitPrice, it.factor, lineSum);
      p.text(l1);
      p.text(l2);
      p.text('');
    });

    p.text(SEP); p.text(SEP);
    p.text(`Pozitsiyalar: ${items.length}`);
    p.text(SEP);

    // Total
    p.style('B');
    p.text(dotLine(`Jami to'lovga:`, money(total)));
    p.style('NORMAL');
    p.text(SEP);

    // Payment method
    const map = { cash: 'Naqd', card: 'Karta', click: 'Klik', debt: 'Nasiya' };
    const pmt = map[(paymentMethod ?? '').toLowerCase()] || 'Naqd';
    p.text(`To'lov usuli:`);
    p.text(dotLine(`- ${pmt}`, `= ${money(total)}`));

    p.text(''); p.text(SEP); p.text(SEP);
    if (footerNote) p.text(setFooter(footerNote));

    p.feed(3);
    p.cut();
  } finally {
    try { p.close(); } catch { }
  }
}

