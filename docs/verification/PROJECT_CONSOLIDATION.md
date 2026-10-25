# Main branch consolidation — October 25, 2026

The project now keeps system documents in `docs/architecture/`, feature and deployment instructions in `docs/guides/`, regression reports in `docs/verification/`, branding and UI mockups in `docs/design/`, and historical plans in `docs/archive/`. The root README links to the [documentation index](../README.md) and includes seven desktop and mobile screenshots.

Public pages remain at the root to preserve existing URLs. Runtime assets, datasets, API handlers, and maintained scripts remain in `assets/`, `data/`, `functions/`, and `scripts/`.

Generated builds, browser fixtures, logs, backups, temporary files, and machine-specific assistant state are ignored by Git. Existing scratch files were preserved locally under `.local/archive/`. The legacy OCR dataset and database generator were also retained there because the current extraction flow and database setup do not reference them. Shared Sheets helpers and the Apps Script emulator remain in `scripts/` because maintained suites import them.

The current student UI, Google connection, campus bus interface, professor editing, and their regression suites are included with the directory cleanup. The retired standalone Google page is removed; integration opens from Settings. The loading fixture was corrected to check the eight current pages and to read resources before sending response headers.

## Validation

All checks below passed against the consolidated working tree before publication:

| Check | Coverage |
| --- | --- |
| `npm run build` | CSS compilation, content fingerprints, service worker, and staged Pages output. |
| `npm run check:project` | Documentation links, app assets, manifest icons, npm commands, and public output contents. |
| Wrangler Pages Functions build | Local API and middleware compilation. |
| `npm run test:student` | Responsive layouts, navigation, planner, profile, settings, and recovery. |
| `npm run test:google` | Google connection UI, OAuth callbacks, preferences, renewal, and disconnect. |
| `npm run test:bus` | Actual MapLibre rendering with deterministic local map fixtures and failure recovery. |
| `npm run test:feedback` | Dialogs, confirmations, focus, and toast lifecycle. |
| `npm run test:loading` | Eight pages at four viewport widths, reduced motion, retries, and action guards. |
| `npm run test:cache` | Account isolation, asset caching, background refresh, offline recovery, and logout. |
| `npm run test:schedule` | 29 day/time checks and 37 class editing checks. |
| `npm run test:cor` | Extraction, review, admission, leases, confirmation, and loading recovery. |
| `npm run test:accounts` | 26 account and active-schedule checks. |
| `npm run test:auth` | Signed session handoff and interrupted login recovery. |
| `npm run test:ux` | Upload recovery, browser workflows, server errors, and missing resources. |
| `npm run test:admin` | Authorization, API handling, schema migration, and account lifecycle. |
| `npm run sheets:test-mapping` | Entity mappings and 11 time-cell checks. |
| `npm run sheets:e2e` | 58 persistence checks using synthetic Sheets/Drive. |

Cache and loading browser suites required execution outside the filesystem sandbox to read existing favicon assets. The tests used local fixtures or synthetic services; these results do not verify live Google accounts or the production database.
