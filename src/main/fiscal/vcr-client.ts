import type { VcrPayment, VcrPosition } from '@shared/utils/fiscal-receipt';

/**
 * Feature F18: the REGOS:VCR JSON-RPC client (posgro src/main/fiscal/regos-vcr-client.ts, trimmed
 * to what a restaurant till uses: Sys, ZReport, Receipt.Sale / GetInfo / Duplicate / FullRefund /
 * CheckQRcodeUrl). VCR is single-threaded: callers wait for each answer (FiscalService queues).
 * Electron-free (global fetch, injectable), so tests run it against a local fake VCR.
 */

export interface VcrReceiptResult {
  Id: string;
  Amount: number;
  QRCodeURL: string;
  TerminalID: string;
  ReceiptNo: string;
  DateTime: string;
  FiscalSign: string;
}

export interface VcrSysInfo {
  TerminalID: string;
  AppletVersion: string;
  ReceiptCount?: number;
  ZReportCount?: number;
}

export interface VcrOverflowInfo {
  // REGOS's own spelling.
  AvaialableZReportCount: number;
  AvaialableUnsendReceiptCount: number;
}

export interface VcrZReportInfo {
  TerminalID: string;
  Number: number;
  Count: number;
  OpenTime: string;
  CloseTime: string;
  TotalSaleCount: number;
  TotalSaleCash: number;
  TotalSaleCard: number;
  TotalSaleVat: number;
  TotalRefundCount: number;
  TotalRefundCash: number;
  TotalRefundCard: number;
}

/**
 * Why a request got no answer (code 0). Only `refused` proves the device received nothing: after a
 * timeout or a reset the receipt may be registered with only the answer lost.
 */
export type VcrNetCause = 'refused' | 'timeout' | 'reset' | 'other';

export class VcrError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly method: string,
    readonly netCause?: VcrNetCause,
  ) {
    super(`VCR [${code}] ${method}: ${description}`);
    this.name = 'VcrError';
  }
}

export const ERR_BUSY = 704042;
export const ERR_OFD_RESYNC = 704041;
export const ERR_Z_NOT_OPEN = 704010;
export const ERR_Z_NOT_OPEN_NEW = 704101;
export const ERR_Z_EMPTY = 704020;
const BUSY = new Set([ERR_BUSY, ERR_OFD_RESYNC]);
/** About the device's surroundings, not the receipt: they clear up and the receipt is resent. */
const ENVIRONMENT = new Set([...BUSY, 704001, 704002, 704016, 704017, 705002, 705020]);

export function isEnvironmentError(e: unknown): boolean {
  return e instanceof VcrError && (e.code === 0 || ENVIRONMENT.has(e.code));
}

/** True only when the device certainly never saw the request. */
export function nothingWasSent(e: unknown): boolean {
  return e instanceof VcrError && ((e.code === 0 && e.netCause === 'refused') || BUSY.has(e.code));
}

const RESET = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']);

/** Classifies a fetch failure (see posgro networkCause). */
export function networkCause(e: unknown): VcrNetCause {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const cause = (e as { cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } } | null)
    ?.cause;
  const inner = cause?.errors ?? [];
  if (cause?.code === 'ECONNREFUSED') return 'refused';
  if (inner.length > 0 && inner.every((x) => x?.code === 'ECONNREFUSED')) return 'refused';
  if (typeof cause?.code === 'string' && RESET.has(cause.code)) return 'reset';
  return 'other';
}

export interface VcrClientOptions {
  url: string;
  login: string;
  password: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Pauses before repeating a request VCR refused as busy (704042). Tests shorten them. */
  busyRetryMs?: number[];
}

export class VcrClient {
  private requestId = 1;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: VcrClientOptions) {
    this.auth = Buffer.from(`${opts.login}:${opts.password}`).toString('base64');
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, params: unknown = null): Promise<T> {
    const delays = this.opts.busyRetryMs ?? [1_000, 2_000, 4_000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce<T>(method, params);
      } catch (e) {
        const delay = delays[attempt];
        if (!(e instanceof VcrError && e.code === ERR_BUSY) || delay === undefined) throw e;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async callOnce<T>(method: string, params: unknown): Promise<T> {
    const id = this.requestId++;
    let res: Response;
    try {
      res = await this.fetchFn(this.opts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify({ id, jsonrpc: '2.0', method, params, auth: this.auth }),
        // VCR never redirects; following one would send the login and password to another host.
        redirect: 'error',
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new VcrError(
        0,
        e instanceof Error ? e.message : 'VCR unreachable',
        method,
        networkCause(e),
      );
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      // The device had the request; only its answer was cut off.
      const cause = networkCause(e);
      throw new VcrError(0, 'VCR answer lost', method, cause === 'other' ? 'reset' : cause);
    }
    let data: { ok?: boolean; result?: unknown };
    try {
      data = JSON.parse(text) as { ok?: boolean; result?: unknown };
    } catch {
      throw new VcrError(res.status, `Non-JSON response: ${text.slice(0, 200)}`, method);
    }
    if (!data.ok) {
      const err = data.result as { error?: number; description?: string } | undefined;
      throw new VcrError(err?.error ?? -1, err?.description ?? 'Unknown VCR error', method);
    }
    return data.result as T;
  }

  initialize() {
    return this.call<VcrSysInfo>('Sys.Initialize');
  }
  overflowInfo() {
    return this.call<VcrOverflowInfo>('Sys.GetOverflowInfo');
  }
  zOpen() {
    return this.call<{ id: number; open_time: string }>('ZReport.Open');
  }
  zClose() {
    return this.call<{ id: number; open_time: string; close_time: string }>('ZReport.Close');
  }
  zInfo() {
    return this.call<VcrZReportInfo>('ZReport.GetInfo', { PrintReceipt: false });
  }
  sale(params: {
    positions: VcrPosition[];
    payments: VcrPayment[];
    code: string;
    cashier_name?: string;
    session_code?: string;
    pos_id?: string;
  }) {
    return this.call<VcrReceiptResult>('Receipt.Sale', params);
  }
  receiptByCode(code: string) {
    return this.call<(VcrReceiptResult & { Code?: string }) | null>('Receipt.GetInfo', {
      Code: code,
    });
  }
  duplicate(id: string) {
    return this.call<null>('Receipt.Duplicate', { id });
  }
  fullRefund(qrCodeUrl: string) {
    return this.call<VcrReceiptResult>('Receipt.FullRefund', { QRCodeURL: qrCodeUrl });
  }
}

/** True when a Z-report answer says it is open. */
export function zIsOpen(info: Pick<VcrZReportInfo, 'OpenTime' | 'CloseTime'>): boolean {
  return Boolean(info.OpenTime?.trim()) && !info.CloseTime?.trim();
}

/** Uzbek text for a VCR error, shown to staff (codes from the REGOS guide). */
export function describeVcrError(e: unknown): string {
  if (!(e instanceof VcrError)) return e instanceof Error ? e.message : String(e);
  const d = e.description || '';
  if (e.code === 0) return "REGOS:VCR bilan aloqa yo'q. Dastur ishga tushirilganini tekshiring";
  if (/Ставка НДС/i.test(d)) return "QQS stavkasi noto'g'ri (sozlamalardagi QQS turini tekshiring)";
  if (/ИКПУ|МХИК|icps/i.test(d)) return `MXIK kodi noto'g'ri: ${d}`;
  const text = VCR_ERRORS[e.code];
  return text ? `${text} [${e.code}]` : `VCR xatosi [${e.code}]: ${d}`;
}

const VCR_ERRORS: Record<number, string> = {
  701003: "Chek ma'lumotlari noto'g'ri (MXIK, QQS, summa)",
  703003: "VCR: so'rov juda katta",
  703004: "VCR so'rovni o'qib ulgurmadi, qayta urinib ko'ring",
  704001: 'Sinxronlanmagan cheklar chegarasiga yetildi. Internetni tekshiring',
  704002: "OFD bilan sinxronlash yo'q. Internetni tekshiring",
  704006: 'Fiskal modul bloklangan. TXKMga murojaat qiling',
  704010: 'Z-hisobot ochilmagan',
  704011: 'Z-hisobot allaqachon ochiq',
  704016: 'VCR printeri topilmadi. Printerni ulang',
  704017: 'Fiskal modul topilmadi. USB ni ulang',
  704019: "Kassa bloklangan: 24 soat vaqt serveri bilan aloqa bo'lmadi. Internetni tekshiring",
  704020: "Z-hisobot bo'sh",
  704025: "Kassa bloklangan: litsenziya serveri bilan aloqa bo'lmadi. Internetni tekshiring",
  704029: 'Kassa bloklangan: qarzdorlik bor. TXKMga murojaat qiling',
  704041: "VCR cheklarni OFDga yubormoqda, 30 soniyadan keyin qayta urinib ko'ring",
  704042: 'VCR boshqa amal bilan band',
  704100: 'Smena allaqachon ochiq',
  704101: "Ochiq smena yo'q",
  705000: "VCR: login yoki parol noto'g'ri",
  705002: 'VCR da printer sozlanmagan',
  705020: "VCR printerini ulang va qog'oz soling",
  705511: "MXIK kodi noto'g'ri",
};
