// printer.js
import { Printer } from '@node-escpos/core';
import USB from '@node-escpos/usb-adapter';

/** ===== Formatting helpers (80mm, Font A ≈ 42 cols; Font B ≈ 48 cols) ===== */
const COLS = 42;       // try 42 first; if lines wrap, set 48 and call printer.font('B')
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
    .replaceAll('📍','');
}

function center(text) {
  const t = normalizeUz(text);
  if (t.length >= COLS) return t; // printer will wrap
  const pad = Math.floor((COLS - t.length) / 2);
  return ' '.repeat(pad) + t;
}

function padRight(text, width = COLS) {
  const t = normalizeUz(text);
  if (t.length >= width) return t.slice(0, width);
  return t + ' '.repeat(width - t.length);
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
  const leftName = `${idx}. ${name}${fx}`;               // line 1 left
  const rightCalc = `${qty} × ${unit * (factor || 1)}`; // line 1 right (no currency)
  const line1 = dotLine(leftName, rightCalc);

  // line 2 only shows the money total, aligned right
  const subStr = money(lineSubtotal);
  const line2 = padLeft(subStr, COLS); // right align
  return [line1, line2];
}

/** ===== Main print function ===== */
export async function printReceipt(order, paymentMethod, opts = {}) {
  // fallback values
  const brand = normalizeUz(order?.brand || 'Shoxona milliy');
  const addr  = normalizeUz(order?.address || '');
  const tel   = normalizeUz(order?.phone || '');
  const footerNote = normalizeUz(order?.footerNote || "Xaridingiz uchun rahmat !");

  const items = Array.isArray(order?.items) ? order.items : [];
  const now = new Date();

  const device = new USB();
  await new Promise((res, rej) => device.open(err => err ? rej(err) : res())); // open USB

  const p = new Printer(device, {
    encoding: 'CP437'   // try 'CP858' if you need more latin glyphs
  });

  let total = 0;

  try {
    // Choose font & init
    p.hardware('INIT');
    p.font('A');               // for 42 columns. Use 'B' + COLS=48 if you prefer narrower text
    p.align('CT');
    p.style('B').size(1,1).text(center(brand));
    p.style('NORMAL').size(1,1);
    if (addr) p.text(center(addr));
    if (tel)  p.text(center(`Tel: ${tel}`));
    p.text('*'.repeat(COLS));

    // Meta
    p.align('LT');
    p.text(
      dotLine(
        `Stol: ${order?.table_number ?? ''}`,
        `Buyurtma: #${String(order?.orderId ?? '').padStart(6, '0')}`
      )
    );
    p.text(
      dotLine(
        `Sana: ${now.toLocaleDateString('uz-UZ')}`,
        `Soat: ${now.toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit', hour12:false})}`
      )
    );
    p.text(SEP);

    // Items
    items.forEach((it, i) => {
      const name    = normalizeUz(String(it?.name || '').trim());
      const qty     = Number(it?.quantity || 0);
      const unit    = Number(it?.price || 0);
      const portion = it?.portions != null ? Number(it.portions || 1) : 1;
      const weight  = it?.weight_kg ?? it?.weightValue ?? 1;
      const factor  = (weight && weight !== 1) ? Number(weight) : portion;
      const lineSum = qty * factor * unit;
      total += lineSum;

      const [l1, l2] = itemLines(i + 1, name, qty, unit, factor, lineSum);
      p.text(l1);
      p.text(l2);
      p.text(''); // small spacing between items
    });

    // positions count
    p.text(`Pozitsiyalar: ${(items.length || 0)}`);
    p.text(SEP);

    // Total
    p.style('B');
    p.text(dotLine(`Jami to'lovga:`, money(total)));
    p.style('NORMAL');
    p.text(SEP);

    // Payment method
    const map = { cash: 'Naqd', card: 'Karta', click: 'Klik', debt: 'Nasiya' };
    const pmt = map[paymentMethod] || 'Naqd';
    p.text(`To'lov usuli:`);
    p.text(dotLine(`- ${pmt}`, `= ${money(total)}`));

    p.text('');
    p.align('CT');
    p.text(`***** ${footerNote} *****`);
    p.align('LT');

    // feed + cut
    p.feed(3);
    p.cut();
    // optional: open drawer on pin 2
    // p.cashdraw(2);
  } finally {
    try { p.close(); } catch {}
  }
}
