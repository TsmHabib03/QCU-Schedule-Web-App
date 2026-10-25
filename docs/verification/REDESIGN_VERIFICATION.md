# Redesign verification

Verified locally on October 24, 2026, against the current working tree based on commit `1e8dceb`.

The existing redesign covers the student dashboard and calendar, professor editing, Tasks & Notes, profile settings, COR onboarding, navigation, and feedback components. The latest continuation also redesigned Bus Route, refreshed skeleton loaders, and added the QC pride profile ring. Earlier regression results below are retained; the build, student, loading, and bus checks were run for these changes.

## Results

| Check | Result |
| --- | --- |
| `npm.cmd run build` | Passed; generated content hashes and service worker, then staged public files in `.build/pages`. |
| `node node_modules/wrangler/bin/wrangler.js pages functions build functions --outdir=.build/admin-functions` | Passed; compiled Cloudflare Functions locally. |
| `npm.cmd run test:student` | Passed; navigation and student layouts at 320, 375, 390, 600, 768, 1023, 1024, and 1440 px; planner interactions and profile, notifications, installation, and logout. |
| `npm.cmd run test:loading` | Passed; nine pages at 320, 390, 768, and 1440 px, reduced motion, failure recovery, and duplicate-action prevention. |
| `npm.cmd run test:bus` | Passed with actual MapLibre 4.7.1 and WebGL; six viewport sizes, route gradient, exact coordinate anchors, verified stops, overlay spacing, schedule dialog/focus, profile navigation, and map/data failure recovery. |
| `node scripts/test-bus-map.mjs --live` | Passed with real OpenFreeMap Liberty tiles at 320×568, 375×667, 390×844, 768×1024, 1440×900, and 844×390; retained OpenStreetMap attribution, geographic labels, and muted basemap styling. |
| `npm.cmd run test:schedule` | Passed; 29 day/time checks and 37 CRUD checks, including saving, editing, clearing, and preserving professors. |
| `npm.cmd run test:cache` | Passed; repeat assets served from Cache Storage, private APIs excluded, stable card/calendar DOM across clock ticks, refresh retry, offline navigation, account switching, updates, and cross-tab logout. |
| `npm.cmd run test:feedback` | Passed; dialog variants, cancellation, focus, and toast lifecycle at 320, 390, 768, and 1440 px. |
| `npm.cmd run test:ux` | Passed; upload and review recovery, interrupted confirmation, login recovery, unavailable states, and recovery routes. |
| `npm.cmd run test:cor` | Passed; import parsing, validation, admission, leases, duplicate confirmation, and loading recovery. |
| `npm.cmd run test:accounts` | Passed; 26 account-gate and schedule-resolution checks. |
| `npm.cmd run test:auth` | Passed; signed-session handoff, interrupted login recovery, and session failure handling. |
| `npm.cmd run test:admin` | Passed; security, API, schema migration, and account lifecycle checks. |
| `npm.cmd run sheets:test-mapping` | Passed; entity round trips and 11 time-cell checks. |
| `npm.cmd run sheets:e2e` | Passed; 58 persistence checks, including professor retention after a cold isolate. |
| `git diff --check` | Passed. |

Browser screenshots are available in the local temporary folders `qcu-student-design`, `qcu-loading-checks`, `qcu-feedback-design`, `qcu-cor-ux-checks`, and `qcu-cache-checks`. Dashboard, profile, and planner mobile screenshots were also visually inspected.

## Bus Route, profile ring, and skeletons

Bus Route now uses a full viewport OpenFreeMap canvas behind the existing app shell, a thick blue/red/green route with white casing, and custom white pill markers connected to blue coordinate dots. Labels collapse when they collide with each other or the floating controls. The rounded route card exposes origin, destination, published distance, and a schedule/stops action; the dialog retains official schedules and source information. Map controls, card, and navigation clear each other at all six tested viewport sizes.

The map retains OpenFreeMap's vector geography with pale roads, water, and land colors, quieter geographic labels, and hidden highway shields. Basemap styling changes apply before adding the route, so its gradient stays vibrant. Screenshots from deterministic rendering and live tiles are kept separately in the temporary folders `qcu-bus-map` and `qcu-bus-map-live`. Final live mobile (390×844) and desktop (1440×900) screenshots were visually inspected; the final build, live bus suite, JavaScript syntax check, and whitespace check passed.

The header avatar links to `settings.html` and has a red/yellow/blue QC pride ring around the student's photo or initials. Header, navigation, dashboard, calendar, settings, and bus loading skeletons match the new rounded layouts. Reduced motion and error cleanup remain covered by the loading tests.

The card shows the official published distance of **12.9 km**. Travel time is **Not published** because the source contains no duration. The drawn road corridor is indicative (approximately 14.5 km), rather than an official GPS route; route colors do not represent traffic, and there is no live bus tracking. All 15 stops appear in the details list, while only the 14 verified coordinates receive markers. The Tullahan Bridge stop has no map action because its coordinates are unverified.

Network access to the live basemap was unavailable inside the sandbox. The live test passed when rerun outside the sandbox. Local fixture checks also passed without external tiles.

## Cache test correction

The sandbox denied Node read access to the existing `assets/images/brand/favicon-32.png`. The fixture previously reported every file-read failure as a missing resource, which produced a false 404 and prevented service-worker installation. The fixture now distinguishes missing files from permission and I/O failures, and worker timeouts include registration state.

The test uses the app's own service-worker registration. Temporary worker instrumentation and a manual registration used for diagnosis were removed. The final run passed outside the sandbox with access to the favicon. Wrangler compilation also required access outside the sandbox for its normal log and file-resolution behavior.

## Deployment status

These checks use local synthetic accounts, API responses, and Sheets/Drive emulators. No production deployment or live-account verification was performed. Static output is staged in `.build/pages`; the Functions compilation output is in `.build/admin-functions`.

Deploy the frontend and Functions together following [SCHEDULE_PROFESSOR_DEPLOYMENT.md](../guides/SCHEDULE_PROFESSOR_DEPLOYMENT.md). After deployment, verify a real Google profile, notification and installation behavior on a supported browser, a COR import, and professor save/clear followed by reload. Apps Script version compatibility is described in that deployment document.
