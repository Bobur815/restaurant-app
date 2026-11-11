import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * Feature F18: a stand-in for REGOS:VCR's JSON-RPC API on 127.0.0.1 (tests and the app harness).
 * It keeps a Z-report state and the receipts by `code`, like the device: a second Receipt.Sale
 * with a held code is refused (the uniqueness guard), Receipt.GetInfo {Code} finds one.
 *
 * `failNext(method, how)` makes the next call of a method fail: a VCR error code, `drop` (the
 * receipt is registered but the connection is cut before the answer: a lost answer), or `hang`
 * (no answer at all, for timeouts).
 */

export interface FakeReceipt {
  Id: string;
  Code: string;
  Amount: number;
  QRCodeURL: string;
  TerminalID: string;
  ReceiptNo: string;
  DateTime: string;
  FiscalSign: string;
  refunded: boolean;
  params: unknown;
}

type Failure = number | 'drop' | 'hang';

export interface FakeVcr {
  url: string;
  calls: Array<{ method: string; params: unknown; auth: string }>;
  receipts: FakeReceipt[];
  zOpen: boolean;
  zId: number;
  /** Answer `***` for the link, number and sign, as VCR does since 2026-10-30. */
  masked: boolean;
  /** The cassir password it accepts; anything else answers 705000. */
  password: string;
  failNext(method: string, how: Failure): void;
  methods(): string[];
  close(): Promise<void>;
}

export const FAKE_TERMINAL = 'VG000000000001';

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}
function stamp(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function startFakeVcr(
  opts: { login?: string; password?: string; masked?: boolean } = {},
): Promise<FakeVcr> {
  const failures = new Map<string, Failure[]>();
  const sockets = new Set<Socket>();
  let receiptNo = 100;
  const vcr: FakeVcr = {
    url: '',
    calls: [],
    receipts: [],
    zOpen: false,
    zId: 7,
    masked: opts.masked ?? false,
    password: opts.password ?? 'pass',
    failNext(method, how) {
      failures.set(method, [...(failures.get(method) ?? []), how]);
    },
    methods() {
      return vcr.calls.map((c) => c.method);
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
  const login = opts.login ?? 'cassir';

  const body = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let s = '';
      req.on('data', (c: Buffer) => (s += c.toString('utf8')));
      req.on('end', () => resolve(s));
    });

  const mask = (v: string) => (vcr.masked ? '***' : v);

  function handle(method: string, params: Record<string, unknown> | null): unknown {
    switch (method) {
      case 'Sys.Initialize':
        return { TerminalID: FAKE_TERMINAL, AppletVersion: '0400' };
      case 'Sys.GetOverflowInfo':
        return { AvaialableZReportCount: 500, AvaialableUnsendReceiptCount: 900 };
      case 'ZReport.GetInfo':
        return {
          TerminalID: FAKE_TERMINAL,
          Number: vcr.zId,
          Count: vcr.receipts.length,
          OpenTime: vcr.zOpen ? '2026-11-11 09:00:00' : '',
          CloseTime: vcr.zOpen ? '' : '2026-11-10 23:00:00',
          TotalSaleCount: vcr.receipts.length,
          TotalSaleCash: vcr.receipts.reduce((s, r) => s + r.Amount, 0),
          TotalSaleCard: 0,
          TotalSaleVat: 0,
          TotalRefundCount: vcr.receipts.filter((r) => r.refunded).length,
          TotalRefundCash: 0,
          TotalRefundCard: 0,
        };
      case 'ZReport.Open':
        if (vcr.zOpen) throw { error: 704011, description: 'Z-отчёт уже открыт' };
        vcr.zOpen = true;
        vcr.zId++;
        return { id: vcr.zId, open_time: '2026-11-11 09:00:00', close_time: null };
      case 'ZReport.Close':
        if (!vcr.zOpen) throw { error: 704010, description: 'Z-отчёт не открыт' };
        vcr.zOpen = false;
        return { id: vcr.zId, open_time: '', close_time: '' };
      case 'Receipt.Sale': {
        if (!vcr.zOpen) throw { error: 704010, description: 'Z-отчёт не открыт' };
        const p = params as {
          code: string;
          positions: Array<{ amount: number; icps: string }>;
          payments: Array<{ value: number }>;
        };
        if (vcr.receipts.some((r) => r.Code === p.code))
          throw { error: 701003, description: 'Чек с таким кодом уже существует' };
        if (p.positions.some((x) => !/^\d{17}$/.test(x.icps)))
          throw { error: 705511, description: 'ИКПУ не найден' };
        const amount = p.positions.reduce((s, x) => s + x.amount, 0);
        const paid = p.payments.reduce((s, x) => s + x.value, 0);
        if (Math.abs(amount - paid) > 5000)
          throw { error: 701003, description: 'Сумма оплаты не совпадает' };
        receiptNo++;
        const at = new Date();
        const sign = String(800000000000 + receiptNo);
        const r: FakeReceipt = {
          Id: `uuid-${receiptNo}`,
          Code: p.code,
          Amount: amount,
          QRCodeURL: `https://ofd.soliq.uz/check?t=${FAKE_TERMINAL}&r=${receiptNo}&c=${stamp(at)}&s=${sign}`,
          TerminalID: FAKE_TERMINAL,
          ReceiptNo: String(receiptNo),
          DateTime: at.toISOString(),
          FiscalSign: sign,
          refunded: false,
          params,
        };
        vcr.receipts.push(r);
        return view(r);
      }
      case 'Receipt.GetInfo': {
        const code = (params as { Code?: string }).Code;
        const r = vcr.receipts.find((x) => x.Code === code);
        if (!r) throw { error: 701003, description: 'Чек не найден' };
        return { ...view(r), Code: r.Code };
      }
      case 'Receipt.Duplicate': {
        const id = (params as { id?: string }).id;
        if (!vcr.receipts.some((x) => x.Id === id))
          throw { error: 701003, description: 'Чек не найден' };
        return null;
      }
      case 'Receipt.FullRefund': {
        const url = (params as { QRCodeURL?: string }).QRCodeURL;
        const r = vcr.receipts.find((x) => x.QRCodeURL === url);
        if (!r) throw { error: 701003, description: 'Чек продажи не найден' };
        if (r.refunded) throw { error: 701003, description: 'Чек уже возвращён' };
        r.refunded = true;
        receiptNo++;
        return {
          Id: `uuid-${receiptNo}`,
          Amount: r.Amount,
          QRCodeURL: mask(`https://ofd.soliq.uz/check?t=${FAKE_TERMINAL}&r=${receiptNo}`),
          TerminalID: FAKE_TERMINAL,
          ReceiptNo: mask(String(receiptNo)),
          DateTime: new Date().toISOString(),
          FiscalSign: mask(String(900000000000 + receiptNo)),
        };
      }
      default:
        throw { error: 703000, description: `Unknown method ${method}` };
    }
  }

  function view(r: FakeReceipt) {
    return {
      Id: r.Id,
      Amount: r.Amount,
      QRCodeURL: mask(r.QRCodeURL),
      TerminalID: r.TerminalID,
      ReceiptNo: mask(r.ReceiptNo),
      DateTime: r.DateTime,
      FiscalSign: mask(r.FiscalSign),
    };
  }

  const server: Server = createServer((req, res) => {
    void body(req).then((text) => {
      const msg = JSON.parse(text) as {
        id: number;
        method: string;
        params: Record<string, unknown> | null;
        auth: string;
      };
      vcr.calls.push({ method: msg.method, params: msg.params, auth: msg.auth });
      const reply = (ok: boolean, result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: msg.id, ok, result, jsonrpc: '2.0' }));
      };
      const queue = failures.get(msg.method);
      const fail = queue?.shift();
      if (fail === 'hang') return; // never answered
      if (typeof fail === 'number') return reply(false, { error: fail, description: 'fake' });
      if (Buffer.from(`${login}:${vcr.password}`).toString('base64') !== msg.auth)
        return reply(false, { error: 705000, description: 'Неверный логин или пароль' });
      try {
        const result = handle(msg.method, msg.params);
        // The device did it; the answer never arrives.
        if (fail === 'drop') return req.socket.destroy();
        reply(true, result);
      } catch (e) {
        reply(false, e);
      }
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  vcr.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return vcr;
}

/** A URL nothing listens on (a port just freed), for "VCR is not running". */
export async function closedVcrUrl(): Promise<string> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return `http://127.0.0.1:${port}/`;
}
