import { protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { IMAGE_MIME, resolveImagePath } from './image-store';

/** `<img src="savdochef-img://img/<file>">` in the renderer. Allowed by the CSP's img-src. */
export const IMAGE_SCHEME = 'savdochef-img';

/** Must run before app `ready`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } },
  ]);
}

/** Serves files from `imageDir` only; anything else is a 404. Read-only, GET only. */
export function handleImageScheme(imageDir: string): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const full = url.host === 'img' ? resolveImagePath(imageDir, fileName) : null;
    if (!full) return new Response(null, { status: 404 });
    try {
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
