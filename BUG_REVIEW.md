# Code review — 2026-09-11

The running application is a static multi-page HTML/CSS/JavaScript PWA. `app.js`
renders the dashboard and schedule, `onboarding.js` manages COR registration,
and Cloudflare Pages Functions implement Google sessions, COR extraction and
CRUD. COR upload calls Gemini inside the upload request. The repository uses
in-memory Maps and optionally hydrates/flushes through Google Apps Script and
Sheets. Some architecture documents describe future features, not current code.

## Confirmed bugs fixed

1. An extra closing `div` in `index.html` closed the dashboard early. Schedule,
   tracker and weekly content escaped the hidden container and appeared below
   Google sign-in. The same tag displaced the Home hero seal and broke layout.
2. The weekly overview skeleton used a block container, stacking seven days.
   It now uses seven equal columns, including on narrow screens.
3. `?auth=dashboard` displayed the dashboard without verifying the session;
   unrecognized `auth` parameters caused `null.then` and a stuck loading screen.
   Routing now verifies bootstrap and displays sign-in failures explicitly.
4. Successful COR extraction still triggered a second processing request and
   polling. On a fresh serverless instance that could lose the result. Successful
   extraction now opens review directly.
5. Duplicate import responses were treated as upload failures. Existing imports
   now resume processing or review instead of requiring another upload.
6. Onboarding status `UPLOAD` with an accepted import was ignored. It now resumes
   processing rather than resetting the wizard to welcome.
7. Poll timeout sent the user back to upload while the server import stayed active.
   It now retains the processing screen with a Check again action. Poll requests
   cannot overlap or navigate away from a newer wizard step.
8. Upload errors left a spinner or disabled controls behind; navigation and file
   selection could change during a pending upload. Cleanup and an in-flight guard
   now keep controls consistent. Invalid file selection clears the previous file.
9. Missing Gemini configuration or extraction failure could leave a blocking COR
   record. Configuration is checked before creation; extraction failures cancel
   the new record and restore the prior user state. Legacy processing with missing
   bytes also releases its import.
10. Awaiting the content hash between duplicate check and record creation allowed
    concurrent uploads in one isolate to both pass. Hashing now precedes the check.
11. Review ignored errors loading a result, then showed an empty form. It now
    reports the error. Drafts are cached in the tab, scoped to user and import,
    so a reload can resume review without storing the draft in a session cookie.
12. Compact program values appeared blank in review; repeated population appended
    duplicate options. Both full and compact values now populate correctly.
13. Review disabled Save before required-field validation and never restored it
    on early return. Required fields are checked before disabling the button.
14. The review API tested wrapper objects instead of their values, accepting empty
    required fields. It now checks the actual values; reported draft versions no
    longer increment twice.
15. The reviewed draft fallback relied on a potentially oversized cookie, while
    confirmation sent no draft. The client now sends its corrected draft as JSON;
    the server validates it and rejects a mismatched import ID. Repository drafts
    still take precedence when available.
16. Confirmation errors appeared in the hidden review step. They now appear beside
    confirmation controls, and duplicate confirmation clicks are guarded.
17. Several extracted schedule values were interpolated as HTML without escaping.
    Review now escapes day, times, room, units and confidence text.
18. The service worker replaced non-success API responses and offline requests
    with HTML, breaking JSON consumers. It preserves HTTP errors and returns a
    JSON 503 when offline. The cache version was bumped for updated assets.
19. COR processing and Gemini diagnostics exposed a key prefix. Those outputs
    no longer include it.

## Additional findings still open

These are separate backend issues found during review, not claims of complete
coverage of every page or production failure mode.

- `functions/api/repo/index.js`: `_dirty` is shared by requests. Hydration clears
  all pending changes, and flush clears them before a remote write succeeds.
  Concurrent requests or failed writes can lose pending changes. This needs
  request-scoped persistence and failure/retry tests against the Sheets adapter.
- `Concurrency.withLock()` simply executes its callback. There is no distributed
  lock here, so different Cloudflare isolates can create duplicate imports or race
  confirmation. The local upload race fix does not provide distributed locking.
- Without Sheets configured, Maps and tab storage are not durable storage. Closing
  a tab or changing devices can lose drafts; this change only restores them within
  the same tab. Uploaded bytes are still memory-only.
- Confirmation still stores enrollment subject data in the session cookie. Large
  schedules can exceed browser cookie limits; durable storage should replace this
  remaining fallback. Review drafts have been removed from that cookie.
- The legacy OCR name parser in `cor/process.js` references `nonNames` outside its
  block scope. It would throw if that fallback were enabled; the current request
  handler only invokes Gemini.
- Review displays subject meetings but does not offer per-subject editing. An
  incorrect extracted meeting can therefore require re-importing the document.

## Validation

### September 12 continuation

- Connected the onboarding page to the pending durable COR backend: uploads send
  a request ID retained for retries in the same tab, completed duplicates open
  success, busy extraction requests poll, and expired leases can resume.
- Missing saved files return to file selection; cancelled scans clear the retry
  ID. The onboarding asset and service-worker cache versions were incremented.
- COR regressions pass, including new retry ID, completed duplicate, busy scan,
  and expired lease cases. Sheets mapping checks and all 54 existing Sheets
  emulator checks pass. These do not verify the new Drive operations or the
  Google Sheets REST atomic confirmation request against live services.
- No deployment or live Google/Gemini verification was performed.

- `node scripts/test-cor-regressions.mjs`: passes. Covers direct extraction,
  duplicate resume, timeout recovery, validation retry, draft handoff, confirmation
  errors, failed extraction cleanup, missing-file cleanup, auth routing, real Home
  markup containment, and service-worker error responses. External extraction is
  mocked; no real COR or account was used.
- `node scripts/test-sheets-mapping.mjs`: all ten entity mappings pass.
- JavaScript syntax checks passed across application, API and script sources.
- Browser verification was blocked by the browser tool's sandbox configuration
  error before a tab could open. No visual screenshot verification was completed.
- Live Google OAuth, Gemini quality, Sheets writes and production deployment were
  not exercised. Changes are local and have not been deployed.
