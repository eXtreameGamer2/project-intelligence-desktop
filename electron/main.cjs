const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const { attachUpdater } = require('./updater.cjs');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4310;

let server = null;
let mainWindow = null;

function appRoot() {
  return path.join(__dirname, '..');
}

function logPath() {
  try {
    return path.join(app.getPath('userData'), 'launch-error.log');
  } catch {
    return path.join(app.getPath('temp'), 'project-intelligence-launch-error.log');
  }
}

function writeLaunchLog(message) {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${new Date().toISOString()}\n${message}\n`);
  } catch {
    // Ignore log failures so startup can still show a dialog.
  }
}

function showFatalError(error) {
  const message = error?.stack || error?.message || String(error);
  writeLaunchLog(message);
  dialog.showErrorBox(
    'Project Intelligence Local failed to start',
    `${message}\n\nA log was saved to:\n${logPath()}`
  );
}

function queryEnginePath() {
  const candidates = [
    path.join(appRoot(), 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node'),
    path.join(process.resourcesPath, 'prisma-client', 'query_engine-windows.dll.node'),
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function ensurePrismaClient() {
  const dest = path.join(appRoot(), 'node_modules', '.prisma', 'client');
  if (fs.existsSync(path.join(dest, 'index.js'))) {
    return dest;
  }

  const src = path.join(process.resourcesPath, 'prisma-client');
  if (!fs.existsSync(path.join(src, 'index.js'))) {
    throw new Error('Packaged Prisma client is missing. Rebuild with npm run dist.');
  }

  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

function templateDatabasePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'prisma', 'desktop.template.db');
  }
  return path.join(appRoot(), 'prisma', 'desktop.db');
}

function ensureUserDatabase() {
  const dataDir = app.isPackaged
    ? app.getPath('userData')
    : path.join(appRoot(), 'prisma');
  fs.mkdirSync(dataDir, { recursive: true });
  const dest = path.join(dataDir, 'desktop.db');
  if (!fs.existsSync(dest)) {
    const template = templateDatabasePath();
    if (fs.existsSync(template) && path.resolve(template) !== path.resolve(dest)) {
      fs.copyFileSync(template, dest);
    }
  }
  return dataDir;
}

function applyDesktopEnv() {
  process.env.CPID_DESKTOP = '1';
  process.env.CPID_ELECTRON = '1';
  process.env.NODE_ENV = 'production';
  process.env.SERVE_STATIC = 'true';
  process.env.HOST = HOST;
  process.env.PORT = String(process.env.PORT || DEFAULT_PORT);
  process.env.CPID_DATA_DIR = ensureUserDatabase();
  ensurePrismaClient();
  const engine = queryEnginePath();
  if (engine) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;
  }
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function waitForHealth(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`http://${HOST}:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Desktop server did not start in time.'));
        return;
      }
      setTimeout(ping, 250);
    };
    ping();
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: true,
    title: 'Project Intelligence Local',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(`http://${HOST}:${port}`);
  attachUpdater(mainWindow);
}

async function boot() {
  applyDesktopEnv();
  const serverModule = await import(pathToFileURL(path.join(appRoot(), 'src', 'index.js')).href);
  server = await serverModule.startServer();
  const port = Number(process.env.PORT || DEFAULT_PORT);
  await waitForHealth(port);
  createWindow(port);
}

app.whenReady().then(boot).catch((error) => {
  console.error(error);
  showFatalError(error);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
    server = null;
  }
});
