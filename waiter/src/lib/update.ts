import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { z } from 'zod';
import { compareVersions } from '@shared/utils/version';

/**
 * The app updates itself, like the till (F4): `version.json` on panel.posgro.uz names the newest
 * APK and its sha256; the phone downloads it, checks the hash, and hands it to Android's
 * installer (which asks the waiter). Only from the Update screen; nothing runs in the background.
 */

const PROD_FEED = 'https://panel.posgro.uz/releases/savdochef-waiter/version.json';
const PROD_APK = /^https:\/\/panel\.posgro\.uz\/releases\/savdochef-waiter\/[\w.-]+\.apk$/;

/**
 * A development build may read another feed (`EXPO_PUBLIC_WAITER_FEED`, e.g. a local server on
 * the PC) to test this screen before anything is uploaded. A release build only knows the panel.
 */
const devFeed = __DEV__ ? process.env.EXPO_PUBLIC_WAITER_FEED : undefined;
export const FEED_URL = devFeed || PROD_FEED;
const APK_URL = devFeed ? /^https?:\/\/[\w.:-]+\/[\w./-]+\.apk$/ : PROD_APK;

export const feedSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  url: z.string().regex(APK_URL),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Bytes. */
  size: z.number().int().positive(),
  notes: z.object({ uz: z.array(z.string()), ru: z.array(z.string()) }).partial().optional(),
});
export type Feed = z.infer<typeof feedSchema>;

export const installedVersion = (): string => Application.nativeApplicationVersion ?? '0.0.0';

/** The feed, when it offers a newer version than this one; null when this one is newest. */
export async function checkForUpdate(
  fetchImpl: typeof fetch = fetch,
  feedUrl = FEED_URL,
): Promise<Feed | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetchImpl(feedUrl, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const feed = feedSchema.parse(await res.json());
    return compareVersions(feed.version, installedVersion()) > 0 ? feed : null;
  } finally {
    clearTimeout(timer);
  }
}

export interface Download {
  promise: Promise<File>;
  cancel(): void;
}

/** Downloads the APK into the cache, reporting bytes; the hash is checked before it resolves. */
export function downloadUpdate(
  feed: Feed,
  onProgress: (done: number, total: number) => void,
): Download {
  const target = new File(Paths.cache, `savdochef-waiter-${feed.version}.apk`);
  if (target.exists) target.delete();
  const task = File.createDownloadTask(feed.url, target);
  const sub = task.addListener('progress', (p) =>
    onProgress(p.bytesWritten, p.totalBytes > 0 ? p.totalBytes : feed.size),
  );
  const promise = (async () => {
    try {
      const file = await task.downloadAsync();
      if (!file) throw new Error('cancelled');
      // A file of another size is not the release: refused before it is read into memory.
      if (file.size !== feed.size) {
        file.delete();
        throw new ChecksumError();
      }
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== feed.sha256) {
        file.delete();
        throw new ChecksumError();
      }
      return file;
    } finally {
      sub.remove();
    }
  })();
  return { promise, cancel: () => task.cancel() };
}

export class ChecksumError extends Error {
  constructor() {
    super('checksum');
    this.name = 'ChecksumError';
  }
}

/** Opens Android's package installer for the downloaded APK (it asks for permission itself). */
export async function installUpdate(file: File): Promise<void> {
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
