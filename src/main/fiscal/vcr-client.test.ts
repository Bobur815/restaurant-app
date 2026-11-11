import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closedVcrUrl, startFakeVcr, type FakeVcr } from '../test-utils/fake-vcr';
import {
  describeVcrError,
  isEnvironmentError,
  nothingWasSent,
  VcrClient,
  VcrError,
} from './vcr-client';
import { cleanOfdUrl, isMasked, ofdLinkParts, scannedLinkMismatch } from './ofd-link';

jest.setTimeout(30_000);

let vcr: FakeVcr;
beforeAll(async () => {
  vcr = await startFakeVcr({ password: 'p' });
});
afterAll(() => vcr.close());

const client = (over: Partial<ConstructorParameters<typeof VcrClient>[0]> = {}) =>
  new VcrClient({ url: vcr.url, login: 'cassir', password: 'p', busyRetryMs: [5, 5], ...over });

describe('VCR client (F18)', () => {
  it('sends JSON-RPC with base64 login:password and returns the result', async () => {
    expect(await client().initialize()).toMatchObject({ TerminalID: expect.any(String) });
    const call = vcr.calls.at(-1)!;
    expect(call).toMatchObject({ method: 'Sys.Initialize', params: null });
    expect(call.auth).toBe(Buffer.from('cassir:p').toString('base64'));
  });

  it('an ok:false answer is a VcrError with VCR’s code', async () => {
    await expect(client({ password: 'bad' }).initialize()).rejects.toMatchObject({
      code: 705000,
      method: 'Sys.Initialize',
    });
  });

  it('busy (704042) is repeated a few times, then given up', async () => {
    vcr.failNext('Sys.GetOverflowInfo', 704042);
    expect(await client().overflowInfo()).toMatchObject({ AvaialableZReportCount: 500 });
    for (let i = 0; i < 3; i++) vcr.failNext('Sys.GetOverflowInfo', 704042);
    const e = await client()
      .overflowInfo()
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 704042 });
    expect(nothingWasSent(e)).toBe(true);
  });

  it('nothing listening: refused, so certainly not sent', async () => {
    const e = await new VcrClient({ url: await closedVcrUrl(), login: 'a', password: 'b' })
      .initialize()
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(VcrError);
    expect(e).toMatchObject({ code: 0, netCause: 'refused' });
    expect(nothingWasSent(e)).toBe(true);
    expect(isEnvironmentError(e)).toBe(true);
    expect(describeVcrError(e)).toContain("aloqa yo'q");
  });

  it('no answer in time: a timeout, which may have been registered', async () => {
    vcr.failNext('Sys.Initialize', 'hang');
    const e = await client({ timeoutMs: 300 })
      .initialize()
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 0, netCause: 'timeout' });
    expect(nothingWasSent(e)).toBe(false);
  });

  it('a data refusal is not an environment error', () => {
    expect(isEnvironmentError(new VcrError(705511, 'ИКПУ', 'Receipt.Sale'))).toBe(false);
    expect(isEnvironmentError(new VcrError(704016, 'printer', 'Receipt.Sale'))).toBe(true);
    expect(describeVcrError(new VcrError(701003, 'Ставка НДС не найдена', 'x'))).toContain('QQS');
  });
});

describe('redirects (F18 security review)', () => {
  it('a redirect is refused: the login and password never go to another host', async () => {
    let elsewhere = 0;
    const other = createServer((_req, res) => {
      elsewhere++;
      res.end('{}');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherPort = (other.address() as AddressInfo).port;
    const redirecting = createServer((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${otherPort}/` });
      res.end();
    });
    await new Promise<void>((r) => redirecting.listen(0, '127.0.0.1', r));
    const port = (redirecting.address() as AddressInfo).port;
    const e = await new VcrClient({
      url: `http://127.0.0.1:${port}/`,
      login: 'cassir',
      password: 'p',
    })
      .initialize()
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 0 });
    expect(elsewhere).toBe(0);
    await new Promise((r) => redirecting.close(r));
    await new Promise((r) => other.close(r));
  });
});

describe('OFD link', () => {
  const link = 'https://ofd.soliq.uz/check?t=VG1&r=583&c=20261111142642&s=848035748636';

  it('takes the link out of whatever came with it, and reads its parts', () => {
    expect(cleanOfdUrl(`  ${link}\u200b\r\n`)).toBe(link);
    expect(cleanOfdUrl('***')).toBeNull();
    expect(cleanOfdUrl('https://evil.example/check?t=1')).toBeNull();
    expect(isMasked('***')).toBe(true);
    expect(isMasked(link)).toBe(false);
    expect(ofdLinkParts(link)).toMatchObject({
      terminalId: 'VG1',
      receiptNo: '583',
      fiscalSign: '848035748636',
    });
    expect(ofdLinkParts(link).time).toEqual(new Date(2026, 10, 11, 14, 26, 42));
  });

  it('a scanned link must be of this check: its terminal and a time near ours', () => {
    const at = new Date(2026, 10, 11, 14, 27, 0);
    expect(scannedLinkMismatch(link, { terminalId: 'VG1', fiscalAt: at })).toBeNull();
    expect(scannedLinkMismatch(link, { terminalId: '***', fiscalAt: at })).toBeNull();
    expect(scannedLinkMismatch(link, { terminalId: 'VG2', fiscalAt: at })).toBe('terminal');
    expect(scannedLinkMismatch(link, { terminalId: 'VG1', fiscalAt: new Date(2026, 10, 12) })).toBe(
      'time',
    );
  });
});
