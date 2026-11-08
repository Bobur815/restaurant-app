import { protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { IMAGE_MIME, resolveImagePath, sniffImage } from './image-store';

/** `<img src="savdochef-img://img/<file>">` in the renderer. Allowed by the CSP's img-src. */
export const IMAGE_SCHEME = 'savdochef-img';

/** Must run before app `ready`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } },
  ]);
}

/**
 * Serves files from `imageDir` only; anything else is a 404. Read-only, GET only. On a satellite
 * (feature F12) a picture it does not have yet comes from the main till and is kept: picture
 * names are random and never reused for other content, so a kept copy never goes stale. Only
 * bytes that are a picture of the named kind are kept.
 */
export function handleImageScheme(
  imageDir: string,
  fetchMissing?: (fileName: string) => Promise<Buffer | null>,
): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    let fileName: string;
    try {
      fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return new Response(null, { status: 404 });
    }
    const full = url.host === 'img' ? resolveImagePath(imageDir, fileName) : null;
    if (!full) return new Response(null, { status: 404 });
    try {
      if (fetchMissing && !fs.existsSync(full)) {
        const fetched = await fetchMissing(fileName);
        if (!fetched || sniffImage(fetched) !== path.extname(full).slice(1))
          return new Response(null, { status: 404 });
        await fs.promises.mkdir(imageDir, { recursive: true });
        const tmp = `${full}.${randomBytes(6).toString('hex')}.part`;
        await fs.promises.writeFile(tmp, fetched);
        await fs.promises.rename(tmp, full);
      }
      const data = await fs.promises.readFile(full);
      const ext = path.extname(full).slice(1) as keyof typeof IMAGE_MIME;
      return new Response(data, {
        headers: {
          'content-type': IMAGE_MIME[ext],
          'cache-control': 'max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
