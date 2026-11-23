import { z } from 'zod';
import type { AppEvent, IpcChannel } from './ipc';

/**
 * Feature F20: the waiter phone app ("SavdoChef Ofitsiant", `waiter/`). A phone pairs with the
 * main till like a satellite till does (main/lan/server.ts), but it is a different kind of
 * device: it may call only the channels below, whoever signs in on it, and it gets only the events
 * its screens use. The main till enforces both; the phone's own screens are a courtesy.
 *
 * Shared by main (enforcing), the till's renderer (the QR it shows) and the phone (its client).
 */

export type LanDeviceKind = 'till' | 'waiter';
export const LAN_DEVICE_KINDS: readonly LanDeviceKind[] = ['till', 'waiter'];

/**
 * What a phone can do: sign in, read the tables and the menu, take and change table orders, move
 * them, and print the pre-bill on the main till. No payments, checks, shifts, settings or menu
 * editing, and no licence or account details.
 */
export const WAITER_CHANNELS = [
  'auth:pinLogin',
  'auth:logout',
  'auth:me',
  'settings:get',
  'halls:list',
  'categories:list',
  'menu:list',
  'sessions:getOpen',
  'orders:busyTables',
  'orders:getTable',
  'orders:save',
  'orders:cancel',
  'orders:moveTable',
  'orders:lockTable',
  'orders:unlockTable',
  'orders:tableLocks',
  'printing:printPreBill',
] as const satisfies readonly IpcChannel[];
export type WaiterChannel = (typeof WAITER_CHANNELS)[number];

export function isWaiterChannel(channel: string): channel is WaiterChannel {
  return (WAITER_CHANNELS as readonly string[]).includes(channel);
}

/** The events a phone's screens refresh on; the others never reach it. */
export const WAITER_EVENT_TYPES = [
  'orders-changed',
  'session-changed',
  'menu-changed',
  'settings-changed',
  'halls-changed',
  'license-changed',
] as const satisfies ReadonlyArray<AppEvent['type']>;

export function isWaiterEvent(event: AppEvent): boolean {
  return (WAITER_EVENT_TYPES as readonly string[]).includes(event.type);
}

/**
 * The phone protocol: bumped only when a phone of the previous protocol could no longer work with
 * this till (a channel's input or answer changed in a breaking way). The phone and the till each
 * have their own version line; this is what they compare (`GET /hello`).
 */
export const WAITER_PROTOCOL = 1;

/**
 * A till is on the shop's own network: 10/8, 172.16/12, 192.168/16 or link-local 169.254/16.
 * A QR or a typed address pointing anywhere else (the internet) is refused by the phone, so a
 * planted QR cannot send it, its secret and its waiters' PINs to a stranger.
 */
export function isPrivateIPv4(address: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** The six-digit pairing code. */
const pairingCode = z.string().regex(/^\d{6}$/);
const ipv4 = z
  .string()
  .regex(/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/);

/**
 * What the till's QR code holds (Settings -> Yo'ldosh kassalar -> Telefon qo'shish): this
 * computer's addresses on the shop's network, the port and the one-time code. JSON, so a phone
 * camera app that reads it shows nothing it could open.
 */
export const waiterPairingQr = z.object({
  app: z.literal('savdochef-waiter'),
  v: z.literal(1),
  hosts: z.array(ipv4.refine(isPrivateIPv4)).min(1).max(8),
  port: z.number().int().min(1024).max(65535),
  code: pairingCode,
});
export type WaiterPairingQr = z.infer<typeof waiterPairingQr>;

export function waiterPairingQrText(hosts: string[], port: number, code: string): string {
  const payload: WaiterPairingQr = { app: 'savdochef-waiter', v: 1, hosts, port, code };
  return JSON.stringify(payload);
}

/**
 * Why `POST /pair` refused (F20-W), next to the Uzbek message: the phone picks its error card by
 * it. `limit` (the plan's phones are all taken) comes as an AppError CONFLICT instead.
 */
export type PairRefusal = 'wrong' | 'expired' | 'throttled' | 'kind' | 'plan';

/** `GET /hello` for a phone: who answers, and whether it can talk to this phone. */
export interface WaiterHelloDto {
  lineage: string;
  version: string;
  protocol: number;
  /** The receipt's restaurant name ('' before the receipt is set up), for the PIN screen. */
  restaurantName: string;
}
