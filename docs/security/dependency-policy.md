# Dependency Policy — FinTrack Pro v2

## Principles

1. **Lockfile is law**: `package-lock.json` must be committed and reviewed on every change.
2. **`npm ci` for all automated installs**: Never `npm install` in CI.
3. **Automated scanning**: Run `npm audit` on every pull request.
4. **Review major upgrades**: Never auto-merge major version bumps without manual review.
5. **Remove unused dependencies**: Regularly audit and remove packages that are no longer needed.

---

## CI Pipeline Commands

```bash
# Reproducible install (fails if lockfile is inconsistent)
npm ci

# Type checking
npx tsc --noEmit

# Unit tests
npm test

# Production build validation
npm run build

# Dependency vulnerability audit
npm audit
```

---

## Current Dependency Audit

### Production Dependencies

| Package | Version | Purpose | Notes |
|---|---|---|---|
| `next` | ^15 | Framework | Core — keep updated |
| `react` / `react-dom` | ^19 | UI library | Core — keep updated |
| `recharts` | ^2 | Charts | Low risk |
| `lucide-react` | ^1 | Icons | Low risk |
| `clsx` / `tailwind-merge` | ^2/^3 | Class utilities | Low risk |
| `canvas-confetti` | ^1 | UI effect | Low risk |
| **`xlsx`** | **^0.18.5** | **Excel export** | **See notes below** |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5 | Type checking |
| `vitest` | ^5 | Unit testing |
| `tailwindcss` / `postcss` | ^4/^8 | Styling |
| `@types/*` | Current | Type definitions |

---

## XLSX (SheetJS Community Edition) — Risk Assessment

**Version in use**: `xlsx@0.18.5`

**Risk**: The community edition (`xlsx`) has had historical CVEs related to:
- Prototype pollution in parsing arbitrary untrusted input
- ReDoS in formula parsing

**Current exposure**: LOW — the app uses `xlsx` only for **export** (generating `.xlsx` files from trusted in-memory data), not for **parsing user-uploaded `.xlsx` files**. The attack surface for the known vulnerabilities is on the parse path.

**Mitigations in place**:
- `xlsx` is only called with in-memory structured data (never with user-uploaded file bytes)
- No user-uploaded spreadsheet files are parsed

**Future migration path**:
If the app ever needs to parse user-uploaded `.xlsx` files:
1. Consider migrating to `exceljs` or `fast-xlsx` (actively maintained alternatives)
2. Or restrict import to JSON-only format (current approach)
3. Run `npm audit` and review the specific CVEs at that time

**Action for this iteration**: No change — export-only use is acceptable. Document for future review.

---

## npm audit Results

Run: `npm audit` from the project root.

> Network access was available during this iteration.
> If `npm audit` cannot connect to the registry in a future run, note the limitation honestly.

### How to interpret results

| Severity | Action |
|---|---|
| **critical** | Fix immediately before merge |
| **high** | Fix within one sprint |
| **moderate** | Fix or document exception within one milestone |
| **low** | Track and address in routine maintenance |

### Known exceptions (if any)

Document any intentionally accepted vulnerabilities here with:
- CVE ID
- Package + version
- Why it is accepted
- Compensating control
- Review date

---

## Upgrade Policy

- **Patch versions**: Auto-acceptable after passing tests
- **Minor versions**: Review changelog; acceptable if tests pass
- **Major versions**: Requires manual review of breaking changes, security implications, and testing
- **Transitive dependencies**: Updated via `npm audit fix` for security patches; manual review for major indirect changes

---

## Removing Unused Dependencies

Run periodically:

```bash
npx depcheck
```

Remove any dependency listed as unused that is confirmed to have no runtime purpose.
