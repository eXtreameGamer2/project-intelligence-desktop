# Project Intelligence Local

Localhost-only Windows app. This is a **separate** project from the cloud dashboard.

- Runs on `127.0.0.1` only
- Stores data in local SQLite
- No Supabase login
- Optional AI via a local model (LM Studio / Ollama) in Settings

The cloud product stays in `centralized-project-intelligence-dashboard`.

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

The installer lands in `release/`. First build downloads Electron and can take several minutes.

## Updates

Installed copies check GitHub Releases for `eXtreameGamer2/project-intelligence-desktop`. Users can also click **Check for updates** in Settings. A packaged install can download the next Setup .exe and restart to apply it; a development window opens the download instead.

To publish a new version:

1. Bump `version` in `package.json` and `CURRENT_APP_VERSION` in `frontend/src/lib/patchNotes.js`.
2. Build with `npm run dist`, or publish with `npm run release` if `GH_TOKEN` can create GitHub releases.
3. Attach `Project Intelligence Local Setup <version>.exe` and `latest.yml` from `release/` to a GitHub release tagged `v<version>`.

Until a release exists, Check for updates reports that no published release was found yet.

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
