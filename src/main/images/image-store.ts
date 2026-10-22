import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Dish pictures live in one directory (userData/img) under random names. The renderer never
 * sends or receives a filesystem path: it gets a file name, and shows it through the
 * `savdochef-img:` protocol (images-protocol.ts), which only ever reads from this directory.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_FILE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

type Kind = 'jpg' | 'png' | 'webp';

/** Recognises the real format from the first bytes; the extension alone proves nothing. */
export function sniffImage(head: Buffer): Kind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    head.length >= 12 &&
    head.toString('ascii', 0, 4) === 'RIFF' &&
    head.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export class ImageImportError extends Error {}

/** Copies a user-picked image into `imageDir` under a fresh random name and returns that name. */
export function importImage(sourcePath: string, imageDir: string): string {
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new ImageImportError('Fayl emas');
  if (stat.size > MAX_IMAGE_BYTES) throw new ImageImportError('Rasm 5 MB dan katta');

  return storeImageBytes(fs.readFileSync(sourcePath), imageDir);
}

/**
 * Writes picture bytes into `imageDir` under a fresh random name and returns that name. The real
 * format must be one of `kinds` (from the bytes, not from where they came from).
 */
export function storeImageBytes(
  data: Buffer,
  imageDir: string,
  kinds: readonly Kind[] = ['jpg', 'png', 'webp'],
): string {
  if (data.length > MAX_IMAGE_BYTES) throw new ImageImportError('Rasm 5 MB dan katta');
  const kind = sniffImage(data.subarray(0, 16));
  if (!kind || !kinds.includes(kind)) {
    throw new ImageImportError(
      kinds.length === 1
        ? `Faqat ${kinds[0]!.toUpperCase()} rasm`
        : 'Faqat JPG, PNG yoki WEBP rasm',
    );
  }

  fs.mkdirSync(imageDir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${kind}`;
  fs.writeFileSync(path.join(imageDir, name), data, { flag: 'wx' });
  return name;
}

/**
 * The on-disk path for an image name, or null if the name is not one we could have issued or the
 * result would leave `imageDir` (defence in depth: the name pattern already excludes separators).
 */
export function resolveImagePath(imageDir: string, fileName: string): string | null {
  if (!IMAGE_FILE_NAME.test(fileName)) return null;
  const root = path.resolve(imageDir);
  const full = path.resolve(root, fileName);
  if (path.dirname(full) !== root) return null;
  return full;
}

export const IMAGE_MIME: Record<Kind, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * A stored picture as a `data:` URL, for documents that may load nothing else (the receipt's CSP
 * allows only `img-src data:`). Null when the name is not one we issue, the file is gone, too big
 * or not really an image: the caller prints without it.
 */
export function imageDataUrl(imageDir: string, fileName: string): string | null {
  const full = resolveImagePath(imageDir, fileName);
  if (!full) return null;
  try {
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const data = fs.readFileSync(full);
    const kind = sniffImage(data.subarray(0, 16));
    return kind ? `data:${IMAGE_MIME[kind]};base64,${data.toString('base64')}` : null;
  } catch {
    return null;
  }
}

export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes pictures nothing refers to any more (a dish's picture was replaced or removed).
 * Only names this store could have issued are touched, and only files older than `minAgeMs`:
 * a picture picked in the dish dialog but not saved yet must survive. Returns the removed names.
 */
export function cleanupOrphanImages(
  imageDir: string,
  referenced: ReadonlySet<string>,
  now: number = Date.now(),
  minAgeMs: number = ORPHAN_MIN_AGE_MS,
): string[] {
  if (!fs.existsSync(imageDir)) return [];
  const removed: string[] = [];
  for (const name of fs.readdirSync(imageDir)) {
    if (!IMAGE_FILE_NAME.test(name) || referenced.has(name)) continue;
    const full = resolveImagePath(imageDir, name);
    if (!full) continue;
    const stat = fs.statSync(full);
    if (!stat.isFile() || now - stat.mtimeMs < minAgeMs) continue;
    fs.rmSync(full, { force: true });
    removed.push(name);
  }
  return removed;
}
