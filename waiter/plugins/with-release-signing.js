// Expo config plugin: sign release builds with the SavdoChef Ofitsiant key when it is given.
//
// The keystore lives OUTSIDE the repo (default %USERPROFILE%\.savdochef\waiter-release.keystore)
// with a backup the owner keeps: Android installs an update only when it is signed by the same
// key, so a lost key means every phone uninstalls and pairs again. Nothing secret is written
// into android/: Gradle reads the paths and passwords from environment variables at build time.
//
//   WAITER_KEYSTORE            path to the .keystore / .jks
//   WAITER_KEYSTORE_PASSWORD   store password
//   WAITER_KEY_ALIAS           key alias
//   WAITER_KEY_PASSWORD        key password
//
// Without WAITER_KEYSTORE a release build is signed with the debug key (fine for the emulator,
// refused by scripts/build-apk.mjs for anything meant for phones).
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
            if (System.getenv('WAITER_KEYSTORE')) {
                storeFile file(System.getenv('WAITER_KEYSTORE'))
                storePassword System.getenv('WAITER_KEYSTORE_PASSWORD')
                keyAlias System.getenv('WAITER_KEY_ALIAS')
                keyPassword System.getenv('WAITER_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (!gradle.includes("System.getenv('WAITER_KEYSTORE')")) {
      // Add the release signing config next to the debug one Expo generates.
      gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${SIGNING}`);
      // The release build type uses it when the key is given, else the debug key.
      gradle = gradle.replace(
        /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/,
        "$1signingConfig System.getenv('WAITER_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
      );
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
