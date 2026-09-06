const { app, ipcMain } = require('electron');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const feed = require('./updateFeed.cjs');
const { openSafeExternal } = require('./safeOpen.cjs');
const { normalizeAdminVersion, compareVersions } = require('./versionUtils.cjs');

function currentVersion() {
  try {
    const file = path.join(__dirname, 'buildMeta.json');
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const metaVersion = String(raw.version || '').trim();
      if (metaVersion && metaVersion !== '0.0.0') {
        return normalizeAdminVersion(metaVersion);
      }
    }
  } catch {
    // Fall through to Electron package version.
  }
  return normalizeAdminVersion(app.getVersion() || '0.0.0');
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

function downloadUrlToFile(url, targetPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!url || !/^https?:\/\//i.test(url)) {
      reject(new Error('Installer download URL is missing or invalid.'));
      return;
    }
    const transport = url.startsWith('https:') ? https : http;
    const req = transport.get(
      url,
      {
        headers: { 'User-Agent': 'Project-Intelligence-Local' },
      },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects downloading the installer.'));
            return;
          }
          downloadUrlToFile(res.headers.location, targetPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status >= 400) {
          res.resume();
          reject(new Error(`Could not download the installer (${status}).`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            fs.writeFileSync(targetPath, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
            resolve(targetPath);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error('Installer download timed out.'));
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
  const apiPath = `/repos/${feed.owner}/${feed.repo}/releases/latest`;
  const result = await githubRequest(apiPath);
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

  const latest = normalizeAdminVersion(String(result.body.tag_name || '').replace(/^v/i, ''));
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
    assetName: asset?.name || '',
  };
}

async function downloadGithubSetup(github) {
  const downloadUrl = String(github?.downloadUrl || '').trim();
  if (!downloadUrl || !/\.exe(\?|$)/i.test(downloadUrl)) {
    if (github?.htmlUrl) await openSafeExternal(github.htmlUrl);
    throw new Error('No Setup.exe download URL was found on the latest release.');
  }
  const safeName = String(github.assetName || `Project-Intelligence-Local-Setup-${github.latest || 'update'}.exe`)
    .replace(/[^\w.\- ()]/g, '_')
    .slice(0, 180);
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-local-setup-'));
  const target = path.join(stagingDir, safeName);
  try {
    await downloadUrlToFile(downloadUrl, target);
    return target;
  } catch (error) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

function launchSetup(setupPath) {
  if (!setupPath || !fs.existsSync(setupPath)) {
    throw new Error('Downloaded Setup.exe was not found.');
  }
  spawn(setupPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();
}

function statusPayload(state, extra = {}) {
  return {
    state,
    current: currentVersion(),
    packaged: app.isPackaged,
    ...extra,
  };
}

function autoUpdaterHasPendingUpdate(autoUpdater) {
  return Boolean(autoUpdater && autoUpdater.updateInfoAndProvider);
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
          latest: normalizeAdminVersion(info?.version || ''),
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
          latest: normalizeAdminVersion(info?.version || ''),
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
      // Silent .N releases are not reliable via electron-updater semver; GitHub is source of truth.
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
      // Only use electron-updater when it already has update info from its own check.
      // Otherwise it throws "Please check update first" after a GitHub-only check.
      if (app.isPackaged && autoUpdaterHasPendingUpdate(autoUpdater)) {
        send(statusPayload('downloading', { available: true, percent: 0 }));
        await autoUpdater.downloadUpdate();
        return statusPayload('ready', { available: true });
      }

      const github = await latestFromGithub();
      if (!github.available) {
        const payload = statusPayload('current', github);
        send(payload);
        return payload;
      }

      send(
        statusPayload('downloading', {
          available: true,
          percent: 10,
          latest: github.latest,
        })
      );
      const setupPath = await downloadGithubSetup(github);
      const ready = statusPayload('ready', {
        available: true,
        latest: github.latest,
        setupPath,
        percent: 100,
        message: 'Installer downloaded. Start it to apply the update.',
      });
      send(ready);
      return ready;
    } catch (error) {
      const payload = statusPayload('error', {
        message: error?.message || 'Could not download the update.',
      });
      send(payload);
      return payload;
    }
  });

  ipcMain.handle('updates:install', async (_event, setupPathArg) => {
    try {
      const existingPath = String(setupPathArg || '').trim();
      if (existingPath && fs.existsSync(existingPath)) {
        launchSetup(existingPath);
        if (app.isPackaged) {
          setTimeout(() => app.quit(), 800);
        }
        return statusPayload('installing', { available: true, setupPath: existingPath });
      }

      if (app.isPackaged && autoUpdaterHasPendingUpdate(autoUpdater)) {
        autoUpdater.quitAndInstall(false, true);
        return statusPayload('installing');
      }

      const github = await latestFromGithub();
      if (!github.available) {
        return statusPayload('current', github);
      }
      const setupPath = await downloadGithubSetup(github);
      launchSetup(setupPath);
      if (app.isPackaged) {
        setTimeout(() => app.quit(), 800);
      }
      return statusPayload('installing', { available: true, latest: github.latest, setupPath });
    } catch (error) {
      const payload = statusPayload('error', {
        message: error?.message || 'Could not start the installer.',
      });
      send(payload);
      return payload;
    }
  });

  ipcMain.handle('updates:open-page', async () => {
    const url = `https://github.com/${feed.owner}/${feed.repo}/releases`;
    await openSafeExternal(url);
    return { ok: true, url };
  });
}

module.exports = { attachUpdater, currentVersion };
