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

  const data = fs.readFileSync(sourcePath);
  const kind = sniffImage(data.subarray(0, 16));
  if (!kind) throw new ImageImportError('Faqat JPG, PNG yoki WEBP rasm');

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
