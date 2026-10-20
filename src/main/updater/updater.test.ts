import { EventEmitter } from 'node:events';
import type { UpdateStatusDto } from '@shared/types';
import { createUpdater, updateErrorMessage, type UpdaterEngine } from './updater';

/** electron-updater's AppUpdater as far as updater.ts uses it; the test drives its events. */
class FakeEngine extends EventEmitter implements UpdaterEngine {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkForUpdates = jest.fn(async (): Promise<unknown> => null);
  downloadUpdate = jest.fn(async (): Promise<unknown> => []);
  quitAndInstall = jest.fn();
}

function setup(supported = true) {
  const engine = new FakeEngine();
  const changes: UpdateStatusDto[] = [];
  const order: string[] = [];
  const warnings: unknown[] = [];
  const updater = createUpdater({
    currentVersion: '0.1.0',
    supported,
    engine: () => engine,
    onChange: (s) => changes.push(s),
    beforeInstall: async () => {
      order.push('beforeInstall');
    },
    log: { info: () => undefined, warn: (_m, e) => warnings.push(e) },
    now: () => new Date('2026-10-20T10:00:00Z'),
  });
  engine.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'));
  return { engine, updater, changes, order, warnings };
}

describe('updater', () => {
  it('in a dev or unpacked run it is unsupported and never builds electron-updater', async () => {
    const engine = jest.fn();
    const updater = createUpdater({
      currentVersion: '0.1.0',
      supported: false,
      engine,
      onChange: () => undefined,
      beforeInstall: async () => undefined,
      log: { info: () => undefined, warn: () => undefined },
    });
    expect((await updater.check()).state).toBe('unsupported');
    expect(updater.download().state).toBe('unsupported');
    await updater.install();
    expect(engine).not.toHaveBeenCalled();
  });

  it('check -> available -> download with progress -> downloaded -> install', async () => {
    const { engine, updater, changes, order } = setup();
    engine.checkForUpdates.mockImplementation(async () => {
      engine.emit('update-available', { version: '0.2.0', releaseDate: '2026-10-19T00:00:00Z' });
      return null;
    });

    const checked = await updater.check();
    expect(engine.autoDownload).toBe(false);
    expect(engine.autoInstallOnAppQuit).toBe(false);
    expect(checked).toMatchObject({
      state: 'available',
      currentVersion: '0.1.0',
      version: '0.2.0',
      checkedAt: '2026-10-20T10:00:00.000Z',
    });

    expect(updater.download()).toMatchObject({ state: 'downloading', percent: 0 });
    const before = changes.length;
    engine.emit('download-progress', { percent: 10.2 });
    engine.emit('download-progress', { percent: 10.9 }); // same whole percent: no event
    engine.emit('download-progress', { percent: 55.5 });
    expect(changes.slice(before).map((s) => s.percent)).toEqual([10, 55]);

    // Nothing installs before the download is complete.
    await updater.install();
    expect(order).toEqual([]);

    engine.emit('update-downloaded', { version: '0.2.0' });
    expect(updater.status()).toMatchObject({ state: 'downloaded', percent: 100 });
    // A check now would only restart the cycle; it is ignored.
    await updater.check();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);

    await updater.install();
    expect(order).toEqual(['beforeInstall', 'quitAndInstall']);
    expect(engine.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('up to date: not-available, also when electron-updater answers without an event', async () => {
    const { engine, updater } = setup();
    engine.checkForUpdates.mockImplementationOnce(async () => {
      engine.emit('update-not-available');
      return null;
    });
    expect((await updater.check()).state).toBe('not-available');
    expect((await updater.check()).state).toBe('not-available');
    expect(updater.download().state).toBe('not-available'); // nothing to download
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
  });

  it('a failed check shows an Uzbek error; the quiet start-up check only logs it', async () => {
    const { engine, updater, warnings } = setup();
    const offline = Object.assign(new Error('getaddrinfo ENOTFOUND panel.posgro.uz'), {
      code: 'ENOTFOUND',
    });
    engine.checkForUpdates.mockRejectedValue(offline);

    expect((await updater.check({ quiet: true })).state).toBe('idle');
    expect(warnings).toEqual([offline]);

    expect(await updater.check()).toMatchObject({
      state: 'error',
      message: "Internetga ulanib bo'lmadi. Ulanishni tekshirib qayta urinib ko'ring",
    });
  });

  it('a failed download can be retried', async () => {
    const { engine, updater } = setup();
    engine.checkForUpdates.mockImplementation(async () => {
      engine.emit('update-available', { version: '0.2.0' });
      return null;
    });
    await updater.check();
    engine.downloadUpdate.mockRejectedValueOnce(new Error('sha512 checksum mismatch'));
    updater.download();
    await new Promise((r) => setImmediate(r));
    expect(updater.status()).toMatchObject({
      state: 'error',
      version: '0.2.0',
      message: "Yuklangan fayl buzilgan. Qayta yuklab ko'ring",
    });
    expect(updater.download().state).toBe('downloading');
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('maps errors to Uzbek messages', () => {
    expect(updateErrorMessage(new Error('HttpError: 404 Not Found'))).toBe(
      'Yangilanish serverda topilmadi',
    );
    expect(updateErrorMessage(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/Internet/);
    expect(updateErrorMessage(new Error('something odd'))).toBe(
      "Yangilanishni olib bo'lmadi. Qayta urinib ko'ring",
    );
  });
});
