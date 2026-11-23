// Metro for the waiter app: `@shared/*` is the till's src/shared (zod, decimal.js and plain TS
// only), so the phone prices lines, checks stock and validates the pairing QR with the till's
// own code. Packages imported from src/shared resolve from waiter/node_modules, never from the
// till's (they sit higher up in the folder tree); everything else resolves as usual.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = __dirname;
const shared = path.resolve(root, '..', 'src', 'shared');

const config = getDefaultConfig(root);
config.watchFolders = [shared];

const isBare = (name) => !name.startsWith('.') && !path.isAbsolute(name);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName.startsWith('@shared/')) {
    const target = path.join(shared, moduleName.slice('@shared/'.length));
    return resolve(context, target, platform);
  }
  if (isBare(moduleName) && context.originModulePath.startsWith(shared + path.sep)) {
    // As if imported from the app's own entry file: waiter/node_modules.
    return resolve({ ...context, originModulePath: path.join(root, 'index.ts') }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
