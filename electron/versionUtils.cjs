/**
 * Local app version helpers (same scheme as Admin).
 * Base: MAJOR.MINOR.PATCH (e.g. 1.0.32)
 * Silent: MAJOR.MINOR.PATCH.SILENT (e.g. 1.0.32.1, 1.0.32.2)
 * Noted bump: strip silent suffix, then bump patch/minor/major.
 *
 * Electron-builder requires semver — pack maps 1.0.32.2 ↔ 1.0.32-s2.
 */

function stripPrefix(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '');
}

/** Normalize tags like 1.0.32-s2 or 1.0.32.2 → dotted app form. */
function normalizeAdminVersion(value) {
  const raw = stripPrefix(value);
  const asSilentPrerelease = raw.match(/^(\d+)\.(\d+)\.(\d+)-s(\d+)$/i);
  if (asSilentPrerelease) {
    return `${asSilentPrerelease[1]}.${asSilentPrerelease[2]}.${asSilentPrerelease[3]}.${asSilentPrerelease[4]}`;
  }
  const core = raw.split(/[+-]/, 1)[0];
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return '0.0.0';
  }
  while (parts.length < 3) parts.push(0);
  if (parts.length === 3) return parts.join('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3] || 0}`;
}

function parseAdminVersion(value) {
  const normalized = normalizeAdminVersion(value);
  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    silent: parts[3] || 0,
    normalized:
      (parts[3] || 0) > 0
        ? `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`
        : `${parts[0]}.${parts[1]}.${parts[2]}`,
  };
}

function formatAdminVersion({ major, minor, patch, silent }) {
  if (silent > 0) return `${major}.${minor}.${patch}.${silent}`;
  return `${major}.${minor}.${patch}`;
}

function compareVersions(left, right) {
  const a = parseAdminVersion(left);
  const b = parseAdminVersion(right);
  const leftParts = [a.major, a.minor, a.patch, a.silent];
  const rightParts = [b.major, b.minor, b.patch, b.silent];
  for (let i = 0; i < 4; i += 1) {
    const delta = leftParts[i] - rightParts[i];
    if (delta > 0) return 1;
    if (delta < 0) return -1;
  }
  return 0;
}

function bumpSilent(current) {
  const parsed = parseAdminVersion(current);
  return formatAdminVersion({
    ...parsed,
    silent: (parsed.silent || 0) + 1,
  });
}

function bumpNoted(current, level = 'patch') {
  const parsed = parseAdminVersion(current);
  let { major, minor, patch } = parsed;
  if (level === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return formatAdminVersion({ major, minor, patch, silent: 0 });
}

/** Semver form electron-builder accepts: 1.0.32 or 1.0.32-s2 */
function toElectronBuilderVersion(adminVersion) {
  const parsed = parseAdminVersion(adminVersion);
  if (parsed.silent > 0) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-s${parsed.silent}`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function isSilentVersion(value) {
  return parseAdminVersion(value).silent > 0;
}

module.exports = {
  normalizeAdminVersion,
  parseAdminVersion,
  formatAdminVersion,
  compareVersions,
  bumpSilent,
  bumpNoted,
  toElectronBuilderVersion,
  isSilentVersion,
};
