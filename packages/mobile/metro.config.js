const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all packages in the monorepo
config.watchFolders = [workspaceRoot];

// Disable watchman — use Node.js fs.watch instead to avoid EMFILE/stuck issues
config.watcher = {
  ...config.watcher,
  useWatchman: false,
  additionalExts: ['ts', 'tsx'],
};

// Resolve workspace packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Support .ts/.tsx source imports from workspace packages
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];

// Workspace packages use ESM-style .js extensions in TS imports (e.g. `from './channels.js'`).
// Metro doesn't remap these automatically, so we intercept resolution and try .ts/.tsx instead.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.startsWith(workspaceRoot)
  ) {
    const basePath = path.resolve(
      path.dirname(context.originModulePath),
      moduleName.slice(0, -'.js'.length),
    );

    for (const ext of ['.ts', '.tsx']) {
      const candidate = basePath + ext;
      if (fs.existsSync(candidate)) {
        return context.resolveRequest(
          { ...context, originModulePath: context.originModulePath },
          './' + path.basename(basePath) + ext,
          platform,
        );
      }
    }
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
