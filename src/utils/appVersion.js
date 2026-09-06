import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { normalizeAdminVersion } = require('../../electron/versionUtils.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let cachedVersion = '';

export function getAppVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const metaPath = path.join(projectRoot, 'electron', 'buildMeta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const fromMeta = normalizeAdminVersion(meta.version || '');
      if (fromMeta && fromMeta !== '0.0.0') {
        cachedVersion = fromMeta;
        return cachedVersion;
      }
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    cachedVersion = normalizeAdminVersion(pkg.version || '0.0.0');
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}
