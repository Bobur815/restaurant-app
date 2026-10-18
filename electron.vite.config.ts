import { defineConfig } from 'electron-vite';
import { resolve } from 'path';
import type { Plugin } from 'vite';

const DEV_PORT = 5400;

const alias = {
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@shared': resolve(__dirname, 'src/shared'),
};

/**
 * index.html carries the production CSP. The Vite dev server needs two holes in it: a websocket
 * for HMR and inline <style> for its error overlay. They are added here, during `serve` only, so
 * the built file is exactly what is in source.
 */
function devCsp(): Plugin {
  return {
    name: 'savdochef-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("connect-src 'self'", `connect-src 'self' ws://localhost:${DEV_PORT}`)
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
    },
  };
}

/** Electron loads the build from file://, where `crossorigin` on a module script blocks it silently. */
function removeCrossorigin(): Plugin {
  return {
    name: 'savdochef-remove-crossorigin',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'dist-electron/main',
      // Bundle main-process dependencies so the package ships no node_modules (posgro pattern).
      // Native pieces (Prisma's query engine, Phase 2) are added to `external` + asarUnpack.
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },

  preload: {
    resolve: { alias },
    build: {
      outDir: 'dist-electron/preload',
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/main/preload.ts'),
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    server: { port: DEV_PORT, strictPort: true },
    build: {
      outDir: resolve(__dirname, 'dist-renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [devCsp(), removeCrossorigin()],
  },
});
