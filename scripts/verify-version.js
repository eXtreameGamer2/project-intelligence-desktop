/**
 * Verify Admin/Local version consistency (dotted app form vs -sN feed form).
 *
 *   node scripts/verify-version.js
 *   node scripts/verify-version.js --github
 *   node scripts/verify-version.js --github --expect-previous
 *
 * Exit 0 = Pass. Exit 1 = Fail (print mismatches only — no secrets).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  normalizeAdminVersion,
  parseAdminVersion,
  toElectronBuilderVersion,
  compareVersions,
} = require('../electron/versionUtils.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const META_PATH = path.join(ROOT, 'electron', 'buildMeta.json');
const RELEASE_DIR = path.join(ROOT, 'release');

function parseArgs(argv) {
  return {
    github: argv.includes('--github'),
    expectPrevious: argv.includes('--expect-previous'),
  };
}

function fail(messages) {
  console.error('[version:verify] FAIL');
  for (const message of messages) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

function pass(lines) {
  console.log('[version:verify] PASS');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function setupAssetName(product, appVersion) {
  if (product === 'admin') {
    return `Project-Intelligence-ADMIN-Setup-${appVersion}.exe`;
  }
  return `Project-Intelligence-Local-Setup-${appVersion}.exe`;
}

function detectProduct(pkg) {
  const name = String(pkg.name || '');
  if (name.includes('admin')) return 'admin';
  return 'local';
}

function ghJson(args) {
  const result = spawnSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || '').trim() || 'gh failed' };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout || 'null') };
  } catch {
    return { ok: false, error: 'gh returned invalid JSON' };
  }
}

function readLocalLatestYml() {
  const latestPath = path.join(RELEASE_DIR, 'latest.yml');
  if (!fs.existsSync(latestPath)) return null;
  const text = fs.readFileSync(latestPath, 'utf8');
  const version = text.match(/^\s*version:\s*['"]?([^\s'"#]+)/m)?.[1]?.trim() || '';
  const fileName =
    text.match(/^\s*path:\s*['"]?([^\r\n#'"]+)/m)?.[1]?.trim() ||
    text.match(/^\s*-\s*url:\s*['"]?([^\r\n#'"]+)/m)?.[1]?.trim() ||
    '';
  return { version, fileName, source: latestPath };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const notes = [];

  if (!fs.existsSync(PKG_PATH)) {
    fail(['package.json missing']);
  }

  const pkg = readJson(PKG_PATH);
  const product = detectProduct(pkg);
  const appVersion = normalizeAdminVersion(pkg.version);
  const feedVersion = toElectronBuilderVersion(appVersion);
  const tag = `v${appVersion}`;
  const expectedSetup = setupAssetName(product, appVersion);

  notes.push(`product=${product}`);
  notes.push(`app=${appVersion}`);
  notes.push(`feed=${feedVersion}`);
  notes.push(`tag=${tag}`);

  if (normalizeAdminVersion(pkg.version) !== appVersion) {
    errors.push(`package.json version "${pkg.version}" does not normalize cleanly to ${appVersion}`);
  }

  if (fs.existsSync(LOCK_PATH)) {
    const lock = readJson(LOCK_PATH);
    const lockVersion = normalizeAdminVersion(lock.version || lock.packages?.['']?.version || '');
    if (lockVersion !== appVersion) {
      errors.push(`package-lock.json version "${lock.version}" ≠ package.json ${appVersion}`);
    }
  } else {
    errors.push('package-lock.json missing');
  }

  if (fs.existsSync(META_PATH)) {
    const meta = readJson(META_PATH);
    const metaVersion = normalizeAdminVersion(meta.version || '');
    if (metaVersion !== appVersion) {
      errors.push(`electron/buildMeta.json version "${meta.version}" ≠ package.json ${appVersion}`);
    }
  } else {
    notes.push('buildMeta.json absent (ok before first stamp)');
  }

  const localLatest = readLocalLatestYml();
  if (localLatest?.version) {
    const latestApp = normalizeAdminVersion(localLatest.version);
    if (latestApp !== appVersion) {
      errors.push(
        `release/latest.yml version "${localLatest.version}" (app ${latestApp}) ≠ package.json ${appVersion}`,
      );
    }
    if (localLatest.version !== feedVersion && localLatest.version !== appVersion) {
      errors.push(
        `release/latest.yml version "${localLatest.version}" should be feed form ${feedVersion} (or dotted ${appVersion} only during migration)`,
      );
    }
    // Prefer feed form going forward
    if (parseAdminVersion(appVersion).silent > 0 && localLatest.version === appVersion) {
      errors.push(
        `release/latest.yml uses dotted silent "${appVersion}"; expected electron-updater feed "${feedVersion}"`,
      );
    }
    if (localLatest.fileName && localLatest.fileName !== expectedSetup) {
      errors.push(`release/latest.yml path/url "${localLatest.fileName}" ≠ expected ${expectedSetup}`);
    }
  }

  if (args.github) {
    const ownerRepo =
      String(pkg.repository?.url || '')
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .match(/github\.com[/:]([^/]+\/[^/]+)/i)?.[1] || null;

    if (!ownerRepo) {
      errors.push('Cannot resolve GitHub owner/repo from package.json repository.url');
    } else {
      const release = ghJson([
        'release',
        'view',
        tag,
        '--repo',
        ownerRepo,
        '--json',
        'tagName,name,assets',
      ]);
      if (!release.ok) {
        errors.push(`GitHub release ${tag} missing or unreadable (${release.error})`);
      } else {
        const assets = Array.isArray(release.data?.assets)
          ? release.data.assets.map((asset) => asset.name)
          : [];
        if (!assets.includes(expectedSetup)) {
          errors.push(`GitHub release ${tag} missing asset ${expectedSetup} (has: ${assets.join(', ') || 'none'})`);
        }
        if (!assets.includes('latest.yml')) {
          errors.push(`GitHub release ${tag} missing latest.yml`);
        } else {
          const dl = spawnSync(
            'gh',
            ['release', 'download', tag, '--repo', ownerRepo, '-p', 'latest.yml', '-O', '-'],
            { cwd: ROOT, encoding: 'utf8' },
          );
          if (dl.status !== 0) {
            errors.push(`Could not download latest.yml from ${tag}`);
          } else {
            const version = dl.stdout.match(/^\s*version:\s*['"]?([^\s'"#]+)/m)?.[1]?.trim() || '';
            const fileName =
              dl.stdout.match(/^\s*path:\s*['"]?([^\r\n#'"]+)/m)?.[1]?.trim() ||
              dl.stdout.match(/^\s*-\s*url:\s*['"]?([^\r\n#'"]+)/m)?.[1]?.trim() ||
              '';
            const feedApp = normalizeAdminVersion(version);
            if (feedApp !== appVersion) {
              errors.push(`GitHub latest.yml version "${version}" ≠ app ${appVersion}`);
            }
            if (parseAdminVersion(appVersion).silent > 0 && version !== feedVersion) {
              errors.push(`GitHub latest.yml version "${version}" ≠ expected feed ${feedVersion}`);
            }
            if (fileName && fileName !== expectedSetup) {
              errors.push(`GitHub latest.yml path/url "${fileName}" ≠ ${expectedSetup}`);
            }
          }
        }
      }

      if (args.expectPrevious) {
        const list = ghJson([
          'release',
          'list',
          '--repo',
          ownerRepo,
          '-L',
          '20',
          '--json',
          'tagName,isLatest,publishedAt',
        ]);
        if (!list.ok) {
          errors.push(`Could not list releases for previous-version check (${list.error})`);
        } else {
          const tags = (list.data || [])
            .map((row) => normalizeAdminVersion(String(row.tagName || '').replace(/^v/i, '')))
            .filter(Boolean);
          const others = tags.filter((value) => value !== appVersion);
          const previous = others.sort((a, b) => compareVersions(b, a))[0];
          if (!previous) {
            notes.push('no previous release to compare (first ship ok)');
          } else {
            notes.push(`previous=${previous}`);
            const cur = parseAdminVersion(appVersion);
            const prev = parseAdminVersion(previous);
            if (cur.silent > 0) {
              const expectedPrevSilent = cur.silent - 1;
              const sameBase =
                prev.major === cur.major && prev.minor === cur.minor && prev.patch === cur.patch;
              if (!sameBase || prev.silent !== expectedPrevSilent) {
                // Allow noted base then first silent .1 from base with silent 0
                const okFromBase =
                  expectedPrevSilent === 0 &&
                  sameBase &&
                  prev.silent === 0 &&
                  cur.silent === 1;
                if (!okFromBase) {
                  errors.push(
                    `Silent bump looks wrong: now ${appVersion}, previous ${previous} (expected same base with silent ${expectedPrevSilent}, or base→.1)`,
                  );
                }
              }
            } else if (compareVersions(appVersion, previous) <= 0) {
              errors.push(`Noted/base version ${appVersion} is not greater than previous ${previous}`);
            }
          }
        }
      }
    }
  }

  if (errors.length) fail(errors);
  pass(notes);
}

main();
