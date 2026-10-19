import { app } from 'electron';
import log from 'electron-log/main';
import path from 'path';

/**
 * Main-process log: `<logs>/main.log` (on Windows `%APPDATA%\SavdoChef\logs`), rotated at 5 MB
 * to `main.old.log`. Legacy wrote winston logs to `process.cwd()/utils/errors.log`, which is not
 * writable in an installed app.
 *
 * Deliberately not `log.initialize()`: that opens an IPC channel for renderer logging, and the
 * page gets nothing beyond window.electronAPI. Never log request inputs (they can hold passwords
 * or PINs); ipcSafe logs only unexpected errors.
 */
export function initLogger(): void {
  log.transports.file.resolvePathFn = () => path.join(app.getPath('logs'), 'main.log');
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = 'info';
  log.transports.console.level = app.isPackaged ? false : 'debug';

  // Anything that escapes a handler: log it instead of letting the process die silently.
  log.errorHandler.startCatching({ showDialog: false });

  app.on('render-process-gone', (_e, _wc, details) =>
    log.error('[renderer] process gone', details),
  );
  app.on('child-process-gone', (_e, details) => log.error('[child] process gone', details));

  log.info(`[app] SavdoChef ${app.getVersion()} starting (${app.isPackaged ? 'packaged' : 'dev'})`);
}

export const logger = log;
