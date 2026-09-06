/**
 * Publish LIVE Local GitHub release using dotted version tags (v1.0.32.1).
 * Run after electron-builder (which may pack as 1.0.32-s1 for semver).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { normalizeAdminVersion, isSilentVersion } = require('../electron/versionUtils.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');

function sha512Base64(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function findBuiltSetup() {
  const names = fs.readdirSync(RELEASE_DIR);
  const setups = names.filter(
    (name) => /\.exe$/i.test(name) && /setup/i.test(name) && !/__uninstaller/i.test(name)
  );
  const ranked = setups
    .map((name) => {
      const full = path.join(RELEASE_DIR, name);
      return { name, full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return ranked[0] || null;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const appVersion = normalizeAdminVersion(pkg.version);
  const tag = `v${appVersion}`;
  const publishName = `Project-Intelligence-Local-Setup-${appVersion}.exe`;
  const built = findBuiltSetup();
  if (!built) {
    console.error('[publish] No Setup.exe found in release/');
    process.exit(1);
  }

  const target = path.join(RELEASE_DIR, publishName);
  if (path.resolve(built.full) !== path.resolve(target)) {
    fs.copyFileSync(built.full, target);
  }

  const sha = sha512Base64(target);
  const releaseDate = new Date().toISOString();
  const latestPath = path.join(RELEASE_DIR, 'latest.yml');
  fs.writeFileSync(
    latestPath,
    [
      `version: ${appVersion}`,
      'files:',
      `  - url: ${publishName}`,
      `    sha512: ${sha}`,
      `path: ${publishName}`,
      `sha512: ${sha}`,
      `releaseDate: '${releaseDate}'`,
      '',
    ].join('\n'),
    'utf8'
  );

  const notes = isSilentVersion(appVersion) ? '' : '';
  const notesFile = path.join(RELEASE_DIR, '.release-notes.tmp');
  fs.writeFileSync(notesFile, notes, 'utf8');

  spawnSync('gh', ['release', 'delete', tag, '--yes'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const created = spawnSync(
    'gh',
    [
      'release',
      'create',
      tag,
      target,
      latestPath,
      '--title',
      appVersion,
      '--notes-file',
      notesFile,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  try {
    fs.unlinkSync(notesFile);
  } catch {
    // ignore
  }
  if (created.status !== 0) {
    process.exit(created.status || 1);
  }
  console.log(`[publish] ${tag} → ${publishName}`);
}

main();
