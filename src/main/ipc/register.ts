import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { APP_EVENT_CHANNEL, IPC_CHANNELS, type AppEvent } from '@shared/ipc';
import type { Actor, Db } from '../domain/db';
import { imageDataUrl, importImage } from '../images/image-store';
import { logger } from '../logger';
import { createPrinterService } from '../printing/printer';
import type { UpdaterService } from '../updater/updater';
import type { LicenseService } from '../license/license-service';
import { eventsFor } from './events';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext, type HandlerServices } from './ipc-safe';

/**
 * Logged-in user per window (webContents). Each window logs in on its own and loses its login
 * when it closes. The LAN adapter (Phase 8.5) will key the same thing by device token.
 */
const actors = new Map<number, Actor>();
const printer = createPrinterService();
const tracked = new WeakSet<WebContents>();

function actorStoreFor(sender: WebContents) {
  if (!tracked.has(sender)) {
    tracked.add(sender);
    sender.once('destroyed', () => actors.delete(sender.id));
  }
  return {
    actor: actors.get(sender.id) ?? null,
    setActor: (actor: Actor | null) => {
      if (actor) actors.set(sender.id, actor);
      else actors.delete(sender.id);
    },
  };
}

function servicesFor(
  sender: WebContents,
  imageDir: string,
  updater: UpdaterService,
  license: LicenseService,
): HandlerServices {
  return {
    appInfo: () => ({ name: app.getName(), version: app.getVersion(), isPackaged: app.isPackaged }),
    printer,
    async pickImage() {
      const win = BrowserWindow.fromWebContents(sender);
      const options = {
        title: 'Rasm tanlang',
        properties: ['openFile' as const],
        filters: [{ name: 'Rasm', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      const picked = result.canceled ? undefined : result.filePaths[0];
      return picked ? importImage(picked, imageDir) : null;
    },
    // Pictures on receipts are a plan feature: without it they are left off the paper.
    receiptImage: (fileName) =>
      license.hasFeature('receiptLogos') ? imageDataUrl(imageDir, fileName) : null,
    updater,
    license,
  };
}

/** Tells every open window what changed (the LAN adapter will also push these to devices). */
export function broadcast(events: AppEvent[]): void {
  if (events.length === 0) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    for (const e of events) win.webContents.send(APP_EVENT_CHANNEL, e);
  }
}

/** Registers every channel in HANDLERS with ipcMain; successful changes are broadcast. */
export function registerIpcHandlers(
  getDb: () => Db,
  imageDir: string,
  updater: UpdaterService,
  license: LicenseService,
): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, rawInput: unknown) => {
      const store = actorStoreFor(event.sender);
      const ctx: HandlerContext = {
        db: getDb(),
        ...store,
        services: servicesFor(event.sender, imageDir, updater, license),
        log: (message, error) => logger.error(message, error),
      };
      const result = await invokeHandler(channel, HANDLERS[channel] as never, ctx, rawInput);
      if (result.ok) broadcast(eventsFor(channel, rawInput, result.data));
      return result;
    });
  }
}
