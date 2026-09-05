/**
 * Defensive threat-intel refresh for Project Intelligence.
 *
 * Queries OSV for lockfile packages (and optional package names) and writes
 * markdown suitable for the security-audit skill database.
 *
 * NEVER writes exploit PoCs, payloads, or attack steps — advisories +
 * mitigation/upgrade guidance only.
 *
 * Usage:
 *   node scripts/refresh-threat-intel.js
 *   node scripts/refresh-threat-intel.js --out docs/security-threat-intel.md
 *   node scripts/refresh-threat-intel.js --lockfile package-lock.json --ecosystem npm
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OSV_QUERY = 'https://api.osv.dev/v1/query';
const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';
const TIMEOUT_MS = 20_000;
const MAX_PACKAGES = 80;

const STACK_WATCH = [
  { name: 'express', ecosystem: 'npm' },
  { name: 'multer', ecosystem: 'npm' },
  { name: 'cors', ecosystem: 'npm' },
  { name: '@supabase/supabase-js', ecosystem: 'npm' },
  { name: '@prisma/client', ecosystem: 'npm' },
  { name: 'prisma', ecosystem: 'npm' },
  { name: 'xlsx', ecosystem: 'npm' },
  { name: 'pdf-parse', ecosystem: 'npm' },
  { name: 'electron', ecosystem: 'npm' },
];

function parseArgs(argv) {
  const out = {
    out: '',
    lockfile: path.join(ROOT, 'package-lock.json'),
    ecosystem: 'npm',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' && argv[i + 1]) out.out = argv[++i];
    else if (arg.startsWith('--out=')) out.out = arg.slice('--out='.length);
    else if (arg === '--lockfile' && argv[i + 1]) out.lockfile = path.resolve(argv[++i]);
    else if (arg.startsWith('--lockfile=')) out.lockfile = path.resolve(arg.slice('--lockfile='.length));
  }
  return out;
}

async function fetchJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OSV HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function readLockPackages(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) return [];
  const raw = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const pkgs = [];
  if (raw.packages && typeof raw.packages === 'object') {
    for (const [key, meta] of Object.entries(raw.packages)) {
      if (!key || key === '') continue;
      const name = key.startsWith('node_modules/')
        ? key.slice('node_modules/'.length)
        : key;
      if (!name || name.includes('node_modules/')) continue;
      if (!meta?.version) continue;
      pkgs.push({ name, version: String(meta.version) });
    }
  } else if (raw.dependencies && typeof raw.dependencies === 'object') {
    for (const [name, meta] of Object.entries(raw.dependencies)) {
      if (meta?.version) pkgs.push({ name, version: String(meta.version) });
    }
  }
  return pkgs;
}

function prioritizePackages(pkgs) {
  const watchNames = new Set(STACK_WATCH.map((p) => p.name));
  const watched = pkgs.filter((p) => watchNames.has(p.name));
  const rest = pkgs.filter((p) => !watchNames.has(p.name));
  const seen = new Set();
  const out = [];
  for (const p of [...watched, ...rest]) {
    const id = `${p.name}@${p.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(p);
    if (out.length >= MAX_PACKAGES) break;
  }
  return out;
}

function severityOf(vuln) {
  const sev = vuln.severity || [];
  if (Array.isArray(sev) && sev.length) {
    const scores = sev
      .map((s) => Number(s.score))
      .filter((n) => Number.isFinite(n));
    if (scores.length) {
      const max = Math.max(...scores);
      if (max >= 9) return 'Critical';
      if (max >= 7) return 'High';
      if (max >= 4) return 'Medium';
      return 'Low';
    }
    const text = sev.map((s) => String(s.type || s).toLowerCase()).join(' ');
    if (text.includes('critical')) return 'Critical';
    if (text.includes('high')) return 'High';
    if (text.includes('medium')) return 'Medium';
    if (text.includes('low')) return 'Low';
  }
  const db = String(vuln.database_specific?.severity || '').toUpperCase();
  if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(db)) {
    return db[0] + db.slice(1).toLowerCase();
  }
  return 'Unknown';
}

function summaryOf(vuln) {
  const raw = String(vuln.summary || vuln.details || 'Advisory').replace(/\s+/g, ' ').trim();
  return raw.slice(0, 220);
}

function aliasesOf(vuln) {
  const ids = [vuln.id, ...(vuln.aliases || [])].filter(Boolean);
  return [...new Set(ids)].slice(0, 6).join(', ');
}

function mitigationOf(vuln, pkg) {
  const ranges = (vuln.affected || [])
    .filter((a) => a.package?.name === pkg.name || !pkg.name)
    .flatMap((a) => a.ranges || []);
  const fixed = [];
  for (const range of ranges) {
    for (const event of range.events || []) {
      if (event.fixed) fixed.push(event.fixed);
    }
  }
  if (fixed.length) {
    return `Upgrade ${pkg.name} to a fixed release (e.g. ${[...new Set(fixed)].slice(0, 3).join(', ')}). Re-run npm audit / lockfile refresh.`;
  }
  return `Review advisory for ${pkg.name}@${pkg.version}; prefer upgrading to a non-affected release and re-verify with npm audit.`;
}

async function queryOsvBatch(packages) {
  const queries = packages.map((p) => ({
    package: { name: p.name, ecosystem: 'npm' },
    version: p.version,
  }));
  const data = await fetchJson(OSV_BATCH, { queries });
  const results = data.results || [];
  const findings = [];
  for (let i = 0; i < results.length; i += 1) {
    const vulns = results[i]?.vulns || [];
    const pkg = packages[i];
    for (const stub of vulns) {
      findings.push({ pkg, vuln: stub });
    }
  }
  return findings;
}

async function fetchVuln(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) return null;
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function enrichFindings(rawFindings) {
  const out = [];
  const seen = new Set();
  for (const item of rawFindings) {
    const id = item.vuln?.id || `${item.pkg.name}@${item.pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let vuln = item.vuln;
    if (vuln?.id && !vuln.summary) {
      const full = await fetchVuln(vuln.id);
      if (full) vuln = full;
    }
    out.push({ pkg: item.pkg, vuln });
  }
  return out;
}

function renderMarkdown({ when, packagesChecked, findings, lockfile }) {
  const lines = [];
  lines.push('# Security threat intel (defensive)');
  lines.push('');
  lines.push('Curated advisory database for Project Intelligence security audits.');
  lines.push('**Defensive only** — CVE/GHSA/OSV ids, impact class, and mitigation/upgrade guidance.');
  lines.push('Never store exploit PoCs, payloads, or attack reproduction steps.');
  lines.push('');
  lines.push(`- **Last refreshed:** ${when}`);
  lines.push(`- **Source:** OSV (api.osv.dev) + local lockfile \`${path.relative(ROOT, lockfile).replace(/\\/g, '/') || path.basename(lockfile)}\``);
  lines.push(`- **Packages queried:** ${packagesChecked}`);
  lines.push(`- **Advisories matched:** ${findings.length}`);
  lines.push('');
  lines.push('## Stack watchlist');
  lines.push('');
  for (const p of STACK_WATCH) {
    lines.push(`- \`${p.name}\` (${p.ecosystem})`);
  }
  lines.push('');
  lines.push('## Advisories');
  lines.push('');
  if (!findings.length) {
    lines.push('_No matching OSV advisories for the queried lockfile versions in this refresh._');
    lines.push('');
  } else {
    const order = { Critical: 0, High: 1, Medium: 2, Low: 3, Unknown: 4 };
    const sorted = [...findings].sort(
      (a, b) => (order[severityOf(a.vuln)] ?? 9) - (order[severityOf(b.vuln)] ?? 9),
    );
    for (const { pkg, vuln } of sorted) {
      const sev = severityOf(vuln);
      lines.push(`### ${aliasesOf(vuln) || vuln.id || 'Advisory'}`);
      lines.push('');
      lines.push(`- **Severity:** ${sev}`);
      lines.push(`- **Package:** \`${pkg.name}@${pkg.version}\``);
      lines.push(`- **Summary:** ${summaryOf(vuln)}`);
      lines.push(`- **Mitigation:** ${mitigationOf(vuln, pkg)}`);
      if (vuln.id) {
        lines.push(`- **Reference:** https://osv.dev/vulnerability/${encodeURIComponent(vuln.id)}`);
      }
      lines.push('');
    }
  }
  lines.push('## Refresh');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run security:threat-intel');
  lines.push('```');
  lines.push('');
  lines.push('Weekly Cursor Automation should run the same command and update this file');
  lines.push('(plus the personal skill copy under `~/.cursor/skills/security-audit/threat-intel.md` when available).');
  lines.push('');
  return lines.join('\n');
}

async function queryViaSingle(packages) {
  const findings = [];
  for (const pkg of packages) {
    try {
      const data = await fetchJson(OSV_QUERY, {
        package: { name: pkg.name, ecosystem: 'npm' },
        version: pkg.version,
      });
      for (const vuln of data.vulns || []) {
        findings.push({ pkg, vuln });
      }
    } catch (error) {
      console.warn(`[threat-intel] skip ${pkg.name}@${pkg.version}: ${error.message}`);
    }
  }
  return findings;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillDefault = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.cursor',
    'skills',
    'security-audit',
    'threat-intel.md',
  );
  const repoDefault = path.join(ROOT, 'docs', 'security-threat-intel.md');
  const outPath = path.resolve(args.out || repoDefault);

  const pkgs = prioritizePackages(readLockPackages(args.lockfile));
  console.log(`[threat-intel] querying OSV for ${pkgs.length} package versions…`);

  let findings = [];
  try {
    const batchRaw = await queryOsvBatch(pkgs);
    findings = await enrichFindings(batchRaw);
  } catch (error) {
    console.warn(`[threat-intel] batch failed (${error.message}); falling back to per-package queries`);
    findings = await queryViaSingle(pkgs);
  }

  const when = new Date().toISOString();
  const md = renderMarkdown({
    when,
    packagesChecked: pkgs.length,
    findings,
    lockfile: args.lockfile,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`[threat-intel] wrote ${outPath} (${findings.length} advisories)`);

  // Sync personal skill DB only for the primary (root) refresh, not secondary lockfile passes.
  const isPrimaryOut = !args.out || path.resolve(args.out) === path.resolve(repoDefault);
  if (isPrimaryOut && skillDefault && path.resolve(skillDefault) !== path.resolve(outPath)) {
    try {
      fs.mkdirSync(path.dirname(skillDefault), { recursive: true });
      fs.writeFileSync(skillDefault, md, 'utf8');
      console.log(`[threat-intel] synced skill DB ${skillDefault}`);
    } catch (error) {
      console.warn(`[threat-intel] skill sync skipped: ${error.message}`);
    }
  }

  // Also write frontend lockfile if present (extra pass, merge not needed — second file)
  const frontLock = path.join(ROOT, 'frontend', 'package-lock.json');
  if (fs.existsSync(frontLock) && path.resolve(args.lockfile) !== path.resolve(frontLock)) {
    console.log('[threat-intel] tip: re-run with --lockfile frontend/package-lock.json for UI deps');
  }
}

main().catch((error) => {
  console.error('[threat-intel]', error.message || error);
  process.exit(1);
});
