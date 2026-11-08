import type { LanDeviceDto } from '@shared/types';
import type { Db } from '../domain/db';
import { conflict, notFound } from '../domain/errors';
import { hashSecret, newDeviceSecret, secretMatches } from './pairing';

/** Feature F12: the satellites paired with this main till (lan_devices). */

function toDto(d: {
  id: number;
  name: string;
  pairedAt: Date;
  lastSeenAt: Date | null;
  lastIp: string | null;
  revokedAt: Date | null;
}): LanDeviceDto {
  return {
    id: d.id,
    name: d.name,
    pairedAt: d.pairedAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastIp: d.lastIp,
    revoked: d.revokedAt !== null,
  };
}

export async function listDevices(db: Db): Promise<LanDeviceDto[]> {
  const rows = await db.lanDevice.findMany({ orderBy: [{ revokedAt: 'asc' }, { id: 'asc' }] });
  return rows.map(toDto);
}

export function countActiveDevices(db: Db): Promise<number> {
  return db.lanDevice.count({ where: { revokedAt: null } });
}

/**
 * Pairs a new satellite. `limit` = satellites the plan allows (null = no limit). Returns the id
 * and the secret, which is never stored and never shown again.
 */
export async function createDevice(
  db: Db,
  name: string,
  ip: string | null,
  limit: number | null,
): Promise<{ id: number; secret: string }> {
  return db.$transaction(async (tx) => {
    if (limit !== null && (await tx.lanDevice.count({ where: { revokedAt: null } })) >= limit) {
      throw conflict("Tarifingiz bo'yicha qo'shimcha kassalar soni to'lgan", {
        reason: 'DEVICE_LIMIT',
        limit,
      });
    }
    const secret = newDeviceSecret();
    const row = await tx.lanDevice.create({
      data: {
        name: name.slice(0, 60) || "Yo'ldosh kassa",
        secretHash: hashSecret(secret),
        lastIp: ip,
      },
    });
    return { id: row.id, secret };
  });
}

export async function revokeDevice(db: Db, id: number): Promise<void> {
  const row = await db.lanDevice.findUnique({ where: { id } });
  if (!row) throw notFound('Kassa');
  if (!row.revokedAt) await db.lanDevice.update({ where: { id }, data: { revokedAt: new Date() } });
}

/** How often lastSeenAt is written: once a minute is enough to show "online". */
const SEEN_EVERY_MS = 60_000;

/**
 * The device behind `<id>.<secret>`, or null. A revoked device or a wrong secret is null: the
 * caller answers 401 either way.
 */
export async function authenticateDevice(
  db: Db,
  credential: string,
  ip: string | null,
): Promise<{ id: number; name: string } | null> {
  const m = /^(\d{1,9})\.([0-9a-f]{64})$/.exec(credential);
  if (!m) return null;
  const row = await db.lanDevice.findUnique({ where: { id: Number(m[1]) } });
  if (!row || row.revokedAt || !secretMatches(m[2]!, row.secretHash)) return null;
  const now = Date.now();
  if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > SEEN_EVERY_MS || row.lastIp !== ip) {
    await db.lanDevice
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date(now), lastIp: ip } })
      .catch(() => undefined);
  }
  return { id: row.id, name: row.name };
}
