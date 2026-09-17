# Validation — 2026-09-17

Input baseline commit: `b9674c8`.
Local working branch: `feature/backend-foundation-v2`.

| Check | Result |
|---|---|
| Existing integrity suite before changes | 69 passed |
| Final suite | 86 passed, 1 skipped |
| PostgreSQL RLS integration | Passed using PGlite 0.5.8 |
| Real PostgreSQL multi-connection concurrency | Not run here; explicit skipped test, CI PostgreSQL 17 configured |
| Next route type generation + TypeScript | Passed |
| Next.js production build | Passed, Next 15.5.25 |
| HTTP production smoke | Anonymous 401; foreign Origin 403; missing DB 503; legacy demo POST 501; no-store confirmed |
| Production dependency audit | 0 vulnerabilities reported after overrides |
| ExcelJS compatibility after uuid override | XLSX write/read with conditional formatting passed |
| git diff --check | Passed |

Tests executed with Node 24.19.0 in this environment. CI selects Node 22.
The uploaded node_modules contained non-executable launcher files; local verification used
`node node_modules/vitest/vitest.mjs`, `node node_modules/typescript/bin/tsc`, and
`node node_modules/next/dist/bin/next`. The delivery excludes node_modules; install with
`npm ci`. The test server used explicit `-H 127.0.0.1` because this runtime cannot enumerate
network interfaces. No product code workaround was added for that environment limitation.

Dependency fixes: all PostCSS consumers resolve 8.5.28 (minimum override 8.5.23);
ExcelJS uuid resolves 11.1.1. No force audit fix or Next major-version migration.
An audit result is a point-in-time dependency check, not a security certification.

Not validated: external identity provider/cookie issuance, live managed PostgreSQL/TLS,
PITR restore, object storage access, production deployment, account deletion workflow,
full frontend-backend cutover. No infrastructure was created or configured.

## Applying the patch to the original repository

The ZIP contains the complete edited source and `backend-foundation-v2.patch`.
It excludes `.git`, node_modules, .next and local secrets.
The patch targets the exact input HEAD above. Use a clean working tree:

```bash
git switch -c feature/backend-foundation-v2 b9674c8
git apply --check /path/to/backend-foundation-v2.patch
git apply --index /path/to/backend-foundation-v2.patch
npm ci
npm run typecheck
npm test
npm run build
```

If the branch already exists, inspect it rather than overwriting it. If your current source
has moved on, review/reconcile the patch; do not force it. Run the PostgreSQL-backed CI
before merging. The ZIP does not imply that dev was merged or GitHub was updated.
