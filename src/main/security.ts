import { app, session, shell, type WebContents } from 'electron';

/**
 * Where the app's own UI is allowed to live. In development that is the Vite dev server; in a
 * build it is the bundled index.html on disk. Anything else is foreign content.
 */
export interface AppOrigin {
  devServerUrl?: string;
  indexHtmlPath?: string;
}

/**
 * True only for the app's own page: the dev server origin, or the exact built index.html (any
 * hash, since the router lives in the hash). Pure, so it is unit-tested without Electron.
 */
export function isAppUrl(rawUrl: string, origin: AppOrigin): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (origin.devServerUrl) {
    const dev = new URL(origin.devServerUrl);
    if (url.origin === dev.origin) return true;
  }

  if (origin.indexHtmlPath && url.protocol === 'file:') {
    const expected = new URL(
      `file:///${origin.indexHtmlPath.replace(/\\/g, '/').replace(/^\/+/, '')}`,
    );
    return (
      decodeURIComponent(url.pathname).toLowerCase() ===
      decodeURIComponent(expected.pathname).toLowerCase()
    );
  }

  return false;
}

/** Links the user may open in their real browser (never inside the app window). */
export function isExternalLinkAllowed(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Process-wide guards, applied to every webContents ever created:
 * no navigation away from the app, no new windows, no <webview>, no permission prompts.
 */
export function installSecurityHandlers(origin: AppOrigin): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url, origin)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url, origin)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLinkAllowed(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  // The POS needs no camera, microphone, geolocation or notifications prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}
