import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import type { IpcChannel } from '@shared/ipc';
import type { Actor, Db } from '../domain/db';
import { importImage } from '../images/image-store';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext, type HandlerServices } from './ipc-safe';

/**
 * Logged-in user per window (webContents). Each window logs in on its own and loses its login
 * when it closes. The LAN adapter (Phase 8.5) will key the same thing by device token.
 */
const actors = new Map<number, Actor>();
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

function servicesFor(sender: WebContents, imageDir: string): HandlerServices {
  return {
    appInfo: () => ({ name: app.getName(), version: app.getVersion(), isPackaged: app.isPackaged }),
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
  };
}

/** Registers every channel in HANDLERS with ipcMain. */
export function registerIpcHandlers(getDb: () => Db, imageDir: string): void {
  for (const channel of Object.keys(HANDLERS) as IpcChannel[]) {
    ipcMain.handle(channel, (event, rawInput: unknown) => {
      const store = actorStoreFor(event.sender);
      const ctx: HandlerContext = {
        db: getDb(),
        ...store,
        services: servicesFor(event.sender, imageDir),
        log: (message, error) => console.error(message, error),
      };
      return invokeHandler(channel, HANDLERS[channel] as never, ctx, rawInput);
    });
  }
}
