# CodeQL (LIVE Local)

Prefer **local CodeQL on private ADMIN** for first diagnosis (`npm run security:codeql` there).

This LIVE repo may keep `.github/workflows/codeql.yml` for optional public CI later — keep it disabled or unused until you promote Admin-tested scanning.

## Admin local (source of truth for testing)

```bash
cd ../project-intelligence-admin
npm run security:codeql -- --bootstrap   # once
npm run security:codeql
```

Read `docs/security-codeql-results.md` on Admin; fix there; then promote.
