# Admin dashboard deployment

Implemented entry point: `/admin.html`, with an Admin sign in link on the landing page.
The authorized account is allowlisted only in server-side code. Public sign-in messages do not disclose it.

## Configure the account

1. Sign in to the existing app with that Google account so its Users row exists.
2. In the owner-controlled spreadsheet, locate the row with exactly that email and copy its `googleSub`. This is the stable Google subject ID, not the `userId`. Verify the account belongs to you. Do not accept a subject ID supplied by another user.
3. Optionally set `ADMIN_GOOGLE_SUB` to that exact value in both Cloudflare Pages environment variables and Apps Script Project Settings ? Script properties. Keep `APPS_SCRIPT_SECRET` and Google OAuth credentials server-side. This pin is optional. When set, it must match. When absent, only the exact server-allowlisted email verified by Google is accepted.
4. If using `npm run sheets:sync-catalog`, set Apps Script property `CATALOG_SYNC_GOOGLE_SUB` to `script-maintenance` (the existing maintenance actor). Ordinary users are no longer permitted to synchronize shared catalogs.

## Apply the update

1. Back up the spreadsheet before updating the live deployment.
2. Replace Apps Script Code.gs with `setup-database.gs`. Run `setupDatabase()` once; it appends the new `sessionsRevokedAt` column without deleting existing records.
3. Update the Apps Script web-app deployment to a new version. Keep the existing deployment URL where possible; otherwise update Cloudflare's `APPS_SCRIPT_URL`.
4. Deploy the Cloudflare Pages site and Functions together with the new configuration. The local build command is `node node_modules/wrangler/bin/wrangler.js pages functions build functions --outdir .build/admin-functions`.
5. Sign in again. Existing cookies without an enforced expiration are intentionally invalidated. Admin operations require a Google login within the last hour.
6. Verify the dashboard with the admin account and confirm a regular student receives HTTP 403 from `/api/admin/users`.

Drive file cleanup uses Apps Script `DriveApp` and may require the script owner to authorize Drive access. Deletion moves referenced files to Drive Trash; it does not promise immediate erasure from Google's storage, backups, or already-downloaded student devices.

## Implemented controls

- Exact allowlisted Google-verified email at Cloudflare and Apps Script, with an optional subject pin. Client role fields do not grant authority.
- Fresh account checks; suspended/closed accounts and revoked sessions fail closed. Reactivation requires a fresh login. Integration endpoints also require an active platform account.
- Same-origin mutation checks; admin mutations additionally require a sealed CSRF token, a bounded body, allowed operation, reason, expected record version, and unique mutation ID.
- Administrative writes are serialized by the Apps Script lock, rate limited to 20 attempts per minute, and recorded as STARTED/SUCCESS events. Successful duplicate mutation IDs return the existing outcome. Refresh after a timeout before deciding whether to retry; Sheets is not a transactional database, and a STARTED event without SUCCESS requires reviewing the resulting state.
- Self-modification is blocked. Close before purge; purge requires typing the user ID. Purge removes owned spreadsheet rows, trashes referenced Drive files, and retains a minimal CLOSED identity tombstone plus audit history to block automatic re-registration.
- Lists and detail responses use explicit field projections. Private task/note contents and raw COR files are not exposed by monitoring endpoints. Deletion preview contains counts only.
- No admin response/service-worker caching. Admin HTML includes a restrictive CSP. Dashboard account data is rendered using textContent.
- Ordinary user writes cannot override account status or revocation fields; the identity/status is checked again inside the write lock. Reserved admin audit actions cannot be forged through the ordinary audit endpoint.
- User text beginning with `=` is escaped before Sheets writes to prevent formula execution.

## Performance and verification

The session endpoint now reads only Users rather than every owned table. Login reads Users; bootstrap reads Users, profiles and enrollments; Tasks/Notes load only their dependencies. Existing bundled catalog caching remains in place. Lists return 25 accounts per page, search is debounced, and details load on demand. Authorization decisions are never cached.

Offline synthetic comparison with a 10 KB private note: session payload decreased from 11,008 bytes (full snapshot) to 241 bytes (account read). This demonstrates payload reduction, not a production latency guarantee. Apps Script still scans spreadsheet tables; free-tier quotas and large-workbook latency remain constraints.

Checks:

- `npm run test:admin`: Apps Script authorization/revocation/deletion and real HTTP-handler CSRF/OAuth isolation tests.
- `npm run sheets:test-mapping`: all entity mappings.
- `npm run sheets:e2e`: 54 repository/Apps Script integration checks.
- `node scripts/test-cor-regressions.mjs`: COR frontend/backend regressions.
- Tasks/Notes smoke tests: run a local server with a test-only session secret and Sheets persistence disabled, then `BASE=http://127.0.0.1:8799 node scripts/test-tasks-notes.mjs` using the matching `TEST_SESSION_SECRET` (PowerShell uses `$env:BASE=...`). 33 checks.

Browser visual inspection and real Google/Drive/live deployment smoke tests must be completed in the deployment environment; the browser tool was unavailable in this session.

## Current Apps Script deployment URL

`https://script.google.com/macros/s/AKfycbws152zcFH7ZBqf9ocBbg6jCMu-JjewHxA6o1QjLFNDkqLuccITDmbJU98slUpG49pTqA/exec`

The local `.dev.vars` and example configuration use this URL. Set Cloudflare Pages `APPS_SCRIPT_URL` to this same value before the next deployment. An attempted remote update could not authenticate because Wrangler had no Cloudflare API token.

Admin-intent OAuth now rejects every identity except the server-allowlisted, Google-verified account before creating a session. `/admin`, `/admin/`, and `/admin.html` are guarded server-side, including Apps Script administrator authorization. The updated Apps Script must include the `admin.access` action before deploying the page guard. Student sign-in remains available through Continue with Google.

## Local sign-in succeeds but admin verification fails

If `.dev.vars` has the URL but no `APPS_SCRIPT_SECRET`, Google authentication can succeed while the database connection is unavailable. Partial database configuration now blocks session creation and the local admin route explains the missing setting.

Open Apps Script Project Settings > Script properties. Copy the existing `APPS_SCRIPT_SECRET` value into the same key in `.dev.vars`. Do not paste the secret into chat or commit `.dev.vars`. Restart `npm run dev` after editing, then sign in again. If the next error reports an unsupported admin API, update and redeploy Apps Script from `setup-database.gs`.

The development server logs route paths only; OAuth query parameters and cookie values are not logged.

## Published deployment is missing admin commands

`npm run admin:check` makes two signed, read-only compatibility probes using a non-admin identity. Both commands must exist and reject that identity. An `Unknown action` response means the published version lacks the admin code.

In PowerShell, copy the complete current script:

```powershell
Get-Content -Raw .\setup-database.gs | Set-Clipboard
```

In the Apps Script project that owns the configured `/exec` URL, replace the entire contents of Code.gs with the clipboard contents, save, and run `setupDatabase()`. Then choose **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**. Updating the existing deployment preserves its URL. Saving the editor or running setup alone does not update the published `/exec` version.

Run `npm run admin:check` again. This tool checks command availability and non-admin rejection without reading student records or changing accounts. It does not certify a real admin login.
