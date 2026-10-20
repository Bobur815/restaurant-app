import { createUpdater, type UpdaterService } from '../updater/updater';

/** The updater as in a dev run: every call answers "unsupported" and touches nothing. */
export function unsupportedUpdater(): UpdaterService {
  return createUpdater({
    currentVersion: '0.0.0-test',
    supported: false,
    engine: () => {
      throw new Error('no updater in tests');
    },
    onChange: () => undefined,
    beforeInstall: async () => undefined,
    log: { info: () => undefined, warn: () => undefined },
  });
}
