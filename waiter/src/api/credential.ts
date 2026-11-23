import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { isPrivateIPv4 } from '@shared/lan-waiter';

/**
 * What pairing gave this phone: the till's address and the device secret. Kept in the Android
 * Keystore (SecureStore); never logged, never shown. The sign-in session is not stored: a PIN is
 * asked again after every app start, as on the till.
 */
export const credentialSchema = z.object({
  /** The till's addresses on the shop's network, the one that answered first first. */
  hosts: z.array(z.string().refine(isPrivateIPv4)).min(1).max(8),
  port: z.number().int().min(1).max(65535),
  deviceId: z.number().int().positive(),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
  /** The till's restaurant identity: a different till at the same address is not ours. */
  lineage: z.string().min(1),
  restaurantName: z.string(),
  tillVersion: z.string(),
  pairedAt: z.string(),
});
export type Credential = z.infer<typeof credentialSchema>;

const KEY = 'savdochef.credential';

export async function loadCredential(): Promise<Credential | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = credentialSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveCredential(c: Credential): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(credentialSchema.parse(c)));
}

export async function clearCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export const baseUrl = (host: string, port: number) => `http://${host}:${port}`;
