# Cache and dashboard performance

The dashboard starts with one authenticated `/api/v1/dashboard` request. Repeat
navigation can use a recent snapshot after `/api/v1/dashboard?check=1` verifies the
account, enrollment, schedule readiness, login session, and cache key. The lighter
check reads four entity types; a full dashboard reads eight, excluding COR files,
drafts, and import records. Account authorization is checked against the backend
on every navigation; API responses retain `Cache-Control: no-store`.

Snapshots live in `sessionStorage`, scoped to the verified user/session, schedule
revision, and catalog version. They are fresh for 60 seconds. Older snapshots may
be shown after verification while a background refresh runs, up to a five-minute
maximum age. Failed refreshes preserve the last loaded content and offer retry.
Writes invalidate before and after the request, including uncertain failures.
Generation checks reject obsolete responses. Logout, sign-in completion, denied
access, and cross-tab notifications clear private caches. Restored background
pages recheck access before showing their content.

The generated service worker precaches the dashboard, schedule, workspace, and
other public HTML shells plus their assets. Versioned assets use cache-first;
HTML uses the cached shell while checking the network. Auth redirects, admin
pages, APIs, query-string navigations, and live JSON feeds bypass the static cache.
New releases install with bounded parallel downloads and content verification.
Activation removes old release caches. Existing tabs offer an update button so
an open editor is not interrupted. A failed installation leaves the old worker
active. The normal localhost development server still bypasses interception.

Clock ticks update live text and progress without rebuilding class cards,
calendar buttons, or task/note lists. Lists redraw on data/time-boundary changes;
background tabs stop doing this work. Bus/Classroom widgets start after the main
content has rendered.

## Build and deploy

Use `npm run build` as the Cloudflare Pages build command (output directory `.build/pages`).
It builds CSS, fingerprints script/style URLs consistently across pages, and
regenerates `service-worker.js` from `scripts/service-worker.template.js`.
`npm run deploy` runs the full build before uploading. Public files are staged
separately from development scripts, logs, source documentation, and credentials.
The generated `_routes.json` serves static files directly from Pages while
retaining Functions for `/api/*` and the protected admin page.
Do not edit the generated worker directly. No new service or backend deployment
is required.

### Release plan

1. Build CSS, fingerprint assets, generate the worker, and stage public files.
2. Run cache lifecycle/browser, account, schedule, auth, and loading regressions.
3. Deploy Pages and Functions together to the existing production `main` branch.
4. Verify live worker/asset hashes, API no-store headers, account protection,
   and the health endpoint's `sheets` persistence configuration.
5. If verification fails, restore the previous Pages production deployment:
   `a69fc136-abba-489c-86ee-6d19380fbb61` (recorded 2026-10-01).

The latest local fixture run on 2026-10-01 measured 497 ms before / 173 ms after
for repeat dashboard readiness; 17 asset requests / 1,744,234 bytes became zero.
Cold dashboard/account requests fell from two to one. These are synthetic local
measurements, not production latency guarantees.

## Verification

`npm run test:cache` tests cache lifecycle and runs Chromium with the actual
service worker on a trusted local hostname. All APIs use synthetic fixtures.
Tests cover request sharing, freshness, failed refreshes/retry, disabled storage,
account switching, denied access, writes versus old responses, cross-tab logout,
Cloudflare-style redirects, offline shells, and deployment activation.

The initial local comparison against the committed implementation recorded:

| Measure | Before | After |
| --- | ---: | ---: |
| Cold dashboard/account requests | 2 | 1 |
| Repeat-visit asset requests | 17 | 0 |
| Repeat-visit asset response bytes | 1,744,234 | 0 |
| Repeat dashboard ready | 386 ms | 156 ms |

Timing uses a 40 ms account-check fixture and a 200 ms full-API fixture, and is
not a production latency claim. Measure production separately with browser
Network/Performance tools and the existing `Server-Timing: api, database`
headers. The test writes metrics and a screenshot to the OS temporary directory
under `qcu-cache-checks`. Once HEAD contains the new implementation, the test
continues to verify the new behavior without treating it as an old baseline.
