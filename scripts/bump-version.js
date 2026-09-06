/**
 * Bump Local package version for silent or noted releases.
 *
 *   node scripts/bump-version.js --silent
 *   node scripts/bump-version.js --noted
 *   node scripts/bump-version.js --noted --level minor
 *
 * Silent: 1.0.32 → 1.0.32.1 → 1.0.32.2 (no patch notes)
 * Noted:  1.0.32.2 → 1.0.33 (strip .N, bump base)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  bumpSilent,
  bumpNoted,
  parseAdminVersion,
  normalizeAdminVersion,
} = require('../electron/versionUtils.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const PATCH_NOTES = path.join(ROOT, 'frontend', 'src', 'lib', 'patchNotes.js');

function parseArgs(argv) {
  const out = { silent: false, noted: false, level: 'patch', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--silent') out.silent = true;
    else if (arg === '--noted') out.noted = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--level' && argv[i + 1]) out.level = argv[++i];
    else if (arg.startsWith('--level=')) out.level = arg.slice('--level='.length);
  }
  return out;
}

function updateLockVersion(next) {
  if (!fs.existsSync(LOCK_PATH)) return;
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

function updatePatchNotesCurrentConstant(next, { noted }) {
  if (!fs.existsSync(PATCH_NOTES)) return;
  let text = fs.readFileSync(PATCH_NOTES, 'utf8');
  // Only advance CURRENT_APP_VERSION on noted releases (user-facing notes).
  if (!noted) return;
  if (!/export const CURRENT_APP_VERSION = '[^']+'/.test(text)) return;
  text = text.replace(
    /export const CURRENT_APP_VERSION = '[^']+'/,
    `export const CURRENT_APP_VERSION = '${next}'`
  );
  fs.writeFileSync(PATCH_NOTES, text, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.silent === args.noted) {
    console.error('Specify exactly one of --silent or --noted');
    process.exit(2);
  }
  if (!['patch', 'minor', 'major'].includes(args.level)) {
    console.error('--level must be patch, minor, or major');
    process.exit(2);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const current = normalizeAdminVersion(pkg.version);
  const next = args.silent ? bumpSilent(current) : bumpNoted(current, args.level);
  const parsed = parseAdminVersion(next);

  console.log(`[bump] ${current} → ${next} (${args.silent ? 'silent' : `noted ${args.level}`})`);
  if (args.dryRun) return;

  pkg.version = next;
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  updateLockVersion(next);
  updatePatchNotesCurrentConstant(next, { noted: args.noted });

  if (args.silent) {
    console.log(`[bump] Silent build #${parsed.silent} — no patch notes.`);
  } else {
    console.log('[bump] Noted release — add patch notes if needed, then build/publish.');
  }
}

main();
