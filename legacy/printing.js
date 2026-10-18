// main/printing.js
import { BrowserWindow, ipcMain, dialog } from "electron";
import os from "os";

/** (ixtiyoriy) Printerlar ro'yxatini ko'rib olish */
export async function logPrintersOnce() {
  const tmp = new BrowserWindow({ show: false });
  try {
    const list = await tmp.webContents.getPrintersAsync();
  } finally {
    if (!tmp.isDestroyed()) tmp.destroy();
  }
}

/** payment.html dagi #checkPreview ko‘rinishiga JUDA o‘xshash HTML */
function buildReceiptHTML({ order, paymentMethod }) {
  const esc = (s = "") =>
    String(s ?? "").replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
    );
  const toNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const money = (n) => toNum(n).toLocaleString("uz-UZ") + " so'm";

  const now = order?.orderDate ? new Date(order.orderDate) : new Date();
  const dateStr = new Intl.DateTimeFormat("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
  const timeStr = new Intl.DateTimeFormat("uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const paymentMap = {
    cash: "Naqd",
    card: "Karta",
    click: "Klik",
    debt: "Nasiya",
  };

  // Items
  let total = 0;
  const itemsHTML = (order.items || [])
    .map((it, idx0) => {
      const idx = idx0 + 1;
      const name = String(it?.menu.name ?? it?.name ?? "").trim();
      const qty = Math.max(0, toNum(it?.quantity, 0));
      const unitPrice = toNum(it?.unitPrice, 0);
      const portion = it?.portions != null ? toNum(it.portions, 1) : 1;
      const weight =
        it?.weightKg != null
          ? toNum(it.weightKg, 1)
          : it?.weightValue != null
            ? toNum(it.weightValue, 1)
            : 1;
      const factor = weight && weight !== 1 ? weight : portion;

      const lineSubtotal = qty * unitPrice;
      total += lineSubtotal;

      // payment.html dagi leftLabel ni xuddi shunday tuzamiz:
      const leftLabel =
        factor && factor !== 1
          ? `${idx}. ${name} (${factor}) \n\t${qty} × ${toNum(unitPrice)}`
          : `${idx}. ${name} \n\t${qty} × ${unitPrice}`;

      // .price .calc matnini ham chiqaramiz, lekin CSS bo‘yicha rangini “transparent” qilamiz (preview’dagi kabi)
      const unitWithFactor = unitPrice * (factor || 1);

      return `
      <div class="li">
        <div class="left">
          <div class="qtyname">${esc(leftLabel)}</div>
          <div class="leaders"></div>
        </div>
        <div class="price">
            <div class="calc">${qty} × ${unitWithFactor.toLocaleString("uz-UZ")}</div>
            <div class="subtotal">${money(lineSubtotal)}</div>
        </div>
      </div>
    `;
    })
    .join("");

  const brand = esc(order?.brand ?? order.restaurantName ?? "Oshxona");
  const addr = order?.address
    ? `<p class="addr">${esc(order.address)}</p>`
    : "";
  const phone = order?.phone ? `<p class="phone">${esc(order.phone)}</p>` : "";
  const footer = order?.footerNote
    ? `<footer class="footNote">***** ${esc(order.footerNote)} *****</footer>`
    : "";

  // Inlayn CSS — payment.css dagi print’ga moslashtirilgan ko‘rinish
  return `
<!doctype html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <title>Receipt</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: #000;
      font-family: sans-serif;
      align-items: center;
    }
    .print-wrap { 
    align-items: center;
    width: 72mm;
    }

    /* Receipt card (border/shadow bekor – printer uchun) */
    #print-checkPreview { padding-right: 4mm; }

    .brand {
      text-align: center;
      margin: 0 0 2px 0;
      font-weight: 700;
      font-size: 18px;
    }
    .addr, .phone, .footNote {
      text-align: center;
      margin: 0 0 8px 0;
      color: #000;
      font-size: 14px;
      line-height: 1.5;
    }

    .meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
      font-size: 13px;
      margin: 10px 0 6px;
    }
    .meta b { font-weight: 600; }

    hr {
      border: 0;
      border-top: 1px dashed #000;
      margin: 10px 0;
    }

    .sep {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      color: #000;
      letter-spacing: 0.5px;
      margin: 10px 0;
      user-select: none;
    }

    .items { margin: 8px 0; }

    .li {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: start;
      column-gap: 8px;
      padding: 3px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
    }
    .li .left {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 6px;
      white-space: nowrap;
      overflow: hidden;
    }
    .qtyname {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre; /* \n\t ni saqlash uchun */
      tab-size: 4;
    }
    .leaders {
      border-bottom: 1px dotted #000;
      align-self: end;
      margin: 0 2px;
    }
    .price {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      line-height: 1.1;
      white-space: nowrap;
    }
    .price .calc {
      font-size: 12px;
      color: transparent; /* preview’dagi kabi “ko‘rinmas” bo‘lsin */
    }
    .price .subtotal {
      font-weight: 700;
      margin-top: 2px;
    }

    .total-row{
      display: grid;
      grid-template-columns: auto 1fr auto; /* label | dots | amount */
      align-items: end;
      gap: 8px;
      font-weight: 700;
      font-size: 18px;
      margin: 20px 0;
    }
    .total-row .leaders{
      border-bottom: 1px dotted #000;
      height: 0;
      align-self: end;
    }
    .total-row .amount{ white-space: nowrap; }

    .label{ font-weight: 600; }

    .method-row{
      display: grid;
      grid-template-columns: auto 1fr auto; /* label | dots | amount */
      align-items: end;
      gap: 4px;
      font-size: 13px;
      margin-bottom: 3px;
    }
    .method-row .leaders{
      border-bottom: 1px dotted #000;
      height: 0;
      align-self: end;
      transform: translateY(-12px);
    }
    .method-row .amount{ white-space: nowrap; }
  </style>
</head>
<body>
  <div class="print-wrap">
    <div id="print-checkPreview">
      <h3 class="brand">${brand}</h3>
      ${addr}
      ${phone}
      <div class="sep">****************************</div>

      <div class="meta">
        <div><b>Stol:</b> ${esc(order?.tableNumber ?? "")}</div>
        <div style="text-align:right;"><b>Buyurtma:</b> #${order?.orderNumber ?? ""}</div>
        <div><b>Sana:</b> ${dateStr}</div>
        <div style="text-align:right;"><b>Soat:</b> ${timeStr}</div>
      </div>

      <hr><hr>

      <div class="items">
        ${itemsHTML}
      </div>

      <hr><hr>

      <div class="total-label" style="font-weight:300;font-size:14px;">
        Pozitsiyalar: ${(order.items || []).length}
      </div>

      <hr><hr>

      <div class="total-row">
        <div class="label">Jami to'lovga:</div>
        <div class="leaders"></div>
        <div class="amount">${money(total)}</div>
      </div>

      <div class="payment-methods">
        <div class="label">To'lov usuli:</div>
        <div class="method-row">
          <p class="method"> · ${paymentMap[String(paymentMethod)] || "Naqd"}</p>
          <div class="leaders"></div>
          <p class="amount">= ${money(total)}</p>
        </div>
      </div>

      <hr><hr>
      ${footer}
    </div>
  </div>
</body>
</html>
`;
}

/** Handler — payment.html dagi window.electronAPI.sendPrint(payload) ni qabul qiladi */
export function registerPrinting(
  deviceName /* XP-80 yoki XP-80C bo'lishi mumkin */
) {
  ipcMain.removeHandler("print-receipt");

  ipcMain.handle("print-receipt", async (evt, payload) => {
    const parent = BrowserWindow.fromWebContents(evt.sender) || null;
    let win;

    try {
      const html = buildReceiptHTML(payload);

      win = new BrowserWindow({
        show: false,
        backgroundColor: "#ffffff",
        webPreferences: {
          offscreen: false,
          sandbox: false,
        },
      });

      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      );

      // Windows needs render frame - increased delay for Windows 11 compatibility
      await new Promise((r) => setTimeout(r, 1000));

      // Additional ready check for Windows 11
      await win.webContents.executeJavaScript('document.readyState');

      // 🔍 Windows'dan real printer nomlarini olish
      const printers = await win.webContents.getPrintersAsync();

      // Normalizatsiya (XP-80C on USB001 → xp80conusb001)
      const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

      let targetPrinter = null;

      // 1️⃣ Agar deviceName berilgan bo'lsa — XP-80 yoki XP-80C ga moslab topamiz
      if (deviceName) {
        const wanted = normalize(deviceName);
        const found = printers.find((p) => normalize(p.name).includes(wanted));
        if (found) {
          targetPrinter = found.name;
        }
      }

      // 2️⃣ Lenovo Windows 11 uchun XPrinter XP-80 oilasini aniq topish
      if (!targetPrinter) {
        const XP_MODELS = ["xp80", "xp80c", "xp80a"];

        const scored = printers
          .map((p) => {
            const n = normalize(p.name);

            let score = 0;

            // exact XP-80 family
            if (XP_MODELS.some((x) => n.includes(x))) score += 100;

            // Windows USB port driver (USB001 etc)
            if (n.includes("usb")) score += 50;
            if (n.includes("redirected")) score -= 100;
            if (n.includes("copy")) score -= 100;
            if (n.includes("xps")) score -= 100;
            if (n.includes("onenote")) score -= 100;

            // Avoid copy drivers unless no choice
            if (n.includes("copy")) score -= 5;

            return { name: p.name, score };
          })
          .filter((p) => p.score > 0)
          .sort((a, b) => b.score - a.score);

        if (scored.length) {
          targetPrinter = scored[0].name;
        }
      }

      // 3️⃣ Oxirgi fallback — Windows default
      if (!targetPrinter && printers.length) {
        targetPrinter = printers[0].name;
      }

      if (!targetPrinter) {
        throw new Error("No printers found");
      }

      const printerInfo = printers.find(p => p.name === targetPrinter);

      // Verify printer is available and ready
      if (printerInfo?.status && printerInfo.status !== 0) {
        console.warn('⚠ Printer status indicates potential issue:', printerInfo.status);
      }

      const printOptions = {
        silent: true,
        deviceName: targetPrinter,
        margins: { marginType: "none" },
        pageSize: {
          width: 80000,   // 80mm in microns
          height: 1000000 // 1000mm in microns - long enough for any receipt
        },
        printBackground: true,
        color: false,        // Explicit for thermal printers
        scaleFactor: 100,    // Prevent scaling issues
        landscape: false,    // Explicit portrait mode
        dpi: { horizontal: 203, vertical: 203 }, // Standard thermal printer DPI
      };

      await new Promise((resolve, reject) => {
        win.webContents.print(
          printOptions,
          (ok, fail) => {
            if (ok) {
              resolve(true);
            } else {
              console.error('Print job failed:', fail);
              reject(new Error(fail || "Print failed"));
            }
          }
        );
      });

      return { ok: true, printer: targetPrinter };
    } catch (e) {
      console.error('Print error:', e?.message || e);

      try {
        await dialog.showMessageBox(parent, {
          type: "error",
          buttons: ["OK"],
          title: "Printer Error",
          message: "Chekni chop etishda xatolik yuz berdi",
          detail: String(e?.message || e || "Print failed"),
          noLink: true,
        });
      } catch {}

      return { ok: false, error: String(e?.message || e) };
    } finally {
      try {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }
  });
}
