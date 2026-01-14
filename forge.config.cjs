// forge.config.cjs
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    // icon: 'build/brand_logo',        // Uncomment when you have build/brand_logo.ico
    asarUnpack: [
      '**/node_modules/.prisma/**',
      '**/node_modules/@prisma/**',
      'backend/**'
    ],
    extraResource: [
      'backend' ,
    ],
    appBundleId: 'com.savdochef.app',   // optional (mac), good to set consistently
    appCopyright: '© 2025 SavdoChef',
  },
  makers: [
    // ---------- Linux ----------
    {
      name: '@pengx17/electron-forge-maker-appimage',
      platforms: ['linux'],
      config: {
        options: {
          productName: 'SavdoChef',
          genericName: 'Restaurant CRM',
          desktopName: 'SavdoChef',
          description: 'SavdoChef – Offline Restaurant CRM & POS for small cafes and eateries.',
          categories: ['Office', 'Utility'],
          icon: 'build/brand_logo.png'
        }
      }
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          productName: 'SavdoChef',
          description: 'SavdoChef – Offline Restaurant CRM & POS for small cafes and eateries.',
          maintainer: 'Bobur',
          icon: 'build/brand_logo.png',
          section: 'utils',
          priority: 'optional',
          categories: ['Office', 'Utility']
        }
      }
    },
    { name: '@electron-forge/maker-zip', platforms: ['linux'] },

    // ---------- Windows ----------
    // Squirrel disabled due to rcedit issues - using ZIP instead
    // {
    //   name: '@electron-forge/maker-squirrel',
    //   platforms: ['win32'],
    //   config: {
    //     name: 'savdochef',
    //     setupExe: 'SavdoChef-Setup.exe',
    //     // setupIcon: 'build/brand_logo.ico',
    //     noMsi: true,
    //   },
    // },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};
