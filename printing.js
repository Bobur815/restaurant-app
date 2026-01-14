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
  console.log('=== registerPrinting called ===');
  console.log('Device name:', deviceName);

  ipcMain.removeHandler("print-receipt");

  ipcMain.handle("print-receipt", async (evt, payload) => {
    console.log('\n=== Print Receipt Request ===');
    console.log('Payload received:', JSON.stringify(payload, null, 2));
    console.log('Order Number:', payload?.order?.orderNumber);
    console.log('Table Number:', payload?.order?.tableNumber);
    console.log('Items count:', payload?.order?.items?.length);
    console.log('Payment Method:', payload?.paymentMethod);

    const parent = BrowserWindow.fromWebContents(evt.sender) || null;
    let win;

    try {
      console.log('Building receipt HTML...');
      const html = buildReceiptHTML(payload);
      console.log('HTML generated, length:', html.length);

      console.log('Creating BrowserWindow for printing...');
      win = new BrowserWindow({
        show: false,
        backgroundColor: "#ffffff",
        webPreferences: {
          offscreen: false,
          sandbox: false,
        },
      });
      console.log('BrowserWindow created, ID:', win.id);

      // loadURL returns a promise that resolves when did-finish-load fires
      // So we don't need separate event listeners for that
      console.log('Loading HTML content into window...');
      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      );
      console.log('HTML loaded successfully (did-finish-load has fired)');

      // Windows needs render frame - increased delay for Windows 11 compatibility
      console.log('Waiting 1000ms for render frame...');
      await new Promise((r) => setTimeout(r, 1000));
      console.log('Render frame delay completed');

      // Additional ready check for Windows 11
      console.log('Checking document.readyState...');
      const readyState = await win.webContents.executeJavaScript('document.readyState');
      console.log('Document ready state:', readyState);

      // 🔍 Windows'dan real printer nomlarini olish
      console.log('Fetching available printers...');
      const printers = await win.webContents.getPrintersAsync();
      console.log('Total printers found:', printers.length);
      console.log('Printer list:', printers.map(p => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        status: p.status,
        isDefault: p.isDefault
      })));

      // Normalizatsiya (XP-80C on USB001 → xp80conusb001)
      const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

      let targetPrinter = null;

      // 1️⃣ Agar deviceName berilgan bo'lsa — XP-80 yoki XP-80C ga moslab topamiz
      if (deviceName) {
        console.log('Step 1: Searching for deviceName:', deviceName);
        const wanted = normalize(deviceName);
        console.log('Normalized deviceName:', wanted);

        const found = printers.find((p) => normalize(p.name).includes(wanted));

        if (found) {
          targetPrinter = found.name;
          console.log('✓ Printer found by deviceName:', targetPrinter);
        } else {
          console.log('✗ No printer matched deviceName');
        }
      } else {
        console.log('Step 1: Skipped (no deviceName provided)');
      }

      // 2️⃣ Lenovo Windows 11 uchun XPrinter XP-80 oilasini aniq topish
      if (!targetPrinter) {
        console.log('Step 2: Searching for XP-80 family printers...');
        const XP_MODELS = ["xp80", "xp80c", "xp80a"];
        console.log('XP models to search for:', XP_MODELS);

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

            console.log(`  Printer: "${p.name}" → Normalized: "${n}" → Score: ${score}`);

            return { name: p.name, score };
          })
          .filter((p) => p.score > 0)
          .sort((a, b) => b.score - a.score);

        console.log('Scored printers (filtered & sorted):', scored);

        if (scored.length) {
          targetPrinter = scored[0].name;
          console.log('✓ Best match found:', targetPrinter, 'with score:', scored[0].score);
        } else {
          console.log('✗ No XP-80 family printer found');
        }
      } else {
        console.log('Step 2: Skipped (printer already selected)');
      }

      // 3️⃣ Oxirgi fallback — Windows default
      if (!targetPrinter && printers.length) {
        console.log('Step 3: Fallback to first available printer...');
        targetPrinter = printers[0].name;
        console.log('✓ Using fallback printer:', targetPrinter);
      } else if (!targetPrinter) {
        console.log('Step 3: Cannot fallback - no printers available');
      } else {
        console.log('Step 3: Skipped (printer already selected)');
      }

      if (!targetPrinter) {
        console.error('ERROR: No target printer could be selected!');
        throw new Error("No printers found");
      }

      console.log('\n✓✓✓ Final selected printer:', targetPrinter);

      // Enhanced logging for debugging Windows 11 issues
      console.log('=== Print Debug Info ===');
      console.log('Selected printer:', targetPrinter);
      console.log('Available printers:', printers.map(p => p.name));
      const printerInfo = printers.find(p => p.name === targetPrinter);
      console.log('Printer capabilities:', printerInfo);
      console.log('Printer status:', printerInfo?.status);
      console.log('Printer options:', printerInfo?.options);
      console.log('========================');

      // Verify printer is available and ready
      if (printerInfo?.status && printerInfo.status !== 0) {
        console.warn('⚠ Printer status indicates potential issue:', printerInfo.status);
      } else {
        console.log('✓ Printer status OK');
      }

      console.log('\n=== Starting Print Job ===');
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
      console.log('Print options:', JSON.stringify(printOptions, null, 2));

      await new Promise((resolve, reject) => {
        console.log('Calling win.webContents.print()...');
        const startTime = Date.now();

        win.webContents.print(
          printOptions,
          (ok, fail) => {
            const duration = Date.now() - startTime;
            console.log(`Print callback received after ${duration}ms`);

            if (ok) {
              console.log('✓✓✓ Print job submitted successfully!');
              resolve(true);
            } else {
              console.error('✗✗✗ Print job failed!');
              console.error('Failure reason:', fail);
              reject(new Error(fail || "Print failed"));
            }
          }
        );
      });

      console.log('=== Print Completed Successfully ===\n');
      return { ok: true, printer: targetPrinter };
    } catch (e) {
      // Enhanced error logging for Windows 11 diagnostics
      console.error('=== Print Error ===');
      console.error('Error message:', e?.message || e);
      console.error('Error stack:', e?.stack);
      console.error('OS Platform:', process.platform);
      console.error('OS Release:', os.release());
      console.error('===================');

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
      console.log('=== Cleanup ===');
      try {
        if (win && !win.isDestroyed()) {
          console.log('Destroying print window (ID:', win.id, ')');
          win.destroy();
          console.log('Window destroyed successfully');
        } else if (win) {
          console.log('Window already destroyed');
        } else {
          console.log('No window to destroy');
        }
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
      console.log('=== End of Print Request ===\n');
    }
  });

  console.log('Print handler registered successfully\n');
}
