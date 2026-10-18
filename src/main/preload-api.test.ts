import { APP_EVENT_CHANNEL, IPC_CHANNELS, splitChannel } from '@shared/ipc';
import { HANDLERS } from './ipc/handlers';
import { createElectronApi, type IpcRendererLike } from './preload-api';

jest.mock('electron', () => ({}));

function fakeIpc() {
  const invoked: Array<[string, unknown[]]> = [];
  const listeners = new Map<string, Set<(e: unknown, ...a: unknown[]) => void>>();
  const ipc: IpcRendererLike = {
    invoke: async (channel, ...args) => {
      invoked.push([channel, args]);
      return { ok: true, data: channel };
    },
    on: (channel, l) => listeners.set(channel, (listeners.get(channel) ?? new Set()).add(l)),
    removeListener: (channel, l) => listeners.get(channel)?.delete(l),
  };
  const emit = (channel: string, payload: unknown) =>
    listeners.get(channel)?.forEach((l) => l({}, payload));
  return { ipc, invoked, listeners, emit };
}

describe('createElectronApi', () => {
  it('exposes exactly one function per channel, and the events object', () => {
    const api = createElectronApi(fakeIpc().ipc) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const exposed = Object.entries(api).flatMap(([ns, methods]) =>
      ns === 'events' ? [] : Object.keys(methods).map((m) => `${ns}:${m}`),
    );
    expect(exposed.sort()).toEqual([...IPC_CHANNELS].sort());
    expect(Object.keys(api['events']!)).toEqual(['subscribe']);
    // Nothing that could reach an arbitrary channel.
    expect(JSON.stringify(Object.keys(api))).not.toMatch(/invoke|send|ipcRenderer/);
  });

  it('every function invokes its own channel with a single argument', async () => {
    const { ipc, invoked } = fakeIpc();
    const api = createElectronApi(ipc) as unknown as Record<
      string,
      Record<string, (...args: unknown[]) => Promise<unknown>>
    >;
    for (const channel of IPC_CHANNELS) {
      const [ns, method] = splitChannel(channel);
      await api[ns]![method]!({ probe: channel }, 'extra-arg-is-dropped');
    }
    expect(invoked).toEqual(IPC_CHANNELS.map((c) => [c, [{ probe: c }]]));
  });

  it('subscribe forwards valid events only and unsubscribes cleanly (no listener leak)', () => {
    const { ipc, listeners, emit } = fakeIpc();
    const api = createElectronApi(ipc);
    const seen: unknown[] = [];
    const stop = api.events.subscribe((e) => seen.push(e));

    emit(APP_EVENT_CHANNEL, { type: 'menu-changed' });
    emit(APP_EVENT_CHANNEL, { type: 'something-else' });
    emit(APP_EVENT_CHANNEL, 'not an object');
    expect(seen).toEqual([{ type: 'menu-changed' }]);

    expect(listeners.get(APP_EVENT_CHANNEL)?.size).toBe(1);
    stop();
    stop(); // idempotent
    expect(listeners.get(APP_EVENT_CHANNEL)?.size).toBe(0);
    emit(APP_EVENT_CHANNEL, { type: 'menu-changed' });
    expect(seen).toHaveLength(1);
  });
});

describe('channel list', () => {
  it('main implements exactly the channels preload exposes', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...IPC_CHANNELS].sort());
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
  });
});
