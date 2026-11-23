import type { ExpoConfig } from 'expo/config';
import pkg from './package.json';

/** "1.2.3" -> 10203: Android installs an update only over a lower versionCode. */
export function versionCodeOf(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`package.json version must be x.y.z, got ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number) as [number, number, number];
  if (minor > 99 || patch > 99) throw new Error(`minor and patch must stay below 100: ${version}`);
  return major * 10000 + minor * 100 + patch;
}

/**
 * SavdoChef Ofitsiant (feature F20): Android only, sideloaded (no Play Store, no Expo cloud).
 * The phone talks plain HTTP to the till on the shop's own network, so cleartext is allowed;
 * it asks for the camera (pairing QR) and for installing its own updates, nothing else.
 */
const config: ExpoConfig = {
  name: 'SavdoChef Ofitsiant',
  slug: 'savdochef-waiter',
  // The update screen compares this with the feed: package.json is the one place it is set.
  version: pkg.version,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  backgroundColor: '#F6F7F9',
  platforms: ['android'],
  android: {
    package: 'uz.savdochef.waiter',
    versionCode: versionCodeOf(pkg.version),
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F8901F',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.REQUEST_INSTALL_PACKAGES'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
    ],
  },
  plugins: [
    ['expo-camera', { recordAudioAndroid: false }],
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
    'expo-secure-store',
    'expo-localization',
    './plugins/with-release-signing',
    './plugins/with-cmake-version',
  ],
};

export default config;
