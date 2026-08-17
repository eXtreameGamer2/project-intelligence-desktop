export const UPDATE_FEED = {
  owner: 'eXtreameGamer2',
  repo: 'project-intelligence-desktop',
};

export function githubReleasesUrl() {
  return `https://github.com/${UPDATE_FEED.owner}/${UPDATE_FEED.repo}/releases`;
}

export function githubLatestApiUrl() {
  return `https://api.github.com/repos/${UPDATE_FEED.owner}/${UPDATE_FEED.repo}/releases/latest`;
}

export function parseVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/, 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta > 0) return 1;
    if (delta < 0) return -1;
  }
  return 0;
}

export function desktopUpdatesApi() {
  return typeof window !== 'undefined' ? window.desktopUpdates : null;
}

function setupAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const setup = assets.find((asset) => /\.exe$/i.test(asset.name || '') && /setup/i.test(asset.name || ''));
  return setup || assets.find((asset) => /\.exe$/i.test(asset.name || '')) || null;
}

export async function checkAppUpdate(currentVersion) {
  const desktop = desktopUpdatesApi();
  if (desktop?.check) {
    return desktop.check();
  }

  try {
    const response = await fetch(githubLatestApiUrl(), {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      return {
        state: 'current',
        available: false,
        unpublished: true,
        current: currentVersion,
        latest: currentVersion,
        message: 'No published release was found yet.',
      };
    }
    if (!response.ok) {
      throw new Error(`Update check failed (${response.status}).`);
    }
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/i, '');
    const asset = setupAsset(release);
    const available = compareVersions(latest, currentVersion) > 0;
    return {
      state: available ? 'available' : 'current',
      available,
      current: currentVersion,
      latest: latest || currentVersion,
      notes: String(release.body || '').slice(0, 2000),
      downloadUrl: asset?.browser_download_url || release.html_url,
      htmlUrl: release.html_url,
    };
  } catch (error) {
    return {
      state: 'error',
      available: false,
      current: currentVersion,
      message: error?.message || 'Could not check for updates.',
    };
  }
}

export async function downloadAppUpdate(status) {
  const desktop = desktopUpdatesApi();
  if (desktop?.download) return desktop.download();
  await openReleasePage(status?.downloadUrl || status?.htmlUrl);
  return status || { state: 'available' };
}

export async function installAppUpdate() {
  const desktop = desktopUpdatesApi();
  if (desktop?.install) return desktop.install();
  return { state: 'error', message: 'Install the desktop app to apply updates.' };
}

export async function openReleasePage(url) {
  const desktop = desktopUpdatesApi();
  if (desktop?.openReleases) return desktop.openReleases();
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
  else window.open(githubReleasesUrl(), '_blank', 'noopener,noreferrer');
}
