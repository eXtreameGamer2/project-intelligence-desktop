# CodeQL (LIVE Local)

Prefer **local CodeQL on private ADMIN** for first diagnosis (`npm run security:codeql` there).

This LIVE repo uses GitHub **Code Scanning default setup** (Security → Code scanning). Do **not** add an advanced `.github/workflows/codeql.yml` while default setup is enabled — GitHub rejects advanced SARIF uploads in that configuration.

## Admin local (source of truth for testing)

```bash
cd ../project-intelligence-admin
npm run security:codeql -- --bootstrap   # once
npm run security:codeql
```

Read `docs/security-codeql-results.md` on Admin; triage in `docs/security-codeql-triage.md`; fix there; then promote. Sync LIVE GitHub alerts from Admin triage when publishing (see `live-code-scanning-triage` rule).

## LIVE GitHub

- Alerts: repository **Security → Code scanning**
- Driven by **default setup** (not a custom Actions workflow named “CodeQL”)
- A green “Push on master” / default-setup analysis is expected; a separate advanced CodeQL workflow is intentionally absent
