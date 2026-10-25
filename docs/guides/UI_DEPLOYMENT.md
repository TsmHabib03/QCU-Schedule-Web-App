# Deploying the Settings Google connection and Route 4 UI

The 2026-10-24 release is deployed to production at https://qcu-schedule-web-app.pages.dev.
Its deployment URL is https://18e5a5a4.qcu-schedule-web-app.pages.dev.
Cloudflare marks it as Production on branch `main`. It was uploaded directly from the
local working directory; this deployment does not commit or push those changes to GitHub.

## Does this release need Google Apps Script changes?

No. `setup-database.gs` is unchanged. The Google connection modal and Route 4 layout
use frontend JavaScript and Cloudflare Pages Functions. The registered Google OAuth
callback remains `https://qcu-schedule-web-app.pages.dev/api/google/callback`.
After authorization, the callback returns to `settings.html#google-connection`.

`assets/js/app.js` is browser JavaScript. Editing it requires a Cloudflare deployment.
Google Apps Script is the database code in `setup-database.gs`; publishing that code
is a separate operation in Google's Apps Script editor.

## Future frontend or Cloudflare Functions updates

1. Open PowerShell in `C:\Users\Habib\QCU-Schedule`.
2. Run the regression suites relevant to the change. For these UI features:

   ```powershell
   npm.cmd run test:google
   npm.cmd run test:bus
   ```

3. If Wrangler is not signed in, run `npx.cmd wrangler login` and complete the browser login.
4. Deploy to the production branch explicitly:

   ```powershell
   npm.cmd run deploy -- --branch main
   ```

   The `predeploy` script runs `npm run build`, which generates asset fingerprints,
   the service-worker manifest, and `.build/pages`. Wrangler uploads those public
   files and compiles `functions/` into the same deployment. Explicit `--branch main`
   is necessary when the local branch differs from the production branch.

5. Confirm the new deployment is listed as Production in Cloudflare, then run:

   ```powershell
   node scripts/check-ui-deployment.mjs
   ```

   This is read-only: it compares live release files with local contents, checks
   runtime configuration, confirms anonymous Google API access is refused, and
   verifies that the retired page is unavailable. It does not perform Google login.
6. Sign in normally, open Settings, tap My Profile, and connect Classroom. Confirm
   authorization returns to the modal and both avatar borders and the Google Verified
   badge update. Open Campus Bus and check the mobile sheet and stops timeline.
7. Save reviewed source changes in GitHub separately so a future Git-triggered
   deployment builds the same source. Direct Wrangler deployment does not push Git.

If an installed app shows the earlier screen, close it and reopen it with internet
access. The service worker refreshes on navigation; a browser hard refresh is also useful.

## When `setup-database.gs` changes

1. Open the existing database spreadsheet, then choose **Extensions > Apps Script**.
2. Replace the existing database code (usually `Code.gs`) with the complete current
   `setup-database.gs` from this repository. Save it. Preserve the existing Script
   Properties, including `APPS_SCRIPT_SECRET` and any `SPREADSHEET_ID`.
3. If sheet definitions or columns changed, run `setupDatabase()` and approve any
   required Google permissions. The current setup function adds missing sheets or
   columns while preserving existing records. Follow any release-specific migration
   instructions as well.
4. Choose **Deploy > Manage deployments**, select the existing Web app, and click
   the **Edit** pencil.
5. Select **Version > New version**, enter a release description, then click **Deploy**.
   Keep **Execute as: Me** and **Who has access: Anyone**. The backend verifies the
   existing server signature on data requests.
6. Updating the existing deployment preserves its `/exec` URL. If you create a new
   deployment instead, set Cloudflare Pages' production `APPS_SCRIPT_URL` to that
   new `/exec` URL. Keep `APPS_SCRIPT_SECRET` equal to the Script Property; do not
   place it in frontend JavaScript.
7. Deploy any corresponding frontend/Functions changes with the Cloudflare command
   above. A fresh Cloudflare deployment is required after changing its environment variables.
8. Visit `https://qcu-schedule-web-app.pages.dev/api/v1/health` and confirm
   `persistence` is `sheets` and the required variables are `set`. This confirms
   configuration presence; verify actual persistence by saving a normal schedule
   change and reloading it.

Saving code or running `setupDatabase()` alone does not publish an updated `/exec`
web app. **New version > Deploy** is the step that publishes it.

## Rollback

For the site, choose a known-good production deployment in Cloudflare Pages and use
its rollback action. The production deployment before this release was
`9b7f8861-59ce-4b18-a7ce-e43bb2518f6d`.
For Apps Script, edit the existing deployment and select its previous version.
Rolling back code does not undo spreadsheet data changes.
