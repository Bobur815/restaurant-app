# React Native app playbook (from SavdoChef Ofitsiant)

How we built, tested and shipped the SavdoChef waiter app (`waiter/`, F20), written so the next
Android apps can follow the same process with the same tools, without repeating its mistakes.
Every "Lesson" box below cost real time once.

- Reference app: `restaurant-app/waiter/` (copy files from it rather than retyping them).
- Lessons source: `restaurant-app/tasks/lessons.md` (entries tagged F20-W).
- Plan that produced it: `restaurant-app/tasks/todo.md`, section "F20-W".

---

## 1. The stack (keep it unless there is a reason)

| Part | Choice | Why |
| --- | --- | --- |
| Framework | Expo SDK (newest released 2+ weeks ago), React Native, TypeScript strict | Expo config plugins generate `android/`; nothing native is hand-edited |
| Platform | Android only, `platforms: ['android']` | Our users run cheap Android phones |
| Distribution | Sideloaded APK + our own update feed on `panel.posgro.uz` | No Play Store, no EAS, no Expo cloud, no Expo Updates |
| Navigation | `@react-navigation/native-stack` (no file routing) | A few screens, explicit stack |
| State | React context + reducers | No extra state library |
| Validation | `zod` on everything that comes from outside (network, QR, storage) | Same as the till |
| Money | `decimal.js` through shared helpers, never floats | Hard rule from the till |
| Secrets | `expo-secure-store` (Android Keystore) | Never AsyncStorage for credentials |
| Icons | `lucide-react-native` + `react-native-svg` | Matches the designs |
| Tests | `jest-expo` + `@testing-library/react-native` | |
| Lint | `eslint-config-expo/flat` + `eqeqeq`, `no-console` (warn/error allowed) | |

Project layout: the app lives in its own folder next to the product it belongs to
(`<repo>/<app>/`) with its **own `package.json`** (not a workspace). The root lint, jest, prettier
and tsconfig must ignore that folder.

---

## 2. Machine setup (Windows, this PC)

Already installed here; on a new PC install the same:

- **JDK 17**: Microsoft OpenJDK (`JAVA_HOME=C:\Program Files\Microsoft\jdk-17...`).
- **Android SDK** in `%LOCALAPPDATA%\Android\Sdk`, with:
  - `platforms;android-37` and `build-tools` 36/37
  - `ndk` (the version the RN release asks for)
  - `cmake;3.31.6`, **required** (see the lesson below)
  - `platform-tools` (adb) and `emulator`, plus a Pixel-size AVD (`Medium_Phone_API_37.0`)
- `ANDROID_HOME` doesn't have to be set: the build script falls back to `%LOCALAPPDATA%\Android\Sdk`.
- **Windows long paths** on: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.

> **Lesson: "Filename longer than 260 characters".** React Native's native build fails on Windows under the SDK's default CMake 3.22.1. Its codegen object paths repeat the project path, so a project under `C:\Users\<name>\Desktop\...` passes 260 characters.
> - A `subst` drive does not help, because autolinking resolves the real path.
> - The fix is CMake 3.31.6, whose ninja 1.12.1 is long-path aware. `plugins/with-cmake-version.js` forces that version for every native module from `settings.gradle` (`gradle.beforeProject` + `pluginManager.withPlugin`).
> - Setting it in the root `build.gradle` is too late: AGP refuses a version change after it has read it.
> - **Copy this plugin into every new app.**

---

## 3. Process, step by step

### 3.1 Plan first
`/plan`: questions with a recommendation each, then checkable items in `tasks/todo.md`, then wait
for approval. The F20-W section is the template: project, server side, phone code, money/stock
effects, strings, tests, verification, versions.

### 3.2 Designs before code
Get a design handoff in `docs/designs/<app>/` before writing screens. F20's handoff had:
- `handoff.md`: components, screens, conventions;
- `tokens.ts`: colours for light **and** dark, spacing, radius, type, sizes, elevations;
- `strings.ts`: every UI string as `key → { uz, ru }`;
- `frames/`: PNGs of every screen in light and dark.

`tokens.ts` and `strings.ts` are copied into the app as they are (`src/theme/tokens.ts`, `src/i18n/strings.ts`).

Design rules that carried over:
- **Frame:** portrait, 360×800 dp, checked at 412×915.
- **Touch:** every target at least 48×48 dp.
- **Colours:** read from tokens only, never hex in components.
- **Depth:** no blur or shadows; use `elevation` on sheets, dialogs and toasts.
- **Contrast:** small text passes 4.5:1, which is why there are `*Text` tokens separate from the icon colours.

### 3.3 Pin versions
- **Pick the Expo SDK:** use `npm view expo time --json` to find the newest SDK patch released at least two weeks ago. Then add libraries with `npx expo install <pkg>` and change every version to an **exact** pin (no `^`, no `~`).
- **Ignore `npx expo install --check` complaints.** It compares against the newest patch online, not your pinned `expo`, so it flags correct two-week-old pins as outdated.
- **Transitive packages past the cut-off:** pin them in `overrides`, pointing at a direct dependency:
  ```json
  "overrides": { "babel-preset-expo": "$babel-preset-expo", "@react-navigation/elements": "$@react-navigation/elements" }
  ```
- **Replacing a nested copy:** make the package a direct dependency, point the override at it, then `npm dedupe`. The guard hook blocks `rm -rf node_modules/...`.

### 3.4 Scaffold: files to copy from `waiter/`

| File | What to change |
| --- | --- |
| `package.json` scripts | Keep as is: `start`, `android`, `typecheck`, `lint`, `test`, `check`, `prebuild`, `apk` |
| `app.config.ts` | Name, `slug`, `android.package` (e.g. `uz.savdochef.<app>`), icon colours, permissions, plugins |
| `metro.config.js` | Only if the app shares code with a parent repo (§3.5) |
| `jest.config.js`, `tsconfig.json`, `babel.config.js`, `eslint.config.js` | Paths only |
| `plugins/with-cmake-version.js` | Nothing |
| `plugins/with-release-signing.js` | Env var prefix (`WAITER_` becomes `<APP>_`) |
| `scripts/build-apk.mjs` | Env var prefix, APK file name, feed URL |
| `.gitignore` | Nothing: `android/`, `ios/`, `.expo/`, `dist/`, `*.apk`, `*.aab`, `*.keystore`, `*.jks`, `keystore.properties` |

`app.config.ts` rules:
- **Version:** read `version` from `package.json`, so it's set in one place. Derive `versionCode` with `versionCodeOf()`: `1.2.3` becomes `10203`, because Android only installs an update over a lower versionCode.
- **Locked down by default:** `allowBackup: false`, and request only the permissions the app needs. Put everything else in `blockedPermissions`; libraries add `RECORD_AUDIO`, storage, `SYSTEM_ALERT_WINDOW` and `VIBRATE` silently otherwise.
- **Cleartext HTTP** (`expo-build-properties` → `usesCleartextTraffic: true`) only if the app talks to a device on the local network, as the waiter app does with the till. An app that only talks to the internet uses HTTPS and leaves this out.
- `userInterfaceStyle: 'automatic'`, plus an in-app theme switch (§4).
- `android/` is generated (`expo prebuild --clean`) and gitignored. Native changes go into config plugins, never into `android/` by hand.

### 3.5 Sharing code with the parent product (optional)
The waiter app imports the till's `src/shared` as `@shared/*`, so prices, stock, service fee and
the QR schema are the till's own code, not copies.
- **TypeScript:** `tsconfig.json` has `paths: { "@shared/*": ["../src/shared/*"] }`.
- **Metro:**
  - `watchFolders = [shared]` and an `@shared/` alias.
  - Re-root only the *bare imports made from inside the shared folder* to the app's own `node_modules`.
  - Keep Metro's hierarchical lookup: packages nest, e.g. `@react-navigation/elements` inside `native-stack`.
- **Jest:** a `moduleNameMapper` for `@shared/*` plus each package the shared code imports (`decimal.js`, `zod`, `@babel/runtime`) pointed at the app's `node_modules`. A `moduleDirectories` attempt broke Jest's own resolution.
- **Keep the shared code light:** plain TS, `zod` and `decimal.js` only. No Node or Electron imports.

### 3.6 App structure
```
src/
  App.tsx          SafeAreaProvider > ThemePreferenceProvider > I18nProvider > AppStateProvider > ToastProvider > Root
  navigation.ts    stack param types
  api/             client (typed calls, timeout, typed errors), credential (SecureStore + zod), pairing, sse
  components/      Button, BottomSheet, Dialog, Toast, Banner, ui.tsx (Screen, TopBar, Segmented, ...)
  screens/         one file per screen (sub-parts in screens/<name>/)
  state/           context + reducers
  theme/           tokens.ts (from the handoff), index.ts (useTheme), preference.tsx (system/light/dark)
  i18n/            strings.ts (from the handoff), index.tsx (t(), {n} placeholders, ru plurals)
  lib/             pure helpers (cart, update) with tests
```

**Networking:**
- Every request has a timeout (15 s), using an `AbortController`.
- Answers are parsed with zod.
- Server errors map to typed errors that carry the server's Uzbek message. A 401 means the phone is unpaired.
- RN's `fetch` does not stream, so SSE needs XHR `onprogress` or a small SSE client, with reconnect and backoff.

**Storage:**
- Credentials go in SecureStore, validated with zod on load. A broken value counts as missing.
- Never log a secret.
- Store small preferences (language, theme) in SecureStore too.

**Text:**
- Every string exists in uz and ru, and a test checks that both languages have the same keys and `{placeholders}`.
- Start in the phone's language (`expo-localization`), then remember the user's choice.
- Format numbers with the shared formatter, not `Intl`/`toLocaleString`: Uzbek ICU is missing.

---

## 4. UI rules learned on a real phone

The emulator hid all of these; the first real phone showed them at once.

- **Safe areas everywhere.** Any screen or panel pinned to the bottom adds `useSafeAreaInsets().bottom` to its padding. The QR scanner's bottom panel sat under the navigation bar until it did.
- **Bottom sheets:**
  - Size them in pixels: `maxHeight = (useWindowDimensions().height - insets.top) * 0.92`. A percentage `maxHeight` inside a content-sized `KeyboardAvoidingView` resolves against the sheet itself, and the body shrinks under the footer (the weight keypad and guest-count sheets were cut off).
  - Give the `Modal` `navigationBarTranslucent` (and `statusBarTranslucent`). The sheet then draws behind the navigation bar and `paddingBottom: Math.max(insets.bottom, 16)` doesn't leave a double gap.
  - **Copy `waiter/src/components/BottomSheet.tsx`, don't rewrite it.**
- **Theme toggle from day one.** `userInterfaceStyle: 'automatic'` follows the phone, and many waiters' phones are in dark mode with no idea how to change it.
  - Add a System / Light / Dark segmented control on the settings or connect screen (`theme/preference.tsx`).
  - It calls `Appearance.setColorScheme('light' | 'dark' | 'unspecified')`, which every `useColorScheme()` in the app then follows, and stores the choice.
- **Check both themes and both languages** on every screen. Russian strings are about 30 % longer.

---

## 5. Development loop

```powershell
cd <app>
npm run check                 # tsc + eslint + jest; run before saying "done"
npm run android               # expo run:android: debug build into the running emulator / USB phone
npm start                     # Metro for an already-installed dev build
```

- **Reaching the PC from the emulator:** use `10.0.2.2:<port>`. The emulator camera can't read a real QR, so add manual entry for anything you scan.
- **Screenshots:**
  ```powershell
  adb exec-out screencap -p > shot.png
  ```
  Look at every screenshot next to the design frame before calling a screen done.
- **Test against real data, never the live database.** Point the server at a **scratch copy** of the data. For the till: `SAVDOCHEF_USER_DATA=<scratch>`, plus `SAVDOCHEF_LAN_WAITERS=<n>` (dev-only phone allowance; ignored in a packaged till).
- **Tests to write:** the API client (headers, session renewal, 401, error mapping, with fetch mocked), pairing and parsing, the strings test, and pure helpers (money, cart). Logic goes in `lib/` or `api/` so it can be tested without rendering.

---

## 6. Building the APK

```powershell
cd <app>
node scripts/build-apk.mjs --debug-signed   # test build (debug key), any phone or emulator
node scripts/build-apk.mjs                  # release build, needs the release key env vars
```

The script runs a clean `expo prebuild --platform android --clean --no-install`, then Gradle `assembleRelease`. It copies the result to `dist/<Name>-<version>[-debug-signed].apk`, writes a `.sha256` next to it, and, for a release, writes `version.json` for the update feed. It doesn't upload anything.

> **Lesson: PowerShell drops the flag.** `npm run apk -- --debug-signed` loses `--debug-signed` in PowerShell, and the script then asks for the release key. Call `node scripts/build-apk.mjs ...` directly.

> **Lesson: `gradlew.bat` not found.** With `NoDefaultCurrentDirectoryInExePath` set, a bare `gradlew.bat` is not found. The script runs `.\gradlew.bat` (or `./gradlew` elsewhere). Keep that.

> **Lesson: "App not installed" on the phone.** A build made for the emulator (`npm run android`, or `-PreactNativeArchitectures=x86_64`) contains only `lib/x86_64`. An ARM phone refuses it with just "App not installed".
> - Always give phones the APK from `build-apk.mjs`, which builds every ABI.
> - Before sending it, check it contains `lib/arm64-v8a`:
>   ```powershell
>   tar -tf dist\<file>.apk | Select-String "lib/"
>   ```
> - Other causes of the same message: an older install signed with a different key (uninstall it first), or a versionCode lower than the installed one.

### Release signing (one key per app, forever)
- **Make the key once, outside the repo**, and keep a backup somewhere safe (not on this PC only):
  ```powershell
  keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 `
    -keystore $env:USERPROFILE\.savdochef\<app>-release.keystore -alias <app>
  ```
- **Passwords come only from environment variables:** `<APP>_KEYSTORE`, `<APP>_KEYSTORE_PASSWORD`, `<APP>_KEY_ALIAS`, `<APP>_KEY_PASSWORD`. `with-release-signing.js` reads them from Gradle, and nothing secret is written to `android/`.
- **Without the key** the release build falls back to the debug key, and `build-apk.mjs` refuses to call it a release.
- **Losing the key** means no phone can install an update. Every user has to uninstall and set the app up again.

---

## 7. Testing on a real phone

1. **Install:** copy the APK to the phone (USB, Telegram or similar) and allow "install unknown apps" for the app that opens it. Or, with USB debugging on: `adb install -r dist\<file>.apk`.
2. **Same network:** the phone and the PC must be on the same Wi-Fi, and Windows Firewall must allow the server's port (5180 for the till) on private networks.
3. **Phone can't reach the server** (the app says "not found"):
   1. Open `http://<pc-ip>:<port>` in the phone's Chrome. That separates a network problem from an app problem.
   2. Check the phone's **Wi-Fi proxy** (Wi-Fi → network → Proxy). A manual proxy also catches the app's requests; Chrome shows `ERR_PROXY_CONNECTION_FAILED`. Our test phone had one at 192.168.1.111:8080.
   3. Check that the server-side allowance isn't 0. On the till, a real licence allows phones only once posgro sends `waiterDevices`; in dev, use `SAVDOCHEF_LAN_WAITERS`.
4. **Walk every screen** in light and dark, uz and ru. Then: QR scan with the real camera, the Wi-Fi dropping and coming back, the server stopping, and installing a newer version over an older one.

---

## 8. Self-update

Copy `waiter/src/lib/update.ts` and the Update screen:
- **Feed:** `https://panel.posgro.uz/releases/<app>/version.json` (`version`, `url`, `sha256`, `size`, `notes`).
- **Checks:** the APK URL must match a fixed `https://panel.posgro.uz/releases/<app>/*.apk` pattern, and the download's sha256 is checked before Android's installer is opened (`expo-intent-launcher`). This needs the `REQUEST_INSTALL_PACKAGES` permission.
- **Only on the user's request,** from the Update screen; nothing runs in the background.
- **Testing:** a dev build may read another feed through `EXPO_PUBLIC_<APP>_FEED` (a local server on the PC). A release build only knows the panel.
- **Server folder:** `/home/bobur/releases/<app>/` on `posgro-vps`. Uploading is a separate, deliberate step, done only when asked.

---

## 9. Release checklist

- [ ] Bump `version` in `package.json` (x.y.z, minor and patch below 100).
- [ ] `npm run check` passes.
- [ ] Release key env vars are set. Then run `node scripts/build-apk.mjs`.
- [ ] The APK has `lib/arm64-v8a` and `lib/armeabi-v7a`.
- [ ] It installs **over the previous release** on a real phone: same key, higher versionCode.
- [ ] Smoke test on the phone: light and dark, uz and ru, the main flow, offline and back.
- [ ] Fill in the `version.json` notes (uz and ru). Upload the APK, then `version.json`, only when asked.
- [ ] The backend side, if any (plans, licences, billing in posgro), is deployed **before** phones need it. Production deploys from `main` at 23:00 Tashkent.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Filename longer than 260 characters` in the native build | CMake 3.22.1's ninja | `cmake;3.31.6` + `plugins/with-cmake-version.js` |
| Phone: "App not installed" | x86_64-only emulator build, a different signing key, or a lower versionCode | `build-apk.mjs` build, check `lib/arm64-v8a`, uninstall the old one |
| Build script asks for the release key with `--debug-signed` | PowerShell dropped the flag | `node scripts/build-apk.mjs --debug-signed` |
| `'gradlew.bat' is not recognized` | `NoDefaultCurrentDirectoryInExePath` | `.\gradlew.bat` |
| `expo install --check` says pins are outdated | It compares against the newest SDK patch online | Ignore; pin transitive packages with `overrides` |
| Metro can't resolve a package imported from shared code | Bare import resolved from the parent repo's `node_modules` | Re-root bare imports from the shared folder only (§3.5) |
| Jest can't find `zod` / `decimal.js` / `@babel/runtime` from shared code | Same | `moduleNameMapper` to the app's `node_modules` |
| Phone can't reach the server, Chrome shows `ERR_PROXY_CONNECTION_FAILED` | Manual Wi-Fi proxy on the phone | Remove the proxy |
| Sheet content cut off under its footer | Percentage `maxHeight` | Pixels from `useWindowDimensions` |
| Double gap or overlap at the bottom | Navigation bar inset counted twice or not at all | `navigationBarTranslucent` on the `Modal`; `insets.bottom` on bottom panels |
| App stuck in dark mode | `userInterfaceStyle: automatic` follows the phone | In-app theme toggle (`Appearance.setColorScheme`) |

---

## 11. For each new app, decide up front

- Name, slug and `android.package` (`uz.savdochef.<app>` / `uz.posgro.<app>`). The package id can never change after the first install.
- Its own keystore, env var prefix and feed folder.
- Which permissions it needs; block the rest.
- LAN (cleartext, pairing) or internet (HTTPS only)? If LAN with secrets on the wire, decide on TLS or a staff-only network now. The waiter app's plain HTTP is still an open question.
- Which shared code it imports from the parent product, if any.
- What the server/backend must ship first (licence fields, plan limits, billing), and in which order.
