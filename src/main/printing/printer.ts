import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  print(html: string, options: { preferredName: string | null }): Promise<PrintResult>;
  /** PNG data URL of the document as the receipt printer would get it. */
  preview(html: string): Promise<string>;
}

/**
 * The receipt page is exactly the printable width of 80 mm roll paper: the XP-80/XP-80C driver's
 * forms are all "80(72.1) x ... mm", i.e. 72.1 mm wide. Chromium on Windows scales and centres
 * each page into the driver's paper, so a page wider than that (80 mm) or a document wider than
 * the page (the old 420 px body) came out shifted down and clipped at the right and bottom.
 * The receipt document (receipt.ts) lays itself out at RECEIPT_CONTENT_MM inside this page.
 */
export const RECEIPT_PAGE_MICRONS = 72_100;
const MICRONS_PER_PX = 25_400 / 96;
/** The page width in CSS px: the hidden window is this wide, so measuring matches printing. */
export const RECEIPT_PAGE_PX = Math.round(RECEIPT_PAGE_MICRONS / MICRONS_PER_PX);

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
 * The receipt window: hidden, sandboxed, no preload, no node.
 * It only ever loads the receipt document built in main (whose CSP allows no scripts).
 */
export function receiptWindowOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: RECEIPT_PAGE_PX,
    useContentSize: true,
    height: 1200,
    backgroundColor: '#ffffff',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Its own in-memory session: the receipt (a file:// document) shares no storage with the
      // main window.
      partition: 'receipt',
      spellcheck: false,
      // Main measures the page with executeJavaScript (not page script; the document's CSP
      // forbids scripts).
      javascript: true,
      // Never shown, but painted, so capturePage can render the preview.
      backgroundThrottling: false,
    },
  };
}

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

/**
 * Loads the receipt from a private temp file, not a data: URL: Chromium refuses URLs over 2 MB
 * (ERR_INVALID_URL), and a logo inlined as base64 easily gets there. The file is read once on
 * load, so it is removed right after.
 */
const RECEIPT_TMP_PREFIX = 'savdochef-receipt-';

/**
 * Removes receipt folders a crash left behind (they hold customer names and addresses). Start-up
 * housekeeping; never throws.
 */
export async function removeLeftoverReceiptFiles(): Promise<void> {
  try {
    const names = await readdir(tmpdir());
    await Promise.all(
      names
        .filter((n) => n.startsWith(RECEIPT_TMP_PREFIX))
        .map((n) => rm(join(tmpdir(), n), { recursive: true, force: true })),
    );
  } catch {
    // Housekeeping only.
  }
}

async function openReceiptWindow(html: string): Promise<BrowserWindow> {
  const win = new BrowserWindow(receiptWindowOptions());
  // Any attempt by the document to open or navigate anywhere is refused.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const dir = await mkdtemp(join(tmpdir(), RECEIPT_TMP_PREFIX));
  try {
    const file = join(dir, 'receipt.html');
    await writeFile(file, html, 'utf8');
    await win.loadFile(file);
    return win;
  } catch (err) {
    win.destroy();
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

    async print(html, { preferredName }) {
      const win = await openReceiptWindow(html);
      try {
        const printers = (await win.webContents.getPrintersAsync()).map(toPrinterInfo);
        const deviceName = pickPrinter(printers, preferredName);
        if (!deviceName)
          throw new AppError('CONFLICT', 'Printer topilmadi', { reason: 'NO_PRINTER' });

        // Page as wide as the paper's printable area and as long as the receipt (plus a little
        // for the cutter): no metre of blank paper after it, nothing for Chromium to scale.
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
              pageSize: { width: RECEIPT_PAGE_MICRONS, height: heightMicrons },
              // As the legacy app sent them: no driver-side scaling, the thermal head's dpi.
              scaleFactor: 100,
              dpi: { horizontal: 203, vertical: 203 },
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

    async preview(html) {
      const win = await openReceiptWindow(html);
      try {
        const height = await contentHeight(win);
        win.setContentSize(RECEIPT_PAGE_PX, height);
        await new Promise((r) => setTimeout(r, 150)); // let the hidden frame repaint at the new size
        const image = await win.webContents.capturePage(undefined, { stayHidden: true });
        return image.toDataURL();
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    },
  };
}
