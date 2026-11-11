import type { AppEvent } from '@shared/ipc';
import type { FiscalConfigInput } from '@shared/schemas';
import type {
  FiscalConfigDto,
  FiscalConnectionDto,
  FiscalRetryAllDto,
  FiscalStatusDto,
  FiscalZReportDto,
} from '@shared/types';
import { dec, toMoneyString } from '@shared/utils/decimal';
import { buildFiscalReceipt, FiscalReceiptError, toTiyin } from '@shared/utils/fiscal-receipt';
import type { Db } from '../domain/db';
import { isAllowedVcrHost } from '@shared/schemas';
import { conflict } from '../domain/errors';
import type { Cipher } from '../lan/config';
import {
  receiptCode,
  receiptCodePrefix,
  resolveFiscalConfig,
  saveFiscalConfig,
  toFiscalConfigDto,
  type ResolvedFiscalConfig,
} from './config';
import { countAwaiting, wasAttempted } from './order-status';
import { cleanOfdUrl, isMasked, ofdLinkParts, scannedLinkMismatch } from './ofd-link';
import {
  describeVcrError,
  ERR_Z_EMPTY,
  ERR_Z_NOT_OPEN,
  ERR_Z_NOT_OPEN_NEW,
  isEnvironmentError,
  nothingWasSent,
  VcrClient,
  VcrError,
  zIsOpen,
  type VcrReceiptResult,
  type VcrZReportInfo,
} from './vcr-client';

/**
 * Feature F18: fiscal receipts through REGOS:VCR on the main till (posgro regos-vcr-service.ts,
 * cut down to one restaurant till). The failure mode is "allow, fiscalise later": a payment
 * commits whatever VCR does; its order waits as PENDING and is sent here, after commit, in the
 * background (`kick`), at shift close, on "Qayta yuborish" and once after start.
 *
 * Never twice: every receipt carries `code` = SC-<database prefix>-<order number> (VCR's
 * idempotency key). An order sent before (an answer may have been lost) is first looked up by its
 * code and adopted when VCR holds it; an answer lost after Receipt.Sale is recovered the same way.
 * All VCR calls run one at a time (`exclusive`): VCR is single-threaded.
 *
 * Environment trouble (VCR off, busy, offline, printer or module missing) leaves the order PENDING
 * with the reason and costs no attempt; a refusal of the receipt's data (MXIK, VAT) makes it
 * FAILED and counts an attempt (only "Qayta yuborish" sends it again).
 */

export interface FiscalLog {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

export interface FiscalServiceOptions {
  getDb(): Db;
  cipher: Cipher;
  /** A development run only (SAVDOCHEF_VCR_URL): this URL instead of host and port. */
  urlOverride?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  busyRetryMs?: number[];
  posId?: string;
  onChange(events: AppEvent[]): void;
  log: FiscalLog;
}

export type SendOutcome = 'sent' | 'pending' | 'failed' | 'skipped';

const LABELS = {
  uz: { serviceFee: 'Xizmat haqi', deliveryFee: 'Yetkazib berish' },
  ru: { serviceFee: 'Обслуживание', deliveryFee: 'Доставка' },
} as const;

const NO_PASSWORD = 'VCR paroli kiritilmagan (Sozlamalar → Fiskal chek)';

export class FiscalService {
  private chain: Promise<unknown> = Promise.resolve();
  /** VCR's Z-report is known to be open (verified where it matters: 704010 reopens it). */
  private zOpenKnown = false;
  private readonly inFlight = new Map<number, number>();
  /** Checks being edited or deleted right now: not sent until that is done. */
  private readonly changing = new Set<number>();
  private kicking = false;
  private kickAgain = false;

  constructor(private readonly opts: FiscalServiceOptions) {}

  private get db(): Db {
    return this.opts.getDb();
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async config(): Promise<ResolvedFiscalConfig> {
    return resolveFiscalConfig(this.db, this.opts.cipher);
  }

  private clientFor(cfg: ResolvedFiscalConfig): VcrClient | null {
    if (!cfg.password) return null;
    // Checked again here: a stored value may not have come through the settings form.
    if (!this.opts.urlOverride && !isAllowedVcrHost(cfg.host)) {
      this.opts.log.error(`[fiscal] refusing VCR host ${JSON.stringify(cfg.host)}`);
      return null;
    }
    return new VcrClient({
      url: this.opts.urlOverride || `http://${cfg.host}:${cfg.port}/`,
      login: cfg.login,
      password: cfg.password,
      ...(this.opts.timeoutMs ? { timeoutMs: this.opts.timeoutMs } : {}),
      ...(this.opts.busyRetryMs ? { busyRetryMs: this.opts.busyRetryMs } : {}),
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
  }

  private async requireClient(): Promise<{ cfg: ResolvedFiscalConfig; client: VcrClient }> {
    const cfg = await this.config();
    if (!cfg.enabled)
      throw conflict("Fiskal chek sozlamalarda o'chirilgan", { reason: 'FISCAL_OFF' });
    const client = this.clientFor(cfg);
    if (!client) throw conflict(NO_PASSWORD, { reason: 'NO_PASSWORD' });
    return { cfg, client };
  }

  private changed(events: AppEvent[]): void {
    try {
      this.opts.onChange(events);
    } catch (e) {
      this.opts.log.warn('[fiscal] change broadcast failed', e);
    }
  }

  // ── settings ─────────────────────────────────────────────────────────────────────────────

  async getConfig(): Promise<FiscalConfigDto> {
    return toFiscalConfigDto(await this.config(), Boolean(this.opts.urlOverride));
  }

  async setConfig(input: FiscalConfigInput): Promise<FiscalConfigDto> {
    await this.db.$transaction((tx) => saveFiscalConfig(tx, this.opts.cipher, input));
    // Another VCR, or the same one switched off and on: ask it again.
    this.zOpenKnown = false;
    const dto = await this.getConfig();
    if (dto.enabled) await receiptCodePrefix(this.db);
    if (dto.enabled) this.kick();
    return dto;
  }

  async testConnection(): Promise<FiscalConnectionDto> {
    const cfg = await this.config();
    const client = this.clientFor(cfg);
    if (!client) throw conflict(NO_PASSWORD, { reason: 'NO_PASSWORD' });
    return this.exclusive(async () => {
      try {
        const info = await client.initialize();
        const overflow = await client.overflowInfo();
        return {
          terminalId: info.TerminalID,
          appletVersion: info.AppletVersion,
          freeZReports: overflow.AvaialableZReportCount,
          freeUnsentReceipts: overflow.AvaialableUnsendReceiptCount,
        };
      } catch (e) {
        throw conflict(describeVcrError(e), { reason: 'VCR' });
      }
    });
  }

  async status(): Promise<FiscalStatusDto> {
    const cfg = await this.config();
    return { enabled: cfg.enabled, ...(await countAwaiting(this.db)) };
  }

  // ── sending ──────────────────────────────────────────────────────────────────────────────

  /** Sends every PENDING order in the background; a kick while one runs runs once more after. */
  kick(): void {
    if (this.kicking) {
      this.kickAgain = true;
      return;
    }
    this.kicking = true;
    void (async () => {
      try {
        do {
          this.kickAgain = false;
          await this.sendWaiting(['PENDING']);
        } while (this.kickAgain);
      } catch (e) {
        this.opts.log.error('[fiscal] background send failed', e);
      } finally {
        this.kicking = false;
      }
    })();
  }

  /**
   * Sends the waiting orders, oldest first; stops at the first one VCR cannot take for reasons of
   * its own (the next would get the same answer).
   */
  async sendWaiting(
    statuses: Array<'PENDING'>,
    opts: { manual?: boolean } = {},
  ): Promise<FiscalRetryAllDto> {
    const result: FiscalRetryAllDto = { sent: 0, failed: 0, pending: 0 };
    const cfg = await this.config();
    if (!cfg.enabled) return result;
    const ids = await this.db.order.findMany({
      where: { fiscalStatus: { in: statuses }, status: 'completed' },
      select: { id: true },
      orderBy: { completedAt: 'asc' },
      take: 200,
    });
    for (const { id } of ids) {
      const outcome = await this.send(id, opts);
      if (outcome === 'sent') result.sent++;
      else if (outcome === 'failed') result.failed++;
      else if (outcome === 'pending') {
        result.pending++;
        break;
      }
    }
    return result;
  }

  /** Manual: everything waiting, FAILED ones included. */
  async retryAll(): Promise<FiscalRetryAllDto> {
    await this.requireClient();
    // A FAILED check gets one more try; it is FAILED again if VCR still refuses it.
    await this.db.order.updateMany({
      where: { fiscalStatus: 'FAILED', status: 'completed' },
      data: { fiscalStatus: 'PENDING' },
    });
    return this.sendWaiting(['PENDING'], { manual: true });
  }

  /** Manual "Qayta yuborish" for one check: a FAILED one gets its attempts back. */
  async retry(orderId: number): Promise<SendOutcome> {
    await this.requireClient();
    const o = await this.db.order.findUnique({
      where: { id: orderId },
      select: { fiscalStatus: true },
    });
    if (o?.fiscalStatus === 'FAILED') {
      await this.db.order.update({ where: { id: orderId }, data: { fiscalStatus: 'PENDING' } });
    } else if (o?.fiscalStatus !== 'PENDING') {
      throw conflict("Bu chekni VCR ga yuborib bo'lmaydi", { status: o?.fiscalStatus ?? null });
    }
    return this.send(orderId, { manual: true });
  }

  /** One order, queued behind every other VCR call. */
  async send(orderId: number, opts: { manual?: boolean } = {}): Promise<SendOutcome> {
    this.inFlight.set(orderId, (this.inFlight.get(orderId) ?? 0) + 1);
    try {
      return await this.exclusive(() => this.sendNow(orderId, opts.manual ?? false));
    } finally {
      const n = (this.inFlight.get(orderId) ?? 1) - 1;
      if (n > 0) this.inFlight.set(orderId, n);
      else this.inFlight.delete(orderId);
      this.changed([{ type: 'orders-changed', orderId }]);
    }
  }

  private async loadOrder(orderId: number) {
    return this.db.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            menuItem: { select: { nameUz: true, nameRu: true, mxik: true, packageCode: true } },
          },
          orderBy: { id: 'asc' },
        },
        payments: {
          orderBy: { id: 'asc' },
          include: { createdBy: { select: { fullName: true } } },
        },
      },
    });
  }

  private async sendNow(orderId: number, manual: boolean): Promise<SendOutcome> {
    const cfg = await this.config();
    if (!cfg.enabled) return 'skipped';
    const order = await this.loadOrder(orderId);
    if (!order || order.status !== 'completed') return 'skipped';
    if (order.fiscalStatus !== 'PENDING') return 'skipped';
    // A FAILED order is only sent by hand; PENDING ones that kept failing stop at MAX_ATTEMPTS.
    if (!manual && order.fiscalAttempts >= MAX_ATTEMPTS) return 'skipped';

    const client = this.clientFor(cfg);
    if (!client) {
      await this.markPending(orderId, NO_PASSWORD);
      return 'pending';
    }

    const receipt = await this.db.receiptSettings.findFirst({ select: { locale: true } });
    const lang = receipt?.locale === 'ru' ? 'ru' : 'uz';
    let built: ReturnType<typeof buildFiscalReceipt>;
    try {
      built = buildFiscalReceipt(
        {
          lines: order.items.map((i) => ({
            menuItemId: i.menuItemId,
            name: (lang === 'ru' && i.menuItem.nameRu) || i.menuItem.nameUz,
            mxik: i.menuItem.mxik,
            packageCode: i.menuItem.packageCode,
            totalPrice: i.totalPrice.toString(),
            stockQuantity: i.stockQuantity.toString(),
          })),
          serviceFee: order.serviceFee.toString(),
          deliveryFee: order.deliveryFee.toString(),
          payments: order.payments.map((p) => ({
            method: p.method as 'cash' | 'card' | 'click' | 'debt',
            amount: p.amount.toString(),
          })),
          labels: LABELS[lang],
        },
        cfg.codes,
      );
    } catch (e) {
      if (!(e instanceof FiscalReceiptError)) throw e;
      await this.markFailed(orderId, e.message);
      return 'failed';
    }
    const expected = toTiyin(order.totalAmount.toString());
    const code = receiptCode(await receiptCodePrefix(this.db), order.orderNumber);

    if (wasAttempted(order)) {
      try {
        const held = await this.lookup(client, code);
        if (held) {
          this.opts.log.info(
            `[fiscal] ${order.orderNumber} already on VCR (ReceiptNo ${held.ReceiptNo}), not sent again`,
          );
          return this.adopt(orderId, held, expected);
        }
      } catch (e) {
        await this.markPending(orderId, describeVcrError(e));
        return 'pending';
      }
    }
    // Its debt opened again (a voided repayment) after it was queued: it waits for the money.
    if (order.payments.some((p) => p.method === 'debt' && p.status === 'pending')) {
      await this.db.order.updateMany({
        where: { id: orderId, fiscalStatus: 'PENDING' },
        data: { fiscalStatus: 'DEFERRED_DEBT' },
      });
      return 'skipped';
    }
    // A check being edited or deleted right now waits until that is done (prisma review F18).
    if (this.changing.has(orderId)) return 'skipped';

    try {
      await this.ensureZOpen(client, order.sessionId);
      let result: VcrReceiptResult | null = null;
      for (let reopened = false; result === null; ) {
        try {
          result = await client.sale({
            positions: built.positions,
            payments: built.payments,
            code,
            cashier_name: order.payments[0]?.createdBy?.fullName ?? undefined,
            session_code: String(order.sessionId),
            pos_id: this.opts.posId ?? 'savdochef',
          });
        } catch (e) {
          const zClosed =
            e instanceof VcrError && (e.code === ERR_Z_NOT_OPEN || e.code === ERR_Z_NOT_OPEN_NEW);
          if (reopened || !zClosed) throw e;
          reopened = true;
          this.zOpenKnown = false;
          await this.ensureZOpen(client, order.sessionId, true);
        }
      }
      this.opts.log.info(
        `[fiscal] FISCALIZED ${order.orderNumber} -> ReceiptNo ${result.ReceiptNo}`,
      );
      return this.adopt(orderId, result, expected);
    } catch (e) {
      this.opts.log.error(`[fiscal] ${order.orderNumber} not fiscalised: ${describeVcrError(e)}`);
      if (e instanceof VcrError)
        this.opts.log.error(`[fiscal] raw VCR error [${e.code}] ${e.method}: ${e.description}`);
      // The receipt may be registered with only the answer lost, or this is a retry VCR refused as
      // a duplicate code: look it up before calling it failed.
      if (!nothingWasSent(e)) {
        const held = await this.lookup(client, code).catch(() => null);
        if (held) return this.adopt(orderId, held, expected);
      }
      if (isEnvironmentError(e)) {
        await this.markPending(orderId, describeVcrError(e));
        return 'pending';
      }
      await this.markFailed(orderId, describeVcrError(e));
      return 'failed';
    }
  }

  /** The receipt VCR holds under our code; null = none. Throws when VCR could not be asked. */
  private async lookup(client: VcrClient, code: string): Promise<VcrReceiptResult | null> {
    try {
      const r = await client.receiptByCode(code);
      return r && r.FiscalSign ? r : null;
    } catch (e) {
      if (isEnvironmentError(e)) throw e;
      return null; // VCR answered: it has no receipt with this code
    }
  }

  private async adopt(
    orderId: number,
    r: VcrReceiptResult,
    expectedTiyin: number,
  ): Promise<SendOutcome> {
    // A receipt under our code with another amount is not this check's (a restored database).
    if (typeof r.Amount === 'number' && r.Amount !== expectedTiyin) {
      await this.markFailed(
        orderId,
        `VCR da shu kod bilan boshqa summali chek bor (${toMoneyString(dec(r.Amount).dividedBy(100))})`,
      );
      return 'failed';
    }
    const write = () =>
      this.db.order.updateMany({
        where: { id: orderId, status: 'completed' },
        data: {
          fiscalStatus: 'FISCALIZED',
          fiscalError: null,
          fiscalReceiptId: r.Id ?? null,
          fiscalReceiptNo: r.ReceiptNo ?? null,
          fiscalSign: r.FiscalSign ?? null,
          fiscalQrUrl: r.QRCodeURL ?? null,
          fiscalTerminalId: r.TerminalID ?? null,
          fiscalAt: new Date(),
        },
      });
    let written: { count: number };
    try {
      written = await write();
    } catch (first) {
      this.opts.log.warn(`[fiscal] recording receipt ${r.ReceiptNo} failed, retrying`, first);
      // If this fails too the order stays PENDING with an attempt behind it: the next send finds
      // the receipt by its code instead of registering it again.
      written = await write();
    }
    if (written.count !== 1) {
      this.opts.log.error(
        `[fiscal] VCR registered receipt ${r.ReceiptNo} (sign ${r.FiscalSign}) for order ${orderId}, which is no longer a paid check: refund it in REGOS:VCR`,
      );
    }
    return 'sent';
  }

  private async markPending(orderId: number, error: string): Promise<void> {
    await this.db.order
      .update({ where: { id: orderId }, data: { fiscalStatus: 'PENDING', fiscalError: error } })
      .catch((e: unknown) => this.opts.log.error('[fiscal] status write failed', e));
  }

  private async markFailed(orderId: number, error: string): Promise<void> {
    await this.db.order
      .update({
        where: { id: orderId },
        data: { fiscalStatus: 'FAILED', fiscalError: error, fiscalAttempts: { increment: 1 } },
      })
      .catch((e: unknown) => this.opts.log.error('[fiscal] status write failed', e));
  }

  // ── corrections ──────────────────────────────────────────────────────────────────────────

  /**
   * Before a check's payments are edited or it is deleted: VCR must not hold a receipt for it that
   * we do not know about. Adopts one it holds (the check then reads FISCALIZED) and says so.
   */
  async verifyBeforeChange(orderId: number): Promise<'clear' | 'fiscal'> {
    if (this.inFlight.has(orderId))
      throw conflict("Chek hozir VCR ga yuborilmoqda. Biroz kutib, qayta urinib ko'ring", {
        reason: 'FISCAL_BUSY',
      });
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (
      !order?.fiscalStatus ||
      order.fiscalStatus === 'FISCALIZED' ||
      order.fiscalStatus === 'REFUNDED'
    )
      return order?.fiscalStatus === 'FISCALIZED' ? 'fiscal' : 'clear';
    if (!wasAttempted(order)) return 'clear';
    const cfg = await this.config();
    // Switched off: there is no VCR to ask, and refusing would make the check unchangeable.
    if (!cfg.enabled) return 'clear';
    const client = this.clientFor(cfg);
    const unverified = () =>
      conflict("VCR bilan aloqa yo'q: chek VCR da bor-yo'qligini tekshirib bo'lmadi", {
        reason: 'FISCAL_UNVERIFIED',
      });
    if (!client) throw unverified();
    const code = receiptCode(await receiptCodePrefix(this.db), order.orderNumber);
    return this.exclusive(async () => {
      let held: VcrReceiptResult | null;
      try {
        held = await this.lookup(client, code);
      } catch {
        throw unverified();
      }
      if (!held) return 'clear';
      await this.adopt(orderId, held, toTiyin(order.totalAmount.toString()));
      this.changed([{ type: 'orders-changed', orderId }]);
      return 'fiscal';
    });
  }

  /**
   * Runs a check edit or delete with the check held: no receipt for it is sent meanwhile, and a
   * send already queued or running makes the change wait (verifyBeforeChange refuses it).
   */
  async whileChanging<T>(orderNumber: string, fn: () => Promise<T>): Promise<T> {
    const o = await this.db.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!o) return fn();
    if (this.changing.has(o.id))
      throw conflict("Chek hozir o'zgartirilmoqda. Biroz kutib, qayta urinib ko'ring", {
        reason: 'FISCAL_BUSY',
      });
    this.changing.add(o.id);
    try {
      return await fn();
    } finally {
      this.changing.delete(o.id);
    }
  }

  /** `checks:update`: refused when VCR holds the check's receipt. */
  async beforeEdit(orderNumber: string): Promise<void> {
    const order = await this.db.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!order) return;
    if ((await this.verifyBeforeChange(order.id)) === 'fiscal') {
      throw conflict("Chek VCR da ro'yxatdan o'tgan: to'lov usullarini o'zgartirib bo'lmaydi", {
        reason: 'FISCALIZED',
      });
    }
  }

  /**
   * `checks:delete`: a fiscalised check gets its refund receipt first (Receipt.FullRefund by its OFD
   * link). VCR 2026-10-30 answers "***" for the link: then the link scanned off the paper receipt
   * is used, once it is checked to be this check's (its terminal and time).
   */
  async beforeDelete(orderNumber: string, scannedQr?: string): Promise<void> {
    const found = await this.db.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!found) return;
    if ((await this.verifyBeforeChange(found.id)) !== 'fiscal') return;
    const order = await this.db.order.findUnique({ where: { id: found.id } });
    if (!order || order.fiscalStatus !== 'FISCALIZED') return;

    const { client } = await this.requireClient().catch(() => {
      throw conflict('Fiskal chekni qaytarish uchun VCR sozlanmagan yoki o‘chirilgan', {
        reason: 'FISCAL_OFF',
      });
    });
    const stored = isMasked(order.fiscalQrUrl) ? null : cleanOfdUrl(order.fiscalQrUrl);
    let link = stored;
    let fromScan = false;
    if (!link) {
      const scanned = cleanOfdUrl(scannedQr);
      if (!scanned)
        throw conflict("Qog'oz chekdagi QR kodni skanerlang", { reason: 'RECEIPT_QR_NEEDED' });
      const mismatch = scannedLinkMismatch(scanned, {
        terminalId: order.fiscalTerminalId,
        fiscalAt: order.fiscalAt,
      });
      if (mismatch) {
        throw conflict("Bu QR kod boshqa chekniki. Shu chekning qog'ozidagi QR kodni skanerlang", {
          reason: 'RECEIPT_QR_OTHER',
          mismatch,
        });
      }
      link = scanned;
      fromScan = true;
    }
    await this.exclusive(async () => {
      let refund: VcrReceiptResult;
      try {
        refund = await client.fullRefund(link);
      } catch (e) {
        this.opts.log.error(`[fiscal] refund of ${orderNumber} failed: ${describeVcrError(e)}`);
        throw conflict(`Fiskal chek qaytarilmadi: ${describeVcrError(e)}`, { reason: 'VCR' });
      }
      const parts = fromScan ? ofdLinkParts(link) : null;
      // Logged before the write: if both writes fail, the refund can still be matched by hand.
      this.opts.log.info(`[fiscal] VCR refunded ${orderNumber}: refund sign ${refund.FiscalSign}`);
      const record = () =>
        this.db.order.update({
          where: { id: order.id },
          data: {
            fiscalStatus: 'REFUNDED',
            fiscalRefundSign: refund.FiscalSign ?? null,
            fiscalRefundedAt: new Date(),
            ...(parts
              ? {
                  fiscalQrUrl: link,
                  fiscalReceiptNo: parts.receiptNo,
                  fiscalSign: parts.fiscalSign,
                  fiscalTerminalId: parts.terminalId,
                }
              : {}),
          },
        });
      try {
        await record();
      } catch (first) {
        this.opts.log.warn(
          `[fiscal] recording the refund of ${orderNumber} failed, retrying`,
          first,
        );
        try {
          await record();
        } catch (e) {
          this.opts.log.error(
            `[fiscal] ✗ ${orderNumber} is refunded on VCR (sign ${refund.FiscalSign}) but not recorded`,
            e,
          );
          throw conflict(
            "Fiskal chek qaytarildi, lekin yozib bo'lmadi. Qayta urinmang, administratorga ayting",
            {
              reason: 'REFUND_NOT_RECORDED',
            },
          );
        }
      }
    });
    this.changed([{ type: 'orders-changed', orderId: order.id }]);
  }

  /** A fiscal copy printed by VCR. */
  async duplicate(orderId: number): Promise<void> {
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (order?.fiscalStatus !== 'FISCALIZED' || !order.fiscalReceiptId)
      throw conflict('Chek fiskal emas', { reason: 'NOT_FISCAL' });
    const { client } = await this.requireClient();
    const id = order.fiscalReceiptId;
    await this.exclusive(async () => {
      try {
        await client.duplicate(id);
      } catch (e) {
        throw conflict(describeVcrError(e), { reason: 'VCR' });
      }
    });
  }

  // ── Z-report (follows the shift: decided 2026-11-11, Q4) ──────────────────────────────────

  private async ensureZOpen(
    client: VcrClient,
    sessionId: number | null,
    force = false,
  ): Promise<void> {
    if (this.zOpenKnown && !force) return;
    const info = await client.zInfo();
    if (!zIsOpen(info)) {
      const z = await client.zOpen();
      if (sessionId !== null) {
        await this.db.session
          .update({ where: { id: sessionId }, data: { fiscalZReportId: z.id } })
          .catch(() => undefined);
      }
      this.opts.log.info(`[fiscal] Z-report ${z.id} opened`);
    }
    this.zOpenKnown = true;
  }

  /** After a shift opened: VCR's Z-report too, in the background. Never fails the shift. */
  afterShiftOpen(sessionId: number): void {
    void (async () => {
      const cfg = await this.config();
      const client = cfg.enabled ? this.clientFor(cfg) : null;
      if (!client) return;
      await this.exclusive(() => this.ensureZOpen(client, sessionId, true));
      this.changed([{ type: 'session-changed' }]);
    })().catch((e: unknown) =>
      this.opts.log.warn(`[fiscal] Z-report not opened with the shift: ${describeVcrError(e)}`),
    );
  }

  /**
   * After a shift closed: the waiting receipts first, then VCR's Z-report. Never throws; what went
   * wrong comes back for the close dialog (the shift is closed either way).
   */
  async afterShiftClose(sessionId: number): Promise<string | null> {
    const cfg = await this.config();
    if (!cfg.enabled) return null;
    const client = this.clientFor(cfg);
    if (!client) return NO_PASSWORD;
    const problems: string[] = [];
    try {
      await this.sendWaiting(['PENDING']);
      const left = await countAwaiting(this.db);
      if (left.pending + left.failed > 0) {
        problems.push(
          `${left.pending + left.failed} ta chek VCR ga yuborilmadi (Cheklar → Fiskal emas)`,
        );
      }
    } catch (e) {
      problems.push(describeVcrError(e));
    }
    try {
      await this.exclusive(async () => {
        this.zOpenKnown = false;
        try {
          await client.zClose();
        } catch (e) {
          if (!(e instanceof VcrError && e.code === ERR_Z_EMPTY)) throw e;
        }
        await this.db.session.update({
          where: { id: sessionId },
          data: { fiscalZClosedAt: new Date() },
        });
      });
    } catch (e) {
      this.opts.log.error(
        `[fiscal] Z-report not closed with shift ${sessionId}: ${describeVcrError(e)}`,
      );
      problems.push(`Z-hisobot yopilmadi: ${describeVcrError(e)}`);
    }
    this.changed([{ type: 'session-changed' }]);
    return problems.length ? problems.join('. ') : null;
  }

  async zReport(): Promise<FiscalZReportDto | null> {
    const cfg = await this.config();
    if (!cfg.enabled) return null;
    const { client } = await this.requireClient();
    return this.exclusive(async () => {
      try {
        const info = await client.zInfo();
        this.zOpenKnown = zIsOpen(info);
        return toZDto(info);
      } catch (e) {
        throw conflict(describeVcrError(e), { reason: 'VCR' });
      }
    });
  }

  async zOpen(): Promise<FiscalZReportDto> {
    const { client } = await this.requireClient();
    const open = await this.db.session.findFirst({
      where: { status: 'open' },
      select: { id: true },
    });
    return this.exclusive(async () => {
      try {
        await this.ensureZOpen(client, open?.id ?? null, true);
        return toZDto(await client.zInfo());
      } catch (e) {
        throw conflict(describeVcrError(e), { reason: 'VCR' });
      }
    });
  }

  async zClose(): Promise<FiscalZReportDto> {
    const { client } = await this.requireClient();
    return this.exclusive(async () => {
      this.zOpenKnown = false;
      try {
        try {
          await client.zClose();
        } catch (e) {
          if (!(e instanceof VcrError && e.code === ERR_Z_EMPTY)) throw e;
        }
        return toZDto(await client.zInfo());
      } catch (e) {
        throw conflict(describeVcrError(e), { reason: 'VCR' });
      }
    });
  }

  /** After start: receipts left waiting by the last run go out, if a shift is open. */
  start(): void {
    void (async () => {
      const cfg = await this.config();
      if (!cfg.enabled) return;
      this.opts.log.info(
        `[fiscal] on: ${this.opts.urlOverride ? 'override URL' : `${cfg.host}:${cfg.port}`}, password ${cfg.password ? 'set' : 'MISSING'}`,
      );
      const open = await this.db.session.findFirst({
        where: { status: 'open' },
        select: { id: true },
      });
      if (open) this.kick();
    })().catch((e: unknown) => this.opts.log.warn('[fiscal] start failed', e));
  }
}

const MAX_ATTEMPTS = 5;

const soM = (tiyin: number) => toMoneyString(dec(tiyin || 0).dividedBy(100));

function toZDto(z: VcrZReportInfo): FiscalZReportDto {
  return {
    open: zIsOpen(z),
    terminalId: z.TerminalID ?? '',
    number: z.Number ?? 0,
    openTime: z.OpenTime ?? '',
    closeTime: z.CloseTime ?? '',
    saleCount: z.TotalSaleCount ?? 0,
    saleCash: soM(z.TotalSaleCash),
    saleCard: soM(z.TotalSaleCard),
    refundCount: z.TotalRefundCount ?? 0,
    refundCash: soM(z.TotalRefundCash),
    refundCard: soM(z.TotalRefundCard),
  };
}
