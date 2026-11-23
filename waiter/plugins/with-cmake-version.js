// Expo config plugin: build every native module with CMake 3.31.6 (SDK package `cmake/3.31.6`).
//
// On Windows the default CMake (3.22.1) ships a ninja that cannot open files whose path passes
// 260 characters, and React Native's autolinked codegen objects repeat the project path inside
// their own path, so a project under C:\Users\<name>\Desktop\... fails with "Filename longer
// than 260 characters". The ninja in 3.31.6 (1.12.1) is long-path aware (Windows long paths are
// on: HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1).
//
// Registered in settings.gradle (`gradle.beforeProject`), so it is in place before any module is
// evaluated: the root build.gradle runs too late (some modules are already configured, and AGP
// refuses a version change after it read it). A module without native code ignores it.
const { withSettingsGradle } = require('expo/config-plugins');

const VERSION = '3.31.6';
const BLOCK = `
// with-cmake-version (waiter/plugins): long-path-aware CMake for every native module.
gradle.beforeProject { p ->
    ['com.android.application', 'com.android.library'].each { id ->
        p.pluginManager.withPlugin(id) {
            p.android.externalNativeBuild.cmake.version = '${VERSION}'
        }
    }
}
`;

module.exports = function withCmakeVersion(config) {
  return withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('with-cmake-version')) {
      cfg.modResults.contents += BLOCK;
    }
    return cfg;
  });
};
