import { WAITER_PROTOCOL, waiterPairingQrText } from '@shared/lan-waiter';
import { pair, parseAddress, parsePairingQr } from './pairing';

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const OK = {
  deviceId: 7,
  secret: 'a'.repeat(64),
  lineage: 'lineage-A',
  version: '0.13.0',
  kind: 'waiter',
  protocol: WAITER_PROTOCOL,
  restaurantName: 'Oqtepa Lavash',
};

describe('the till QR and the typed address', () => {
  it('reads the till QR and nothing else', () => {
    const text = waiterPairingQrText(['192.168.1.10', '10.0.0.5'], 5180, '482917');
    expect(parsePairingQr(text)).toEqual({ hosts: ['192.168.1.10', '10.0.0.5'], port: 5180, code: '482917' });
    expect(parsePairingQr('https://example.com')).toBeNull();
    expect(parsePairingQr(JSON.stringify({ app: 'other', v: 1, hosts: ['1.2.3.4'], port: 5180, code: '123456' }))).toBeNull();
  });

  it('takes an IPv4 address with or without the port', () => {
    expect(parseAddress('192.168.1.10')).toEqual({ host: '192.168.1.10', port: 5180 });
    expect(parseAddress(' 192.168.1.10 : 6000 ')).toEqual({ host: '192.168.1.10', port: 6000 });
    expect(parseAddress('192.168.1.300')).toBeNull();
    expect(parseAddress('kassa.local')).toBeNull();
    expect(parseAddress('192.168.1.10:80')).toBeNull();
    // Only the shop network: an internet address is never a till.
    expect(parseAddress('203.0.113.7')).toBeNull();
    expect(parseAddress('10.0.2.2')).toEqual({ host: '10.0.2.2', port: 5180 });
  });
});

describe('pair', () => {
  const target = { hosts: ['10.0.0.1', '192.168.1.10'], port: 5180, code: '482917' };

  it('asks each address until one answers and keeps that one first', async () => {
    const calls: string[] = [];
    const f = jest.fn((url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.startsWith('http://10.0.0.1')) return Promise.reject(new Error('unreachable'));
      expect(JSON.parse(String(init?.body))).toEqual({ code: '482917', name: 'Samsung A15', expect: 'waiter' });
      return reply(200, OK);
    }) as unknown as typeof fetch;
    const r = await pair(target, 'Samsung A15', f);
    expect(calls).toEqual(['http://10.0.0.1:5180/pair', 'http://192.168.1.10:5180/pair']);
    expect(r).toMatchObject({
      ok: true,
      credential: { hosts: ['192.168.1.10', '10.0.0.1'], port: 5180, deviceId: 7, lineage: 'lineage-A', restaurantName: 'Oqtepa Lavash' },
    });
  });

  it('maps each refusal to its card', async () => {
    const cases: [number, unknown, string][] = [
      [403, { error: "Kod noto'g'ri", reason: 'wrong' }, 'wrong'],
      [403, { error: '...', reason: 'expired' }, 'expired'],
      [429, { error: '...', reason: 'throttled' }, 'throttled'],
      [403, { error: '...', reason: 'kind' }, 'wrongKind'],
      [403, { error: '...', reason: 'plan' }, 'plan'],
      [409, { error: { code: 'CONFLICT', message: "Telefonlar soni to'lgan", details: { reason: 'DEVICE_LIMIT' } } }, 'limit'],
      [403, { error: 'Eski kassa xabari' }, 'other'],
    ];
    for (const [status, body, kind] of cases) {
      const r = await pair(target, 'x', (() => reply(status, body)) as unknown as typeof fetch);
      expect(r).toMatchObject({ ok: false, failure: { kind } });
    }
  });

  it('nobody answers: not found; another protocol: version', async () => {
    const down = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    expect(await pair(target, 'x', down)).toEqual({ ok: false, failure: { kind: 'notFound' } });
    const old = (() => reply(200, { ...OK, protocol: WAITER_PROTOCOL + 1 })) as unknown as typeof fetch;
    expect(await pair(target, 'x', old)).toEqual({ ok: false, failure: { kind: 'version' } });
    // A malformed answer is not stored (and does not leave the screen waiting).
    const odd = (() => reply(200, { ...OK, secret: 'not-hex' })) as unknown as typeof fetch;
    expect(await pair(target, 'x', odd)).toEqual({ ok: false, failure: { kind: 'version' } });
  });
});
