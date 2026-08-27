const { app, ipcMain } = require('electron');
const https = require('node:https');
const feed = require('./updateFeed.cjs');
const { openSafeExternal } = require('./safeOpen.cjs');

function currentVersion() {
  return String(app.getVersion() || '0.0.0');
}

function parseVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/, 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
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

function githubRequest(pathname) {
  const url = `https://api.github.com${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Project-Intelligence-Local',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 404) {
            resolve({ missing: true, status: 404, body: null });
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Update check failed (${res.statusCode}).`));
            return;
          }
          try {
            resolve({ missing: false, status: res.statusCode, body: JSON.parse(body) });
          } catch {
            reject(new Error('Update check returned an invalid response.'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Update check timed out.'));
    });
  });
}

function setupAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const setup = assets.find((asset) => /\.exe$/i.test(asset.name || '') && /setup/i.test(asset.name || ''));
  return setup || assets.find((asset) => /\.exe$/i.test(asset.name || '')) || null;
}

function releaseNotes(release) {
  const body = String(release?.body || '').trim();
  return body.slice(0, 2000);
}

async function latestFromGithub() {
  const path = `/repos/${feed.owner}/${feed.repo}/releases/latest`;
  const result = await githubRequest(path);
  if (result.missing || !result.body?.tag_name) {
    return {
      available: false,
      unpublished: true,
      current: currentVersion(),
      latest: currentVersion(),
      notes: '',
      downloadUrl: `https://github.com/${feed.owner}/${feed.repo}/releases`,
    };
  }

  const latest = String(result.body.tag_name || '').replace(/^v/i, '');
  const asset = setupAsset(result.body);
  const available = compareVersions(latest, currentVersion()) > 0;
  return {
    available,
    unpublished: false,
    current: currentVersion(),
    latest,
    notes: releaseNotes(result.body),
    downloadUrl: asset?.browser_download_url || result.body.html_url,
    htmlUrl: result.body.html_url,
  };
}

function statusPayload(state, extra = {}) {
  return {
    state,
    current: currentVersion(),
    packaged: app.isPackaged,
    ...extra,
  };
}

let updaterWindow = null;
let updaterHandlersBound = false;

function attachUpdater(mainWindow) {
  updaterWindow = mainWindow;
  let autoUpdater = null;
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
  } catch {
    autoUpdater = null;
  }

  const send = (payload) => {
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('updates:status', payload);
    }
  };

  if (updaterHandlersBound) return;
  updaterHandlersBound = true;

  if (autoUpdater) {
    autoUpdater.on('checking-for-update', () => {
      send(statusPayload('checking'));
    });
    autoUpdater.on('update-available', (info) => {
      send(
        statusPayload('available', {
          available: true,
          latest: info?.version,
          notes: String(info?.releaseNotes || ''),
        })
      );
    });
    autoUpdater.on('update-not-available', () => {
      send(statusPayload('current', { available: false, latest: currentVersion() }));
    });
    autoUpdater.on('download-progress', (progress) => {
      send(
        statusPayload('downloading', {
          available: true,
          percent: Math.round(Number(progress?.percent) || 0),
        })
      );
    });
    autoUpdater.on('update-downloaded', (info) => {
      send(
        statusPayload('ready', {
          available: true,
          latest: info?.version,
        })
      );
    });
    autoUpdater.on('error', (error) => {
      send(statusPayload('error', { message: error?.message || 'Update failed.' }));
    });
  }

  ipcMain.handle('updates:version', () => currentVersion());

  ipcMain.handle('updates:check', async () => {
    send(statusPayload('checking'));
    try {
      if (app.isPackaged && autoUpdater) {
        try {
          const result = await autoUpdater.checkForUpdates();
          const latest = result?.updateInfo?.version;
          if (latest && compareVersions(latest, currentVersion()) > 0) {
            const payload = statusPayload('available', {
              available: true,
              latest,
              notes: String(result.updateInfo.releaseNotes || ''),
            });
            send(payload);
            return payload;
          }
        } catch {
          // latest.yml may be missing; GitHub releases are the fallback.
        }
      }

      const github = await latestFromGithub();
      const payload = github.unpublished
        ? statusPayload('current', {
            available: false,
            latest: github.current,
            unpublished: true,
            message: 'No published release was found yet.',
          })
        : github.available
          ? statusPayload('available', github)
          : statusPayload('current', github);
      send(payload);
      return payload;
    } catch (error) {
      const payload = statusPayload('error', {
        message: error?.message || 'Could not check for updates.',
      });
      send(payload);
      return payload;
    }
  });

  ipcMain.handle('updates:download', async () => {
    try {
      if (app.isPackaged && autoUpdater) {
        send(statusPayload('downloading', { available: true, percent: 0 }));
        await autoUpdater.downloadUpdate();
        return statusPayload('ready', { available: true });
      }
      const github = await latestFromGithub();
      if (github.downloadUrl) {
        await openSafeExternal(github.downloadUrl);
      }
      return statusPayload(github.available ? 'available' : 'current', github);
    } catch (error) {
      const payload = statusPayload('error', {
        message: error?.message || 'Could not download the update.',
      });
      send(payload);
      return payload;
    }
  });

  ipcMain.handle('updates:install', async () => {
    if (app.isPackaged && autoUpdater) {
      autoUpdater.quitAndInstall(false, true);
      return statusPayload('installing');
    }
    const github = await latestFromGithub();
    if (github.downloadUrl) {
      await openSafeExternal(github.downloadUrl);
    }
    return statusPayload('available', github);
  });

  ipcMain.handle('updates:open-page', async () => {
    const url = `https://github.com/${feed.owner}/${feed.repo}/releases`;
    await openSafeExternal(url);
    return { ok: true, url };
  });
}

module.exports = { attachUpdater, currentVersion };
