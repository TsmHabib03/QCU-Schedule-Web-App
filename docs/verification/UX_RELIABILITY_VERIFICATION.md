# Student UX improvements — September 13, 2026

## Plan and implementation

1. **Connect the new backend.** Updated `.dev.vars`, `.dev.vars.example`, and `ADMIN_DASHBOARD_SETUP.md` to the supplied Apps Script URL. The read-only live check passed: schema v3 is healthy; all four admin commands exist and reject a non-admin actor.
2. **Improve COR recovery.** File validation now handles missing/generic browser MIME while verifying extensions and file signatures on the server. Empty, corrupt, oversized and multiple-file uploads are rejected clearly. Native multipart parsing replaces the handwritten parser. Status failures stop with a recovery action; upload retries keep their stable request ID. Review edits survive same-tab reloads and expired sessions, and are isolated by account and COR ID. Storage failures display a truthful warning. Program corrections are editable, required fields receive focus, and upload/save/retry controls prevent duplicate actions. Confirmed success waits for the student to open the dashboard.
3. **Support replacing a draft.** Choosing a different COR closes only a reviewed, unconfirmed draft through `/api/v1/cor/cancel`. The existing Apps Script batch lock prevents cancellation of completed or concurrently changed imports. The previous confirmed schedule remains intact. Cancel retries are idempotent, and uncertain results use saved-status recovery. This uses the existing schema v3 commands; no further Apps Script source change was needed in this phase.
4. **Improve error pages and exceptions.** Custom 404, offline and page-exception responses use absolute links/assets and give useful next steps on nested URLs. API 404s retain resource-specific JSON. Exceptions return 503 without exposing private details. Session/bootstrap outages no longer report a false signed-out state. The service worker preserves network errors and returns HTTP 503 for uncached offline navigation; cache version is v71.
5. **Verify.** Tested synthetic failures and recovery, real development-server routing, production Functions compilation, and desktop/mobile browser behavior. No student COR or production account was modified.

## Passing checks

- `npm.cmd run test:ux`: API/file validation, real Sheets/Drive emulator, safe draft replacement, lost responses, expired sessions, draft restoration, Unicode, keyboard input, required-field focus, request deduplication, home retry, nested 404 and page/asset/API exceptions.
- `npm.cmd run test:cor`: existing COR admission, extraction lease, rate limit, confirmation and loading regressions.
- `npm.cmd run test:admin` and `npm.cmd run test:admin:browser`: suspend/reactivate/close/purge, CSRF recovery, filters, Unicode and lost-response retries.
- `npm.cmd run test:loading`: 10 pages at 320, 390, 768 and 1440 pixels, plus loading and reduced-motion checks.
- `npm.cmd run sheets:test-mapping` and `npm.cmd run sheets:e2e`: entity mappings and 54 persistence checks.
- `node node_modules/wrangler/bin/wrangler.js pages functions build functions --outdir .build/admin-functions`: compiled successfully.
- `npm.cmd run admin:check`: the supplied deployed Apps Script URL passed the read-only compatibility check.

Browser screenshots are written to `%TEMP%\qcu-cor-ux-checks`. COR review/upload and recovery pages were checked at 320 and 1280 pixels with no horizontal overflow or browser runtime errors. The optional design detector ran with reduced parser support; its width-transition and empty-avatar findings were addressed. This is not a full screen-reader audit.

## Deployment status

The Apps Script deployment is verified. **These frontend and Cloudflare Functions changes are local and have not been deployed.**

Set Cloudflare Pages `APPS_SCRIPT_URL` to:

```text
https://script.google.com/macros/s/AKfycbxKMjLzWNPzYAUp7UbMZGUvqPczQyj-zffGveXinQ62czVfqzi7cw0VLvgtCNixfFrK6w/exec
```

Keep the matching signing secret configured, deploy the Pages changes, and restart a local dev server after changing `.dev.vars`. Production environment variables remain managed in Cloudflare, not `wrangler.toml`.

After deployment, use a disposable staging COR to verify real Drive/Gemini permissions, extraction accuracy and atomic schedule confirmation, plus the service-worker upgrade. Automated tests use synthetic services and cannot establish third-party availability or guarantee every possible production error is eliminated.
