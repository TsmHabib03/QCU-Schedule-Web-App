# Deploying the monthly calendar and professor field

The Add Class and Edit Class forms now accept an optional professor name (up to 120 characters). It is saved per class meeting and displayed in the dashboard and schedule list. Existing COR instructor names are used when a meeting has no override; leaving the field blank when adding a class keeps that fallback. Clearing an existing professor in Edit Class removes the professor for that meeting.

## Apps Script compatibility

The current `setup-database.gs` already stores additional meeting fields inside `Schedule_Entries.extraJson`. The new `instructorName` override uses this existing mechanism. No new spreadsheet column or Apps Script action is needed, and an already deployed copy with `extraJson`, `snapshot.read`, and `batch.write` support does not need redeployment for this feature.

If the deployed script is older or reports `SCHEMA_OUTDATED`:

1. Open the Apps Script project connected to the existing database spreadsheet.
2. Replace Code.gs with the full current contents of `setup-database.gs` in this repository and save.
3. Run `setupDatabase()`. This adds missing columns and preserves existing records. Keep the existing Script Properties.
4. Choose **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Update the existing web app deployment to keep its `/exec` URL.
5. Keep the web app executing as the owner with access set to Anyone. Requests still require the existing server signature.
6. If you instead create a separate deployment, update the Cloudflare Pages `APPS_SCRIPT_URL` to its `/exec` URL. Keep `APPS_SCRIPT_SECRET` aligned with Script Properties; do not expose it in the frontend.

Saving Code.gs or running setup does not update the published web app version; step 4 publishes it.

## Cloudflare Pages

This release changes both the frontend and Cloudflare API handlers. Deploy the built site and Functions together:

```powershell
npm.cmd run build
npm.cmd run deploy
```

Or use the existing Git-based Pages deployment workflow. The local build stages the site under `.build/pages` and refreshes service-worker asset hashes.

After deployment, edit one class, enter a professor name, save, and reload. The dashboard must still show that name. Test clearing it as well. The monthly calendar shows recurring timetable days, rather than claiming holiday or suspension exceptions; selecting a date updates the visible week's picker and class timeline.
