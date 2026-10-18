import { ApiError, createApiClient, isApiError } from './api-client';
import type { ElectronAPI } from './ipc';

function fakeElectronApi(result: unknown): { api: ElectronAPI; calls: unknown[] } {
  const calls: unknown[] = [];
  const handler = {
    get: (_t: object, ns: string) =>
      ns === 'events'
        ? { subscribe: () => () => undefined }
        : new Proxy(
            {},
            {
              get: (_t2, method: string) => async (input: unknown) => {
                calls.push([`${ns}:${method}`, input]);
                return result;
              },
            },
          ),
  };
  return { api: new Proxy({}, handler) as ElectronAPI, calls };
}

describe('createApiClient', () => {
  it('returns data on success, passing the input through', async () => {
    const { api, calls } = fakeElectronApi({ ok: true, data: { id: 7 } });
    const client = createApiClient(api);
    await expect(client.menu.get({ id: 7 })).resolves.toEqual({ id: 7 });
    expect(calls).toEqual([['menu:get', { id: 7 }]]);
  });

  it('throws ApiError with code, message and details, and reports it to onError first', async () => {
    const error = { code: 'CONFLICT', message: 'Yetarli miqdor yo‘q', details: { shortages: [] } };
    const { api } = fakeElectronApi({ ok: false, error });
    const reported: ApiError[] = [];
    const client = createApiClient(api, { onError: (e) => reported.push(e) });

    const failure = await client.orders
      .save({ tableNumber: 1, lines: [] })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ channel: 'orders:save', ...error });
    expect(isApiError(failure, 'CONFLICT')).toBe(true);
    expect(isApiError(failure, 'FORBIDDEN')).toBe(false);
    expect(reported).toEqual([failure]);
  });

  it('calls without input work for channels that take none', async () => {
    const { api, calls } = fakeElectronApi({ ok: true, data: [] });
    await createApiClient(api).orders.busyTables();
    expect(calls).toEqual([['orders:busyTables', undefined]]);
  });
});
