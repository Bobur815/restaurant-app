/**
 * Electron Builder configuration (structure from posgro).
 * @see https://www.electron.build/configuration/configuration
 */
module.exports = {
  appId: 'uz.savdochef.pos',
  productName: 'SavdoChef',
  copyright: 'Copyright © 2026 Boburmirzo Ergashev',

  directories: {
    output: 'dist',
    buildResources: 'build',
  },

  asar: true,
  npmRebuild: false,
  // Phase 2: Prisma's query engine is a native .node file and cannot load from inside the archive.
  asarUnpack: ['src/generated/prisma-sqlite/**/*'],

  // Electron fuses (https://www.electronjs.org/docs/latest/tutorial/fuses). The till must not be
  // usable as a plain Node runtime or debuggable at the counter, and only loads its own, untampered
  // app.asar. The app forks no Node child process, which is what makes runAsNode safe to disable.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },

  files: [
    'dist-electron/**/*',
    'dist-renderer/**/*',
    'src/generated/prisma-sqlite/**/*',
    // Main-process deps are bundled by electron-vite; ship no node_modules.
    '!node_modules/**/*',
  ],

  // Window/taskbar icon at runtime (src/main/window.ts reads resources/icons/savdochef.ico).
  extraResources: [{ from: 'build/icons', to: 'icons', filter: ['savdochef.ico'] }],

  // Icons are generated from src/shared/branding/brand.ts by `npm run build:icons`.
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'SavdoChef-Setup-${version}.${ext}',
    icon: 'build/icons/savdochef.ico',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'SavdoChef',
    installerIcon: 'build/icons/savdochef.ico',
    uninstallerIcon: 'build/icons/savdochef.ico',
    installerHeaderIcon: 'build/icons/savdochef.ico',
    runAfterFinish: false,
    // The till's data (%APPDATA%\SavdoChef: database, backups, pictures, logs) survives an
    // uninstall and every upgrade; installing a newer version over an older one is the update path.
    deleteAppDataOnUninstall: false,
  },

  // Feature F4: the build writes latest.yml + .blockmap for this feed and app-update.yml into the
  // app; `npm run deploy:pos` uploads them (scripts/upload-release.mjs). Keep in sync with
  // UPDATE_FEED_URL in src/main/updater/updater.ts.
  publish: {
    provider: 'generic',
    url: 'https://panel.posgro.uz/releases/savdochef/',
    channel: 'latest',
  },

  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    icon: 'build/icons/savdochef-icon-1024.png',
  },
};
