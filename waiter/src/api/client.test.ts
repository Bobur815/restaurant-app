import { WAITER_PROTOCOL } from '@shared/lan-waiter';
import type { AppEvent } from '@shared/ipc';
import { WaiterClient, type LinkStatus } from './client';
import type { Credential } from './credential';
import { ApiError } from './errors';
import type { SseOptions } from './sse';

const cred: Credential = {
  hosts: ['192.168.1.10'],
  port: 5180,
  deviceId: 7,
  secret: 'b'.repeat(64),
  lineage: 'lineage-A',
  restaurantName: 'Oqtepa Lavash',
  tillVersion: '0.13.0',
  pairedAt: '2026-11-22T00:00:00.000Z',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const states: LinkStatus['state'][] = [];
  const events: AppEvent[] = [];
  const signedOut = jest.fn();
  const requests: { url: string; init?: RequestInit }[] = [];
  let sse: SseOptions | null = null;
  const client = new WaiterClient({
    credential: cred,
    onStatus: (s) => states.push(s.state),
    onEvent: (e) => events.push(e),
    onSignedOut: signedOut,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch,
    retryMs: [5, 5, 5, 5],
    openSseImpl: (o) => {
      sse = o;
      return { close: () => undefined };
    },
  });
  return { client, states, events, signedOut, requests, sse: () => sse };
}

describe('WaiterClient.rpc', () => {
  it('sends the device credential, then the session it was given', async () => {
    let n = 0;
    const t = setup(() => {
      n += 1;
      return n === 1
        ? json(200, { result: { ok: true, data: { id: 1, fullName: 'Dilshod' } }, session: 's1' })
        : json(200, { result: { ok: true, data: [] } });
    });
    await t.client.rpc('auth:pinLogin', { pin: '2222' });
    await t.client.rpc('halls:list');
    const h = (i: number) => t.requests[i]!.init!.headers as Record<string, string>;
    expect(h(0)['authorization']).toBe(`SavdoChef 7.${'b'.repeat(64)}`);
    expect(h(0)['x-session']).toBeUndefined();
    expect(h(1)['x-session']).toBe('s1');
    expect(JSON.parse(String(t.requests[0]!.init!.body))).toEqual({ channel: 'auth:pinLogin', input: { pin: '2222' } });
    expect(t.client.signedIn).toBe(true);
  });

  it("throws main's error with its code and Uzbek message", async () => {
    const t = setup(() =>
      json(200, { result: { ok: false, error: { code: 'CONFLICT', message: 'Yetarli emas', details: { shortages: [] } } } }),
    );
    await expect(t.client.rpc('halls:list')).rejects.toMatchObject({ code: 'CONFLICT', message: 'Yetarli emas' });
  });

  it('a forgotten session signs the waiter out', async () => {
    let n = 0;
    const t = setup(() => {
      n += 1;
      return n === 1
        ? json(200, { result: { ok: true, data: {} }, session: 's1' })
        : json(200, { result: { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Kiring' } }, session: null });
    });
    await t.client.rpc('auth:pinLogin', { pin: '2222' });
    await expect(t.client.rpc('halls:list')).rejects.toBeInstanceOf(ApiError);
    expect(t.signedOut).toHaveBeenCalledTimes(1);
    expect(t.client.signedIn).toBe(false);
  });

  it('401 unpairs the phone, 403 means the plan has no room for it, no answer is offline', async () => {
    const a = setup(() => json(401, { error: 'x' }));
    await expect(a.client.rpc('halls:list')).rejects.toMatchObject({ code: 'UNPAIRED' });
    expect(a.client.status.state).toBe('unpaired');
    // Once unpaired, nothing more is sent.
    await expect(a.client.rpc('halls:list')).rejects.toMatchObject({ code: 'UNPAIRED' });
    expect(a.requests).toHaveLength(1);

    const b = setup(() => json(403, { error: 'Tarifdagi telefonlar soni tugagan' }));
    await expect(b.client.rpc('halls:list')).rejects.toMatchObject({ code: 'LIMIT' });
    expect(b.client.status.state).toBe('limit');

    const c = setup(() => Promise.reject(new Error('network')));
    await expect(c.client.rpc('halls:list')).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(c.client.status.state).toBe('unreachable');
  });
});

describe('WaiterClient line', () => {
  it('online once our till (same lineage, same protocol) answers and the stream opens', async () => {
    const t = setup(() =>
      json(200, { lineage: 'lineage-A', version: '0.13.1', protocol: WAITER_PROTOCOL, restaurantName: 'Oqtepa' }),
    );
    t.client.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.sse()).not.toBeNull();
    t.sse()!.onOpen();
    expect(t.client.status).toMatchObject({ state: 'online', tillVersion: '0.13.1', restaurantName: 'Oqtepa' });
    // The screens reload what they show.
    expect(t.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['orders-changed', 'session-changed', 'menu-changed']),
    );
    t.sse()!.onData(JSON.stringify({ type: 'orders-changed', tableNumber: 4 }));
    t.sse()!.onData(JSON.stringify({ type: 'users-changed' })); // not a phone event: dropped
    expect(t.events.at(-1)).toEqual({ type: 'orders-changed', tableNumber: 4 });
    t.client.stop();
  });

  it('another restaurant or another protocol is not followed', async () => {
    const other = setup(() => json(200, { lineage: 'lineage-B', protocol: WAITER_PROTOCOL }));
    expect(await other.client.hello()).toBe(false);
    expect(other.client.status.state).toBe('superseded');

    const newer = setup(() => json(200, { lineage: 'lineage-A', protocol: WAITER_PROTOCOL + 1 }));
    expect(await newer.client.hello()).toBe(false);
    expect(newer.client.status.state).toBe('version');
    await expect(newer.client.rpc('halls:list')).rejects.toMatchObject({ details: { reason: 'VERSION' } });
  });
});
