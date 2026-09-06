# Local versioning (silent `.N`)

LIVE Local installers use the same silent/noted scheme as Admin. Always publishing an installer does **not** change which bump to use.

| Kind | Command | Example |
|------|---------|---------|
| Silent | `npm run version:silent` | `1.0.32` → `1.0.32.1` → `1.0.32.2` |
| Noted | `npm run version:noted` | `1.0.32.2` → `1.0.33` |
| Noted minor | `npm run version:noted -- --level minor` | `1.0.32.2` → `1.1.0` |

Then build/publish:

```bash
npm run release
```

- Tags: `v1.0.32.1`
- No patch notes on silent bumps
- electron-builder uses a temporary semver form (`1.0.32-s1`) internally; `buildMeta` + GitHub tags keep the dotted form
- Silent Admin promotes stay silent on Local (`.N` bump, no patch-note bullets)
- Noted Admin promotes use `version:noted` + patch notes
