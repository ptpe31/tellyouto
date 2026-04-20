const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

function firebasePackageRoot(moduleName) {
  return path.dirname(require.resolve(`${moduleName}/package.json`, { paths: [projectRoot] }));
}

/**
 * Force les imports `@firebase/<pkg>` vers `dist/index.cjs.js` quand ce fichier existe
 * (évite « Unable to resolve @firebase/util » avec les champs `exports` / Metro).
 */
function firebaseCommonJsEntry(moduleName) {
  if (typeof moduleName !== 'string' || !moduleName.startsWith('@firebase/')) return null;
  const parts = moduleName.split('/');
  if (parts.length !== 2 || !parts[1]) return null;
  try {
    const root = firebasePackageRoot(moduleName);
    const candidate = path.join(root, 'dist', 'index.cjs.js');
    return fs.existsSync(candidate) ? path.normalize(candidate) : null;
  } catch {
    return null;
  }
}

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = firebaseCommonJsEntry(moduleName);
  if (filePath) {
    return { type: 'sourceFile', filePath };
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
