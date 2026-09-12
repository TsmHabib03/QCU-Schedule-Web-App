# COR reliability implementation — 2026-09-12

Implemented in the working tree, building on the COR job and atomic-confirmation changes already present. Not deployed.

## Behavior

- Production uploads reserve a persistent request ID before saving private Drive bytes. Retries and duplicate tabs resolve to the same import, including after a lost response. Refresh restores the request and checks saved state. Failed file storage can resume with the original file.
- Apps Script serializes admission and extraction leases using a shared script lock. Five new imports per rolling ten minutes, one active import per user, and five extraction attempts per rolling ten minutes. Status reads, duplicate uploads and reopening reviews do not consume attempts. Expired leases can resume; stale workers cannot overwrite newer results.
- Confirmation uses deterministic identifiers and an atomic Sheets batch under the shared lock. Repeated confirmation returns the completed result. The prior schedule stays active until confirmation succeeds. A stale review cannot regress a completed import.
- Upload bytes report actual progress when XMLHttpRequest is available. Saving the upload and reading the COR have separate messages. Network errors and unexpected responses trigger saved-status recovery. Scan cooldowns show a countdown. Polling ends with a check-again action; individual requests have deadlines.
- Shared loading feedback includes slow, offline, expired-session, error and retry outcomes. Skeleton animation supports reduced motion. Task/note refresh failures retain loaded content; workspace opening reuses dashboard data.
- Missing pages use `404.html`; missing APIs return JSON with HTTP 404. Service-worker errors retain their HTTP status, API offline failures return JSON, and failed asset requests never receive offline HTML. Cache version is v69.
- `Server-Timing` exposes API/database durations and extraction/save durations. Browser Performance measures use `qcu-dashboard`, `qcu-schedule`, `qcu-tasks`, and `qcu-notes`. No personal data is logged by this instrumentation.

## Verified locally

Run `npm.cmd run test:cor` on PowerShell (or `npm run test:cor` elsewhere).

| Check | Result |
| --- | --- |
| Lost upload/confirmation responses after saved results | Pass, frontend regression harness |
| Duplicate tabs, stable request IDs, interrupted file save | Pass, production job handler with shared storage mocks |
| Single extraction lease, expiry/resume, stale worker rejection | Pass |
| Five attempts, cooldown fields, rolling-window reset, direct extraction calls | Pass |
| Duplicate confirmation under shared lock | Pass |
| Poll deadline, explicit recovery, refresh-content preservation, offline/session/slow states | Pass |
| API offline JSON and network 404 preservation in service worker | Pass |
| Sheets entity mapping round trips | Pass |
| Existing admin security and API checks | Pass |
| Cloudflare Pages Functions compilation | Pass |
| Local missing page / missing API / signed-out COR status | HTTP 404 HTML / HTTP 404 JSON / HTTP 401 JSON |

Local route samples were 61 ms (missing HTML), 6 ms (missing API), 9 ms (onboarding HTML), and 16 ms (signed-out COR status). These are local transport samples, not production dashboard/database/AI performance measurements.

## Before release

### Continuation verification (September 12)

- Re-ran `npm.cmd run test:cor`, `npm.cmd run test:admin`, and `npm.cmd run sheets:test-mapping`: all passed.
- Retried the browser connection. The tool failed before opening a tab with `codex/sandbox-state-meta: missing field sandboxPolicy`. Mobile, visual, and real service-worker upgrade checks remain unverified.
- No live Google service writes or deployment were performed in this continuation. The staging checks below still need a working browser and a staging account with a disposable COR.

1. Update the Apps Script deployment from `setup-database.gs` before deploying Pages. The deployment needs private Drive access and Sheets API access for atomic confirmation. Run setupDatabase if schema setup is needed; preserve existing records. Keep APPS_SCRIPT_URL and APPS_SCRIPT_SECRET configured in Pages. The localhost fallback is an ephemeral development store and is not a deployment option.
2. On a staging account with a disposable COR, verify real Drive storage, Gemini extraction, and atomic replacement of an existing schedule. Interrupt upload/confirmation responses, refresh during extraction, and retry from two tabs. Verify that old schedule rows remain active when confirmation fails. Mocks do not prove Google service permissions or availability.
3. Capture real dashboard/database/extraction/save timing samples from Server-Timing before setting latency targets.
4. Verify mobile widths, screen-reader announcements, reduced motion, slow upload progress, offline reconnection, and a real service-worker upgrade from v68 to v69. Browser automation could not start in this session because the browser tool reported missing sandbox metadata; visual/mobile checks remain unverified.

Release only after these live checks meet the requested criteria: no false upload failures in recovery cases, no duplicate imports or schedule confirmation, enforced scan limits, and no indefinite loaders. This is not a claim that all unknown production bugs are fixed.
