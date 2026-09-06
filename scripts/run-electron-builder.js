/**
 * Run electron-builder with a semver-safe package version while keeping
 * dotted silent versions (1.0.32.2) in buildMeta + restored package.json.
 *
 * Usage: node scripts/run-electron-builder.js --win nsis
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { normalizeAdminVersion, toElectronBuilderVersion } = require('../electron/versionUtils.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

function main() {
  const builderArgs = process.argv.slice(2);
  const pkgRaw = fs.readFileSync(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const appVersion = normalizeAdminVersion(pkg.version);
  const electronVersion = toElectronBuilderVersion(appVersion);

  pkg.version = electronVersion;
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`[pack] electron-builder version ${electronVersion} (app ${appVersion})`);

  let status = 1;
  try {
    const isWin = process.platform === 'win32';
    const result = spawnSync(
      isWin ? 'npx.cmd' : 'npx',
      ['electron-builder', ...builderArgs],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, LOCAL_APP_VERSION: appVersion },
        shell: isWin,
      }
    );
    if (result.error) {
      console.error('[pack]', result.error.message);
    }
    status = result.status ?? 1;
  } finally {
    const restore = JSON.parse(pkgRaw);
    restore.version = appVersion;
    fs.writeFileSync(PKG_PATH, `${JSON.stringify(restore, null, 2)}\n`, 'utf8');
    console.log(`[pack] restored package.json version ${appVersion}`);
  }

  process.exit(status);
}

main();
