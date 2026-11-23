import os from 'node:os';
import type { z } from 'zod';
import type { AppEvent } from '@shared/ipc';
import type { lanJoinInput, lanUpdateInput } from '@shared/schemas';
import type { LanDeviceDto, LanLinkDto, LanStatusDto } from '@shared/types';
import type { Db } from '../domain/db';
import { conflict, invalid } from '../domain/errors';
import type { HandlerServices } from '../ipc/ipc-safe';
import {
  becomeMain,
  becomeSatellite,
  ensureLineage,
  getLink,
  getLinkAddress,
  getPort,
  getRole,
  isEnabled,
  setEnabled,
  setPort,
  type Cipher,
  type LanRole,
} from './config';
import { countActiveDevices, LIMIT_MESSAGE, listDevices, revokeDevice } from './devices';
import type { LanDeviceKind } from '@shared/lan-waiter';
import { getReceiptSettings } from '../settings/settings';
import { MainLink, PairError, pairWithMain } from './main-link';
import { PairingStore } from './pairing';
import { LanServer } from './server';
import { normaliseMainAddress, shouldServe } from './serve-policy';
import { compareVersions } from '@shared/utils/version';

/**
 * Feature F12: this till's part in a multi-till restaurant. A main till (every till by default)
 * serves its satellites when the owner switches it on (Settings -> Satellitlar); a satellite
 * forwards everything to its main till over `MainLink`. Electron-free: the app wires in the
 * window broadcast, the keychain cipher and the restart.
 */

export interface LanServiceOptions {
  getDb(): Db;
  version: string;
  imageDir: string;
  machineName: string;
  cipher: Cipher;
  /** The main till's handler services, for satellite calls. */
  services: () => HandlerServices;
  /** Satellites the licence allows (terminals - 1); null = no limit. */
  deviceLimit(): number | null;
  /** F20: waiter phones the licence allows (0 = no waiter app). */
  waiterLimit(): number;
  /** This till's own windows. */
  broadcastLocal(events: AppEvent[]): void;
  /** Restart the app (a role change). */
  restart(): void;
  log(message: string, error?: unknown): void;
  fetch?: typeof fetch;
  /** A main till on this machine (127.x) may be joined: development and tests only. */
  allowLoopback?: boolean;
}

const LAN: AppEvent = { type: 'lan-changed' };
/** F20-T: presence changes within this window reach the settings page as one event. */
export const PRESENCE_DEBOUNCE_MS = 1000;

export class LanService {
  private role: LanRole = 'main';
  private server: LanServer | null = null;
  private link: MainLink | null = null;
  private readonly pairing = new PairingStore();
  private error: string | null = null;
  /** A satellite whose credential cannot be read (another keychain): it must pair again. */
  private brokenLink: string | null | undefined;
  private policyRun: Promise<void> = Promise.resolve();
  private expiry: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly o: LanServiceOptions) {}

  get isSatellite(): boolean {
    return this.role === 'satellite';
  }

  get mainLink(): MainLink | null {
    return this.link;
  }

  async init(): Promise<void> {
    const db = this.o.getDb();
    this.role = await getRole(db);
    if (this.role === 'satellite') {
      const link = await getLink(db, this.o.cipher);
      if (!link) {
        // Never a silent switch to a till of its own: it says it is unpaired and offers to re-pair.
        this.o.log('[lan] satellite credential unreadable; pair again', new Error('unreadable'));
        this.brokenLink = await getLinkAddress(db);
        return;
      } else {
        this.link = new MainLink({
          link,
          version: this.o.version,
          fetch: this.o.fetch,
          onEvent: (e) => this.o.broadcastLocal([e]),
          onState: () => this.o.broadcastLocal([LAN]),
          log: this.o.log,
        });
        this.link.start();
        return;
      }
    }
    await this.applyPolicy();
  }

  /**
   * F20-T: a device came online, went away, or signed someone in or out: the settings page
   * re-reads once per burst (a phone reconnecting would otherwise send several in a row).
   */
  private presenceChanged(): void {
    if (this.presenceTimer || this.stopped) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.o.broadcastLocal([LAN]);
    }, PRESENCE_DEBOUNCE_MS);
    this.presenceTimer.unref();
  }

  async stop(): Promise<void> {
    this.link?.stop();
    if (this.expiry) clearTimeout(this.expiry);
    // Streams closing in server.stop() report presence once more: nothing is sent after stop.
    this.stopped = true;
    await this.server?.stop();
    this.server = null;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
  }

  /** Every event the main till broadcasts reaches its satellites. */
  push(events: AppEvent[]): void {
    this.server?.push(events);
  }

  /** Starts or stops the server to match the policy; serialised so two changes never race. */
  applyPolicy(): Promise<void> {
    this.policyRun = this.policyRun
      .then(() => this.applyPolicyNow())
      .catch((e: unknown) => {
        this.o.log('[lan] policy failed', e);
      });
    return this.policyRun;
  }

  private async applyPolicyNow(): Promise<void> {
    const db = this.o.getDb();
    const port = await getPort(db);
    const want = shouldServe({
      role: this.role,
      enabled: await isEnabled(db),
      activeDevices: await countActiveDevices(db),
      pairingOpen: this.pairing.isOpen(),
    });
    if (this.server && (!want || this.server.port !== port)) {
      await this.server.stop();
      this.server = null;
      this.o.log('[lan] server stopped');
    }
    if (want && !this.server) {
      const server = new LanServer({
        getDb: this.o.getDb,
        services: this.o.services(),
        imageDir: this.o.imageDir,
        version: this.o.version,
        lineage: () => ensureLineage(this.o.getDb()),
        pairing: this.pairing,
        deviceLimit: this.o.deviceLimit,
        waiterLimit: this.o.waiterLimit,
        restaurantName: async () =>
          (await getReceiptSettings(this.o.getDb()))?.restaurantName ?? '',
        broadcastLocal: this.o.broadcastLocal,
        onPaired: () => {
          this.o.broadcastLocal([LAN]);
          void this.applyPolicy();
        },
        onPresence: () => this.presenceChanged(),
        log: this.o.log,
      });
      try {
        await server.start(port);
        this.server = server;
        this.error = null;
        this.o.log(`[lan] serving satellites on port ${port}`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        this.error =
          code === 'EADDRINUSE'
            ? `${port}-port band (boshqa dastur ishlatmoqda). Boshqa portni tanlang`
            : "Tarmoqda ishga tushirib bo'lmadi";
        this.o.log('[lan] server failed to start', error);
      }
    }
    if (!want) this.error = null;
  }

  // ── main till: Settings -> Satellitlar ─────────────────────────────────────────────────────

  private assertMain(): void {
    if (this.role !== 'main') throw conflict("Bu kassa yo'ldosh: sozlamalar asosiy kassada");
  }

  async status(): Promise<LanStatusDto> {
    const db = this.o.getDb();
    const pairing = this.pairing.current();
    const limit = this.o.deviceLimit();
    const waiterLimit = this.o.waiterLimit();
    return {
      enabled: await isEnabled(db),
      port: await getPort(db),
      serving: this.server?.listening ?? false,
      error: this.error,
      addresses: localAddresses(),
      pairing: pairing
        ? {
            code: pairing.code,
            expiresAt: new Date(pairing.expiresAt).toISOString(),
            kind: pairing.kind,
          }
        : null,
      devices: this.withPresence(await listDevices(db)),
      deviceLimit: limit,
      waiterLimit,
      waiterApp: waiterLimit > 0,
    };
  }

  /** F20-T: online from the open event streams; a user name for online phones only. */
  private withPresence(devices: LanDeviceDto[]): LanDeviceDto[] {
    const live = this.server?.presence() ?? new Map<number, { userName: string | null }>();
    return devices.map((d) => {
      const p = d.revoked ? undefined : live.get(d.id);
      return {
        ...d,
        online: p !== undefined,
        userName: p && d.kind === 'waiter' ? p.userName : null,
      };
    });
  }

  async update(input: z.infer<typeof lanUpdateInput>): Promise<LanStatusDto> {
    this.assertMain();
    const db = this.o.getDb();
    if (input.port !== undefined) await setPort(db, input.port);
    if (input.enabled !== undefined) {
      await setEnabled(db, input.enabled);
      if (!input.enabled) this.pairing.cancel();
    }
    await this.applyPolicy();
    return this.status();
  }

  /** A pairing code for a satellite till or (F20) a waiter phone, within the plan's limit. */
  async issueCode(kind: LanDeviceKind = 'till'): Promise<LanStatusDto> {
    this.assertMain();
    const db = this.o.getDb();
    if (!(await isEnabled(db))) throw conflict("Avval yo'ldosh kassalarni yoqing");
    const limit = kind === 'waiter' ? this.o.waiterLimit() : this.o.deviceLimit();
    if (kind === 'waiter' && limit === 0) {
      throw conflict("Tarifingizda ofitsiant ilovasi yo'q (Standard va Pro tariflarida bor)", {
        reason: 'NO_WAITER_APP',
      });
    }
    if (limit !== null && (await countActiveDevices(db, kind)) >= limit) {
      throw conflict(LIMIT_MESSAGE[kind], { reason: 'DEVICE_LIMIT', limit, kind });
    }
    await ensureLineage(db);
    const code = this.pairing.issue(kind);
    // The door closes again with the code when no satellite is paired yet.
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => {
        void this.applyPolicy().then(() => this.o.broadcastLocal([LAN]));
      },
      code.expiresAt - Date.now() + 500,
    );
    this.expiry.unref();
    await this.applyPolicy();
    return this.status();
  }

  async cancelCode(): Promise<LanStatusDto> {
    this.assertMain();
    this.pairing.cancel();
    await this.applyPolicy();
    return this.status();
  }

  async revoke(deviceId: number): Promise<LanStatusDto> {
    this.assertMain();
    await revokeDevice(this.o.getDb(), deviceId);
    this.server?.dropDevice(deviceId);
    this.o.log(`[lan] device ${deviceId} revoked`);
    await this.applyPolicy();
    return this.status();
  }

  // ── both: the role and the line ────────────────────────────────────────────────────────────

  linkStatus(): LanLinkDto {
    if (this.link) return this.link.status();
    if (this.brokenLink !== undefined) {
      return {
        role: 'satellite',
        mainUrl: this.brokenLink,
        state: 'unpaired',
        mainVersion: null,
        lastContactAt: null,
      };
    }
    return { role: 'main', mainUrl: null, state: null, mainVersion: null, lastContactAt: null };
  }

  private get state() {
    return this.linkStatus().state;
  }

  /**
   * A satellite that may be re-paired by whoever stands at it: the main till itself said it no
   * longer knows it, the versions differ, or another till answers. Not "unreachable": pulling a
   * cable must not open anything. Re-pairing then reaches only the same restaurant (lineage).
   */
  get mayRejoinUnattended(): boolean {
    const s = this.state;
    return s === 'unpaired' || s === 'superseded' || s === 'version';
  }

  /**
   * Feature F15: updating this satellite without a sign-in (nobody can sign in while the versions
   * differ): only when the link refuses for the version and the main till is the newer one.
   */
  get mayUpdateUnattended(): boolean {
    const link = this.linkStatus();
    return (
      link.role === 'satellite' &&
      link.state === 'version' &&
      !!link.mainVersion &&
      compareVersions(link.mainVersion, this.o.version) > 0
    );
  }

  /** The main till's version as last seen (null on a main till or before any contact). */
  get mainVersion(): string | null {
    return this.linkStatus().mainVersion;
  }

  /** Leaving without a sign-in: only when the main till itself refuses this satellite. */
  get mayLeaveUnattended(): boolean {
    const s = this.state;
    return s === 'unpaired' || s === 'version';
  }

  /** The lineage a re-pair must match (the restaurant this satellite belongs to). */
  private async currentLineage(): Promise<string | null> {
    const link = await getLink(this.o.getDb(), this.o.cipher);
    return link?.lineage ?? null;
  }

  /** Pairs with the main till at the address and becomes its satellite; the app restarts. */
  async join(
    input: z.infer<typeof lanJoinInput>,
    { sameRestaurant = false }: { sameRestaurant?: boolean } = {},
  ): Promise<LanLinkDto> {
    const db = this.o.getDb();
    const mainUrl = normaliseMainAddress(
      input.mainAddress,
      await getPort(db),
      this.o.allowLoopback ?? false,
    );
    if (!mainUrl)
      throw invalid("Manzil noto'g'ri. Masalan: 192.168.1.10", { field: 'mainAddress' });
    let link;
    try {
      link = await pairWithMain(mainUrl, input.code, this.o.machineName, this.o.fetch);
    } catch (error) {
      if (error instanceof PairError) throw conflict(error.message, { reason: 'PAIR' });
      throw error;
    }
    if (sameRestaurant) {
      const lineage = await this.currentLineage();
      if (!lineage || lineage !== link.lineage) {
        this.o.log(`[lan] unattended re-pair refused: ${mainUrl} is another restaurant`);
        throw conflict(
          'Bu boshqa restoranning asosiy kassasi. Boshqa kassaga ulash uchun avval asosiy kassada administrator bilan kiring',
          { reason: 'OTHER_RESTAURANT' },
        );
      }
    }
    if (this.server) await this.server.stop();
    this.server = null;
    await becomeSatellite(db, link, this.o.cipher);
    this.o.log(`[lan] paired as satellite ${link.deviceId} of ${mainUrl}`);
    this.o.restart();
    return {
      role: 'satellite',
      mainUrl,
      state: 'connecting',
      mainVersion: link.mainVersion,
      lastContactAt: null,
    };
  }

  /** A satellite becomes a till of its own again (its own, separate database); restarts. */
  async leave(): Promise<LanLinkDto> {
    if (this.role !== 'satellite') throw conflict("Bu kassa yo'ldosh emas");
    this.link?.stop();
    await becomeMain(this.o.getDb());
    this.o.log('[lan] left the main till; now a main till');
    this.o.restart();
    return { role: 'main', mainUrl: null, state: null, mainVersion: null, lastContactAt: null };
  }
}

/** This computer's IPv4 addresses on the shop's network (shown for the satellite's form). */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
        out.push(a.address);
    }
  }
  return out;
}
