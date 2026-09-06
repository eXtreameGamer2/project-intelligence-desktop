import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { normalizeAdminVersion } = require('../electron/versionUtils.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outPath = path.join(root, 'electron', 'buildMeta.json');

const meta = {
  version: normalizeAdminVersion(pkg.version || '0.0.0'),
  stampedAt: new Date().toISOString(),
};

fs.writeFileSync(outPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outPath)} (${meta.version} @ ${meta.stampedAt})`);
