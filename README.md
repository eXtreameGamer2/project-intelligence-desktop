# Project Intelligence Local

Localhost-only Windows app (Alpha). This is a **separate** project from the cloud dashboard.

- Runs on `127.0.0.1` only
- Stores data in local SQLite
- No Supabase login
- Optional AI via a local model (LM Studio / Ollama) in Settings

The cloud product stays in `centralized-project-intelligence-dashboard`.

GitHub: https://github.com/eXtreameGamer2/project-intelligence-desktop

## Install (what people should run)

Download the latest **Setup** from [GitHub Releases](https://github.com/eXtreameGamer2/project-intelligence-desktop/releases). Current build:

https://github.com/eXtreameGamer2/project-intelligence-desktop/releases/tag/v1.0.28

Use **`Project-Intelligence-Local-Setup-1.0.28.exe`**. Do not install from git. The Setup file is larger than GitHub’s 100MB git limit, so it is not in the repo.

The installer is unsigned. Windows may say the app cannot run or to check with the publisher. Right-click the `.exe` → Properties → **Unblock** if that checkbox is there, or use SmartScreen **More info** → **Run anyway** for this file you built.

This build is x64 Windows only.

## Run in a window (closest to an .exe)

```bash
npm run setup
npm run desktop
```

`setup` installs dependencies, creates the SQLite database, seeds a local user (`desktop@local`), and builds the UI.

## Build a Windows installer

```bash
npm run dist
```

The installer lands in `release/` as `Project Intelligence Local Setup <version>.exe`. First build downloads Electron and can take several minutes. That folder is gitignored on purpose.

## Updates

Installed copies check GitHub Releases for `eXtreameGamer2/project-intelligence-desktop`. Users can also click **Check for updates** in Settings. A packaged install can download the next Setup `.exe` and restart to apply it; a development window opens the download instead.

Check for updates uses `latest.yml` and **`Project-Intelligence-Local-Setup-<version>.exe`** on the release (hyphens, not spaces).

To publish a new version (see `docs/local-versioning.md`):

1. Silent: `npm run version:silent` (`1.0.32` → `1.0.32.1`) — no patch notes.  
   Noted: `npm run version:noted` (`1.0.32.1` → `1.0.33`) — add patch notes.
2. Publish with `npm run release` (stamps buildMeta, packs with semver-safe form, uploads dotted tag + Setup + `latest.yml`).

Do not bump the base patch for a silent ship. Do not commit the Setup `.exe` to git.

Older installs (1.0.23 and below) do not include the updater. Those users install 1.0.24 from the release page once.

## Browser fallback

```bash
npm run setup
npm run start
```

Then open http://127.0.0.1:4310

## Offline AI

The desktop app does not ship a language model. In Settings, use the **localhost** provider and point it at LM Studio or Ollama on this machine.

## Data

SQLite is `prisma/desktop.db` during development. The packaged `.exe` copies a first-run database into the Windows user-data folder.

If `npm install` skips package scripts (npm 11 `allowScripts`), download the Electron binary and generate Prisma before the first launch:

```bash
node node_modules/electron/install.js
node scripts/set-db-env.js generate
```
