import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { APP_EVENT_CHANNEL, IPC_CHANNELS, type AppEvent, type IpcChannel } from '@shared/ipc';
import type { IpcResult } from '@shared/errors';
import { hasPermission } from '@shared/permissions';
import { lanJoinInput } from '@shared/schemas';
import type { CurrentUser } from '@shared/types';
import type { Actor, Db } from '../domain/db';
import { imageDataUrl, importImage } from '../images/image-store';
import { logger } from '../logger';
import { createPrinterService } from '../printing/printer';
import type { UpdaterService } from '../updater/updater';
import type { LicenseService } from '../license/license-service';
import type { LanService } from '../lan/lan-service';
import { printKitchenTickets } from '../printing/kitchen';
import { eventsFor } from './events';
import { HANDLERS } from './handlers';
import { invokeHandler, toIpcError, type HandlerContext, type HandlerServices } from './ipc-safe';

/**
 * Logged-in user per window (webContents). Each window logs in on its own and loses its login
 * when it closes. A satellite's user is held by the main till per device session (lan/server.ts).
 */
const actors = new Map<number, Actor>();
const printer = createPrinterService();
const tracked = new WeakSet<WebContents>();
/** Feature F12, on a satellite: each window's session token on the main till. */
const sessions = new Map<number, string>();
let lan: LanService | null = null;

function track(sender: WebContents) {
  if (tracked.has(sender)) return;
  tracked.add(sender);
  sender.once('destroyed', () => {
    actors.delete(sender.id);
    sessions.delete(sender.id);
  });
}

function actorStoreFor(sender: WebContents) {
  track(sender);
  return {
    actor: actors.get(sender.id) ?? null,
    setActor: (actor: Actor | null) => {
      if (actor) actors.set(sender.id, actor);
      else actors.delete(sender.id);
    },
  };
}

/**
 * Feature F11: prints kitchen tickets after the order is saved, one batch after the other (two
 * quick saves never interleave on a printer), then tells every window, which re-reads what failed.
 */
let kitchenQueue: Promise<unknown> = Promise.resolve();
function printKitchenInBackground(getDb: () => Db, ticketIds: number[]): void {
  if (ticketIds.length === 0) return;
  kitchenQueue = kitchenQueue
    .then(() =>
      printKitchenTickets(getDb(), printer, ticketIds, (message, error) =>
        logger.error(message, error),
      ),
    )
    .then(() => broadcast([{ type: 'kitchen-changed' }]))
    .catch((error: unknown) => logger.error('[kitchen] print batch failed', error));
}

/** `sender` null: a satellite's call on the main till, which has no window to open a dialog on. */
export function servicesFor(
  sender: WebContents | null,
  getDb: () => Db,
  imageDir: string,
  updater: UpdaterService,
  license: LicenseService,
): HandlerServices {
  return {
    appInfo: () => ({ name: app.getName(), version: app.getVersion(), isPackaged: app.isPackaged }),
    printer,
    async pickImage() {
      if (!sender) return null;
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
    printKitchen: (ticketIds) => printKitchenInBackground(getDb, ticketIds),
    updater,
    license,
    ...(lan ? { lan } : {}),
  };
}

/** This till's own windows. */
export function broadcastWindows(events: AppEvent[]): void {
  if (events.length === 0) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    for (const e of events) win.webContents.send(APP_EVENT_CHANNEL, e);
  }
}

/** Tells every open window what changed, and every satellite of this main till (F12). */
export function broadcast(events: AppEvent[]): void {
  broadcastWindows(events);
  lan?.push(events);
}

// ── Satellite routing (feature F12) ──────────────────────────────────────────────────────────

/** Run on the satellite itself: it updates itself and knows its own line. */
const SATELLITE_LOCAL: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  'app:info',
  'lan:link',
  'updater:status',
  'updater:check',
  'updater:download',
  'updater:install',
]);

const refusedOnSatellite = (channel: IpcChannel): IpcResult<never> => ({
  ok: false,
  error: {
    code: 'CONFLICT',
    message: channel.endsWith('pickImage')
      ? "Rasmlarni asosiy kassada qo'shing"
      : 'Bu sozlama asosiy kassada',
  },
});

/** Who is signed in at this window, asked of the main till (which re-reads the user). */
async function remoteActor(sender: WebContents): Promise<CurrentUser | null> {
  const link = lan?.mainLink;
  if (!link) return null;
  const { result } = await link.rpc('auth:me', undefined, sessions.get(sender.id) ?? null);
  return result.ok ? (result.data as CurrentUser | null) : null;
}

async function satelliteCall(
  channel: IpcChannel,
  sender: WebContents,
  rawInput: unknown,
  local: HandlerContext,
): Promise<IpcResult<unknown>> {
  const link = lan!.mainLink;
  if (channel === 'app:info' || channel === 'lan:link') {
    return invokeHandler(channel, HANDLERS[channel] as never, local, rawInput);
  }
  if (channel === 'menu:pickImage' || channel === 'receipt:pickImage') {
    return refusedOnSatellite(channel);
  }
  if (channel.startsWith('lan:') && channel !== 'lan:join' && channel !== 'lan:leave') {
    return refusedOnSatellite(channel);
  }
  if (SATELLITE_LOCAL.has(channel) || channel === 'lan:join' || channel === 'lan:leave') {
    // Leaving or re-pairing a satellite that cannot reach a working main till needs nobody: there
    // is nobody to ask. Otherwise a settings user, as on a main till.
    const stuckLinkAction =
      (channel === 'lan:join' && lan!.mayRejoinUnattended) ||
      (channel === 'lan:leave' && lan!.mayLeaveUnattended);
    try {
      const actor = stuckLinkAction ? null : await remoteActor(sender);
      if (!stuckLinkAction && !(actor && hasPermission(actor, 'settings'))) {
        return {
          ok: false,
          error: actor
            ? { code: 'FORBIDDEN', message: "Ruxsat yo'q" }
            : { code: 'NOT_AUTHENTICATED', message: 'Avval kiring' },
        };
      }
      if (channel === 'lan:join') {
        const parsed = lanJoinInput.safeParse(rawInput);
        if (!parsed.success) throw parsed.error;
        // Unattended: only back to the same restaurant's main till.
        return {
          ok: true,
          data: await lan!.join(parsed.data, { sameRestaurant: stuckLinkAction }),
        };
      }
      if (channel === 'lan:leave') return { ok: true, data: await lan!.leave() };
      const def = HANDLERS[channel] as unknown as {
        input: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } };
        run(ctx: HandlerContext, input: unknown): Promise<unknown>;
      };
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) throw parsed.error;
      return { ok: true, data: await def.run({ ...local, actor }, parsed.data) };
    } catch (error) {
      return { ok: false, error: toIpcError(error, local.log, channel) };
    }
  }
  if (!link) {
    return {
      ok: false,
      error: { code: 'CONFLICT', message: 'Bu kassa asosiy kassadan ajratilgan. Qayta ulang' },
    };
  }
  const { result, session } = await link.rpc(channel, rawInput, sessions.get(sender.id) ?? null);
  if (session === null) sessions.delete(sender.id);
  else if (session) sessions.set(sender.id, session);
  // The main till announces the change over its event stream; nothing to broadcast here.
  return result;
}

/** Registers every channel in HANDLERS with ipcMain; successful changes are broadcast. */
export function registerIpcHandlers(
  getDb: () => Db,
  imageDir: string,
  updater: UpdaterService,
  license: LicenseService,
  lanService: LanService | null = null,
): void {
  lan = lanService;
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, rawInput: unknown) => {
      const store = actorStoreFor(event.sender);
      const ctx: HandlerContext = {
        db: getDb(),
        ...store,
        services: servicesFor(event.sender, getDb, imageDir, updater, license),
        log: (message, error) => logger.error(message, error),
      };
      if (lan?.isSatellite) {
        return satelliteCall(channel, event.sender, rawInput, ctx);
      }
      const result = await invokeHandler(channel, HANDLERS[channel] as never, ctx, rawInput);
      if (result.ok) broadcast(eventsFor(channel, rawInput, result.data));
      return result;
    });
  }
}
