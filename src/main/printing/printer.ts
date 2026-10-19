import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { AppError } from '../domain/errors';

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

export interface PrintResult {
  printer: string;
}

/** What handlers use; injected so they are testable without a printer. */
export interface PrinterService {
  list(): Promise<PrinterInfo[]>;
  print(
    html: string,
    options: { preferredName: string | null; widthPx: number },
  ): Promise<PrintResult>;
  /** PNG data URL of the document as the receipt printer would get it. */
  preview(html: string, widthPx: number): Promise<string>;
}

/**
 * Electron's printer list has no default flag any more; on Windows the driver options carry it
 * when they do (`printer-is-default`). Treat it as a hint only.
 */
function toPrinterInfo(p: Electron.PrinterInfo): PrinterInfo {
  const options = (p.options ?? {}) as Record<string, string>;
  return {
    name: p.name,
    isDefault: options['printer-is-default'] === 'true' || options['is-default'] === 'true',
  };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which printer gets the receipt:
 * 1. the one named in settings (matched loosely: "XP-80C" finds "XP-80C (copy 1) on USB001");
 * 2. else the XP-80 thermal family (legacy heuristic: prefer USB, never XPS/OneNote/PDF/fax);
 * 3. else the Windows default printer; else the first one. Null when there are none.
 */
export function pickPrinter(printers: PrinterInfo[], preferredName: string | null): string | null {
  if (printers.length === 0) return null;
  if (preferredName?.trim()) {
    const wanted = normalize(preferredName);
    const exact = printers.find((p) => p.name === preferredName);
    if (exact) return exact.name;
    const loose = printers.find((p) => normalize(p.name).includes(wanted));
    if (loose) return loose.name;
  }
  const virtual = /xps|onenote|pdf|fax|redirected/;
  const scored = printers
    .map((p) => {
      const n = normalize(p.name);
      let score = 0;
      if (/xp80|xp58|thermal|pos80|receipt/.test(n)) score += 100;
      if (n.includes('usb')) score += 20;
      if (virtual.test(n)) score -= 1000;
      if (n.includes('copy')) score -= 5;
      return { name: p.name, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored[0]) return scored[0].name;
  return (printers.find((p) => p.isDefault) ?? printers[0]!).name;
}

/**
 * The receipt window: hidden, sandboxed, no preload, no node, its own session-less data URL.
 * It only ever loads the receipt document built in main (whose CSP allows no scripts).
 */
export function receiptWindowOptions(widthPx: number): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: Math.max(200, Math.round(widthPx)),
    height: 1200,
    backgroundColor: '#ffffff',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Main measures the page with executeJavaScript (not page script; the document's CSP
      // forbids scripts).
      javascript: true,
      // Never shown, but painted, so capturePage can render the preview.
      backgroundThrottling: false,
    },
  };
}

const MICRONS_PER_PX = 25_400 / 96;
export const PRINT_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new AppError('CONFLICT', 'Printer javob bermadi', { reason: 'TIMEOUT' }));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function openReceiptWindow(html: string, widthPx: number): Promise<BrowserWindow> {
  const win = new BrowserWindow(receiptWindowOptions(widthPx));
  // Any attempt by the document to open or navigate anywhere is refused.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  await win.loadURL(
    `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
  );
  return win;
}

async function contentHeight(win: BrowserWindow): Promise<number> {
  const h = (await win.webContents.executeJavaScript(
    // The body's real bottom edge: documentElement.scrollHeight never drops below the viewport,
    // which would feed blank paper after every receipt.
    'Math.ceil(document.body.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).marginBottom || 0))',
    true,
  )) as number;
  return Math.max(200, Math.ceil(h));
}

export function createPrinterService(): PrinterService {
  return {
    async list() {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      try {
        return (await win.webContents.getPrintersAsync()).map(toPrinterInfo);
      } finally {
        win.destroy();
      }
    },

    async print(html, { preferredName, widthPx }) {
      const win = await openReceiptWindow(html, widthPx);
      try {
        const printers = (await win.webContents.getPrintersAsync()).map(toPrinterInfo);
        const deviceName = pickPrinter(printers, preferredName);
        if (!deviceName)
          throw new AppError('CONFLICT', 'Printer topilmadi', { reason: 'NO_PRINTER' });

        // Page as long as the receipt (80 mm wide): no metre of blank paper after it.
        const heightMicrons = Math.ceil((await contentHeight(win)) * MICRONS_PER_PX) + 5_000;
        const printed = new Promise<PrintResult>((resolve, reject) => {
          win.webContents.print(
            {
              silent: true,
              deviceName,
              printBackground: true,
              color: false,
              landscape: false,
              margins: { marginType: 'none' },
              pageSize: { width: 80_000, height: heightMicrons },
            },
            (success, failureReason) => {
              if (success) resolve({ printer: deviceName });
              else
                reject(
                  new AppError('CONFLICT', `Chop etib bo'lmadi: ${failureReason}`, {
                    reason: 'PRINT_FAILED',
                    printer: deviceName,
                  }),
                );
            },
          );
        });
        return await withTimeout(printed, PRINT_TIMEOUT_MS, () => undefined);
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    },

    async preview(html, widthPx) {
      const win = await openReceiptWindow(html, widthPx);
      try {
        const height = await contentHeight(win);
        win.setContentSize(Math.round(widthPx), height);
        await new Promise((r) => setTimeout(r, 150)); // let the hidden frame repaint at the new size
        const image = await win.webContents.capturePage(undefined, { stayHidden: true });
        return image.toDataURL();
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    },
  };
}
