# My-Schedule Implementation Log

## CHUNK 23 — Google Authentication & User Identity

**Date started:** 2026-08-31
**Status:** In progress
**Scope:** Platform login, internal user identity, session management, onboarding routing

### What CHUNK 23 delivers

1. **Platform login flow** — Separate from existing Google Classroom/Gmail integration.
   - `GET /api/auth/google/start` — Initiate OIDC login (openid, email, profile scopes).
   - `GET /api/auth/google/callback` — Validate OIDC state, exchange code, create platform session.
   - `POST /api/auth/logout` — Destroy platform session and integration session.
2. **Encrypted platform session cookie** — `qcu_platform_session`, AES-256-GCM, 30-day max age.
3. **User identity model** — Google `sub` → internal `userId` mapping. Mock store for dev; real DB later.
4. **Bootstrap endpoint** — `GET /api/v1/bootstrap` returns user state and profile for frontend routing.
5. **Landing page auth routing** — `index.html` checks session, routes to dashboard or login.
6. **Service worker exclusion** — `/api/auth/` paths excluded from cache.

### Safety constraints

- Dev/test config only. No OAuth secrets in source. No real COR data.
- Newly authenticated user is never auto-admin.
- Google `sub` is the identity anchor; email is not the primary key.
- `GOOGLE_CLIENT_ID` from `wrangler.toml` is public. `GOOGLE_CLIENT_SECRET` and `GOOGLE_SESSION_SECRET` live in `.dev.vars` (not committed).

### Changes

| File | Action | Description |
|---|---|---|
| `IMPLEMENTATION_LOG.md` | Created | This file |
| `functions/api/auth/_lib.js` | Created | Platform auth helpers (cookie, state, user store) |
| `functions/api/auth/google/start.js` | Created | OAuth start redirect |
| `functions/api/auth/google/callback.js` | Created | OIDC callback, session creation |
| `functions/api/auth/session.js` | Created | GET session status |
| `functions/api/auth/logout.js` | Created | POST logout |
| `functions/api/v1/bootstrap.js` | Created | User state + profile + routing |
| `functions/api/v1/me.js` | Created | GET/PATCH profile stub |
| `scripts/dev-server.mjs` | Modified | Register new auth + v1 routes |
| `index.html` | Modified | Auth-aware landing page routing |
| `service-worker.js` | Modified | Exclude `/api/auth/` from cache |

### Test Results (dev server, 2026-08-31)

| Endpoint | Status | Result |
|---|---|---|
| `GET /api/auth/session` | 200 | `{"status":"UNAUTHENTICATED","authenticated":false}` |
| `GET /api/v1/bootstrap` | 200 | `{"status":"UNAUTHENTICATED","authenticated":false,"routing":"login"}` |
| `GET /api/v1/me` | 401 | Unauthorized (no session cookie) |
| `GET /api/auth/google/start` | 302 | Redirects to Google OAuth with state+nonce+scopes |

### Architecture Notes

- **Platform session** (`qcu_platform_session`) is separate from **integration session** (`qcu_google_session`). Platform uses `openid email profile`; integration uses Classroom/Gmail scopes.
- User identity: Google `sub` → internal `userId` (`user_{sub}`). No DB dependency in dev; in-memory mock store.
- User lifecycle: NEW → AUTHENTICATED → ONBOARDING → ACTIVE → DEACTIVATED. Validated state transitions enforced on PATCH /api/v1/me.
- Admin role exists but is never auto-assigned. Default role: `student`.
- CSRF tokens generated and validated via encrypted cookies.
- All auth cookies are HttpOnly + SameSite=Lax + Secure (in HTTPS).
- Session cookie max age: 30 days. CSRF cookie max age: 10 minutes.

---

## CHUNK 24 — Student Onboarding, COR Upload & Registration

**Date started:** 2026-08-31
**Status:** Complete
**Scope:** COR upload, validation, extraction processing, student review, academic matching, confirmation, lifecycle transition to ACTIVE

### What CHUNK 24 delivers

1. **COR upload endpoint** — `POST /api/v1/cor/upload` — Multipart file upload with type validation (PDF/JPG/PNG), size limit (10 MB), magic bytes check, rate limiting, and duplicate detection. Stores files and records in-memory for dev.
2. **COR status endpoint** — `GET /api/v1/cor/status` — Returns current processing status for the authenticated user's active COR.
3. **COR process endpoint** — `POST /api/v1/cor/process` — Triggers extraction (mock in dev). Produces synthetic student info, enrollment details, and schedule data matched against academic catalog.
4. **COR result endpoint** — `GET /api/v1/cor/result` — Returns the extraction draft for student review.
5. **COR review endpoint** — `POST /api/v1/cor/review` — Saves student corrections to the draft. Validates required fields.
6. **COR confirm endpoint** — `POST /api/v1/cor/confirm` — Final confirmation with validation. Creates student profile, enrollment, enrollment subjects, schedule, and schedule entries. Transitions user to ACTIVE.
7. **Onboarding status endpoint** — `GET /api/v1/onboarding/status` — Returns current onboarding stage and next action for frontend routing.
8. **Onboarding page** — `onboarding.html` — Multi-step registration wizard (Welcome → Upload COR → Processing → Review → Confirm → Success).
9. **Onboarding JS** — `assets/js/onboarding.js` — Client-side wizard logic: file selection/drag-drop, upload, polling, review form, corrections, confirmation.

### Safety constraints

- Dev/test config only. No real COR data used.
- AI extraction is untrusted input; draft requires student review before activation.
- COR belongs to authenticated user; cross-user access prevented.
- User state cannot be set to ACTIVE by frontend; requires server-side confirmation.
- Duplicate detection prevents re-creating existing student/enrollment records.
- Final validation before commit: checks required fields, year level range, day validity, time format, and schedule conflicts.

### Changes

| File | Action | Description |
|---|---|---|
| `data/academic-catalog.json` | Created | Synthetic QCU academic catalog (7 departments, 13 programs, 37 subjects) |
| `functions/api/v1/cor/upload.js` | Created | COR file upload with validation, rate limiting, in-memory store |
| `functions/api/v1/cor/status.js` | Created | COR processing status endpoint |
| `functions/api/v1/cor/process.js` | Created | Mock extraction trigger producing synthetic student/schedule data |
| `functions/api/v1/cor/result.js` | Created | Returns extraction draft for review |
| `functions/api/v1/cor/review.js` | Created | Saves student corrections to extraction draft |
| `functions/api/v1/cor/confirm.js` | Created | Final confirmation, record creation, lifecycle transition |
| `functions/api/v1/onboarding/status.js` | Created | Onboarding stage and next action |
| `onboarding.html` | Created | Multi-step registration wizard page |
| `assets/js/onboarding.js` | Created | Client-side wizard logic |
| `scripts/dev-server.mjs` | Modified | Register COR and onboarding routes |
| `service-worker.js` | Modified | Add `onboarding.html` and `onboarding.js` to cache, bump to v52 |

### Onboarding flow

```
Google Login → Authenticated → ONBOARDING
  → Welcome (step 1)
  → Upload COR (step 2)
  → Processing (step 2b, polls status)
  → Review extracted info (step 3)
  → Confirm and finish (step 4)
  → Success → Dashboard
```

### API endpoints added

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/cor/upload` | Upload COR file (multipart) |
| GET | `/api/v1/cor/status` | Get COR processing status |
| POST | `/api/v1/cor/process` | Trigger extraction |
| GET | `/api/v1/cor/result` | Get extraction draft |
| POST | `/api/v1/cor/review` | Save student corrections |
| POST | `/api/v1/cor/confirm` | Confirm and activate |
| GET | `/api/v1/onboarding/status` | Get onboarding stage |

---

## CHUNK 25 — Repository Layer (Centralized Data Access)

**Date started:** 2026-08-31
**Status:** Complete (BLOCKED on Google Sheets infrastructure)
**Scope:** Replace in-memory Maps with centralized repository abstraction, ultimately backed by Google Sheets

### What CHUNK 25 delivers

1. **Repository abstraction layer** — `functions/api/repo/index.js` — Centralized data access for all entities (Users, CorRecords, CorFiles, CorDrafts, Profiles, Enrollments, EnrollmentSubjects, Schedules, ScheduleEntries, Concurrency, DevReset).
2. **In-memory dev adapter** — All repositories backed by Maps in dev mode. Same interface as future Google Sheets adapter.
3. **Auth library updated** — `auth/_lib.js` no longer owns in-memory Maps; delegates to `Users` repo.
4. **All COR endpoints migrated** — `upload.js`, `process.js`, `result.js`, `review.js`, `status.js`, `confirm.js` all delegate to repo modules.
5. **Onboarding status migrated** — `onboarding/status.js` imports from repo instead of `cor/upload.js`.
6. **Repository modules:**
   - `Users` — CRUD by userId and googleSub, state tracking, user lookup
   - `CorRecords` — Create, getById, getActiveByUserId, getByOwner, update status/draftVersion
   - `CorFiles` — Store and retrieve file bytes
   - `CorDrafts` — Set, get, delete extraction drafts
   - `Profiles` — Create and get student profiles
   - `Enrollments` — Create, get, getByUserId, getByTerm
   - `EnrollmentSubjects` — Create, get, getByEnrollment, getByUser
   - `Schedules` — Create, get, getByEnrollment, getByUser
   - `ScheduleEntries` — Create, get, getBySchedule, getByUser
   - `Concurrency` — withLock, isDuplicateUser, getDuplicateCorRecord
   - `DevReset` — Clear all data, get counts

### Safety constraints

- **BLOCKED:** Google Sheets infrastructure does not exist — no Sheet, no Apps Script, no Service Account, no `.dev.vars`.
- Repository layer built with in-memory adapter as interim. Same interface will support Sheets adapter.
- All entity CRUD goes through repository; no direct Map access from endpoints.
- Concurrency module prevents duplicate COR records and provides locking.
- No real student data imported; all synthetic/dev data only.

### Changes

| File | Action | Description |
|---|---|---|
| `functions/api/repo/index.js` | Created | Centralized repository layer (542 lines) |
| `functions/api/auth/_lib.js` | Modified | Removed in-memory `_users` Map; delegates to `Users` repo |
| `functions/api/v1/cor/upload.js` | Modified | Imports from repo; removed `_corRecords`/`_corFiles`/`_corDrafts` Maps |
| `functions/api/v1/cor/process.js` | Modified | Imports from repo; uses `CorRecords.update()`, `CorDrafts.set()` |
| `functions/api/v1/cor/result.js` | Modified | Imports from repo; uses `CorRecords.getById()`, `CorDrafts.get()` |
| `functions/api/v1/cor/review.js` | Modified | Imports from repo; uses `CorDrafts.set()`, `CorRecords.update()` |
| `functions/api/v1/cor/status.js` | Modified | Imports from repo; uses `CorRecords.getById()` |
| `functions/api/v1/cor/confirm.js` | Modified | Imports from repo; uses `Profiles.create()`, `Enrollments.create()`, etc. |
| `functions/api/v1/onboarding/status.js` | Modified | Imports from repo instead of `cor/upload.js` |

### Test Results (dev server, 2026-08-31)

| Endpoint | Method | Status | Result |
|---|---|---|---|
| `GET /api/dev/health` | GET | 200 | `{"status":"OK","functions":true}` |
| `GET /api/v1/bootstrap` | GET | 200 | `{"status":"UNAUTHENTICATED","authenticated":false,"routing":"login"}` |
| `GET /api/auth/session` | GET | 200 | `{"status":"UNAUTHENTICATED","authenticated":false}` |
| `GET /api/v1/me` | GET | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |
| `GET /api/v1/onboarding/status` | GET | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |
| `GET /api/v1/cor/status` | GET | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |
| `GET /api/v1/cor/result` | GET | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |
| `POST /api/v1/cor/process` | POST | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |
| `POST /api/v1/cor/review` | POST | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |
| `POST /api/v1/cor/confirm` | POST | 401 | `{"status":"UNAUTHORIZED","error":"Not authenticated"}` |

All endpoints respond correctly with proper auth gates.

### Unit test (repository layer)

```
1. Cleared all data: { users: 0, corRecords: 0, ... }
2. Created user: user_google-sub-123 AUTHENTICATED
3. Created COR record: cor_4b7cbc2c... ACCEPTED
4. Stored file bytes
5. User state: ONBOARDING
6. Saved extraction draft
7. Record status: REVIEW_REQUIRED
8. Found user by ID: user_google-sub-123
9. Found COR record: cor_4b7cbc2c... REVIEW_REQUIRED
10. Found draft: true Test
11. Active COR record: cor_4b7cbc2c...
FULL FLOW TEST PASSED
```

### Completion Criteria

- [x] Repository abstraction with consistent CRUD interface
- [x] In-memory dev adapter (same interface as future Sheets adapter)
- [x] Auth library migrated to use `Users` repo
- [x] All 6 COR endpoints migrated to use repo modules
- [x] Onboarding status migrated to use repo
- [x] All 12 API endpoints respond correctly
- [x] No direct in-memory Map references in any API endpoint
- [ ] **BLOCKED:** Google Sheets persistence (requires manual setup of Sheet, Apps Script, Service Account)
- [ ] **BLOCKED:** `.dev.vars` with `GOOGLE_SESSION_SECRET`

### Blocked Items

Google Sheets infrastructure must be manually set up before actual persistence can be implemented:

1. **Google Sheet** — Create a dedicated Google Sheet workbook for the project database
2. **Apps Script** — Deploy an Apps Script web app as the data-access layer
3. **Service Account** — Create a Google Cloud service account and download JSON credentials
4. **`.dev.vars`** — Create file with `GOOGLE_SESSION_SECRET` for session encryption

Until these are provided, the repository layer uses in-memory Maps for development.

---

## CHUNK 26 — Dynamic QCU Academic Catalog & Student Schedule Persistence

**Date started:** 2026-08-31
**Status:** In progress
**Scope:** Replace hardcoded personal/synthetic data with catalog-driven, enrollment-linked, student-isolated academic data across the full stack.

### What CHUNK 26 delivers

1. **Academic catalog repository modules** — 7 new modules in `functions/api/repo/index.js`: `Campuses`, `Departments`, `Programs`, `Terms`, `Subjects`, `CatalogBuildings`, `CatalogRooms`. Each provides `getAll()`, `getById()`, `getActive()`, and domain-specific lookups. `CatalogSeed` module handles bulk loading from JSON and tracks metadata (version, loadedAt, counts).
2. **7 public catalog API endpoints** — `GET /api/v1/academic/{campuses,departments,programs,terms,subjects,buildings,rooms}`. All public (no auth), return active items with count.
3. **Catalog seeding in dev server** — `scripts/dev-server.mjs` reads `data/academic-catalog.json` at startup, loads into `CatalogSeed`, logs counts.
4. **Frontend `AcademicCatalog` helper** — `assets/js/academic.js` singleton with sessionStorage caching (5-min TTL), ID/code resolvers, `getCurrentTerm()`, `resolveBranding(enrollment)`, and category lookups (buildings-by-campus, rooms-by-building, programs-by-department, subjects-by-department).
5. **QCU_DEFAULTS removal** — Entire hardcoded constant removed from `app.js`. Empty arrays for `schedule` and `buildings`. New state fields: `academic`, `profile`, `enrollment`.
6. **Habib greeting removal** — Both hardcoded `Habib` references replaced with `${state.profile?.name || "Student"}`.
7. **API-driven init()** — `app.js` init rewritten to load catalog from API (`AcademicCatalog.init()`), profile from `/api/v1/me`, buildings from academic catalog API. Schedule left empty pending dashboard endpoint wiring.
8. **Bootstrap academic metadata** — `GET /api/v1/bootstrap` now returns lightweight `academic` context: `catalogVersion`, `currentTermId`, `currentTermName`, `activeEnrollmentId`, `activeProgramId`, `activeCampusId`.
9. **Schedule metadata fields** — `revisionReason`, `scheduleStatus` added to `Schedules.create()`. `originType` added to `ScheduleEntries.create()`. `scheduleStatus` added to `EnrollmentSubjects.create()`.
10. **ScheduleEntries.hasConflict()** — Overlap detection method: takes `scheduleId, dayOfWeek, startTime, endTime, excludeId?`, returns array of conflicting ACTIVE entries.
11. **confirm.js catalog resolution** — `cor/confirm.js` updated to use repo catalog modules instead of direct JSON file reads. Proper catalog ID validation before creating enrollment records.
12. **academic.js script tags** — Added to all 8 HTML files that load `app.js` (index, schedule, today, workspace, settings, buildings, campus-eta, google).
13. **Synthetic student fixtures** — 3 isolated test students created and verified: Student A (BSCS), Student B (BSIT), Student C (BSBA). Each with isolated profile, enrollment, schedule, and entries.
14. **Data isolation verified** — Student A cannot see Student B's entries. Term isolation confirmed. Program/department resolution from catalog confirmed.

### Safety constraints

- All 7 catalog APIs are public/read-only. No auth required. Shared QCU reference data.
- Legacy JSON files (`data/schedule.json`, `data/buildings.json`, etc.) kept as dev fixtures. Not in authenticated production data flow.
- Synthetic student data never seeded into production. Only used for testing.
- Never invent official QCU academic data. Unconfirmed entries marked `SYNTHETIC` or `PROVISIONAL`.

### Changes

| File | Action | Description |
|---|---|---|
| `functions/api/repo/index.js` | Modified | Added 7 catalog modules, CatalogSeed, hasConflict(), metadata fields, DevReset.clearCatalog() |
| `functions/api/v1/academic/campuses.js` | Created | Public catalog API — GET active campuses |
| `functions/api/v1/academic/departments.js` | Created | Public catalog API — GET active departments |
| `functions/api/v1/academic/programs.js` | Created | Public catalog API — GET active programs |
| `functions/api/v1/academic/terms.js` | Created | Public catalog API — GET all terms |
| `functions/api/v1/academic/subjects.js` | Created | Public catalog API — GET active subjects |
| `functions/api/v1/academic/buildings.js` | Created | Public catalog API — GET active buildings |
| `functions/api/v1/academic/rooms.js` | Created | Public catalog API — GET active rooms |
| `scripts/dev-server.mjs` | Modified | Register 7 academic routes, catalog seeding at startup |
| `assets/js/academic.js` | Created | Frontend AcademicCatalog helper with caching and resolvers |
| `assets/js/app.js` | Modified | Removed QCU_DEFAULTS, Habib greeting, loadJson; API-driven init |
| `functions/api/v1/bootstrap.js` | Modified | Added lightweight academic metadata (term, campus, catalog version) |
| `functions/api/v1/cor/confirm.js` | Modified | Use repo catalog modules instead of JSON file reads |
| `index.html` | Modified | Added academic.js script tag |
| `schedule.html` | Modified | Added academic.js script tag |
| `today.html` | Modified | Added academic.js script tag |
| `workspace.html` | Modified | Added academic.js script tag |
| `settings.html` | Modified | Added academic.js script tag |
| `buildings.html` | Modified | Added academic.js script tag |
| `campus-eta.html` | Modified | Added academic.js script tag |
| `google.html` | Modified | Added academic.js script tag |

### Test Results (dev server, 2026-08-31)

**Repository unit tests:**
```
Campuses: 1
Departments: 7
Programs: 13
Terms: 2
Subjects: 38
Buildings: 4
Rooms: 7
Conflict test: PASS
Schedule metadata: Initial enrollment ACTIVE
Entry metadata: COR_IMPORT
After clearCatalog: PASS
ALL TESTS PASSED
```

**Data isolation tests:**
```
Student A entries: PASS
Student B entries: PASS
Student C entries: PASS
A cannot see B: PASS
Student A enrollments: 1 PASS
BSCS program: Bachelor of Science in Computer Science
BSCS department: dep_ccs
ALL ISOLATION TESTS PASSED
```

**HTTP endpoint smoke tests:**
```
PASS /api/v1/academic/campuses 200 OK
PASS /api/v1/academic/departments 200 OK
PASS /api/v1/academic/programs 200 OK
PASS /api/v1/academic/terms 200 OK
PASS /api/v1/academic/subjects 200 OK
PASS /api/v1/academic/buildings 200 OK
PASS /api/v1/academic/rooms 200 OK
PASS /api/v1/me 401 UNAUTHORIZED
PASS /api/v1/cor/status 401 UNAUTHORIZED
PASS /api/v1/onboarding/status 401 UNAUTHORIZED
PASS /api/v1/bootstrap 200 UNAUTHENTICATED
PASS /api/auth/session 200 UNAUTHENTICATED
ALL 12 SMOKE TESTS PASSED
```

### Completion Criteria

- [x] 7 academic catalog repository modules with full CRUD
- [x] 7 public catalog API endpoints (GET only, no auth)
- [x] Catalog seeding from `data/academic-catalog.json` in dev server
- [x] Frontend `AcademicCatalog` helper with caching and resolvers
- [x] `QCU_DEFAULTS` removed from app.js
- [x] `Habib` greeting replaced with dynamic student name
- [x] `app.js` init() uses API instead of JSON files
- [x] Bootstrap returns lightweight academic metadata
- [x] Schedule metadata fields (scheduleStatus, revisionReason, originType)
- [x] ScheduleEntries.hasConflict() overlap detection
- [x] confirm.js uses repo catalog modules
- [x] academic.js loaded in all 8 HTML files
- [x] Synthetic student fixtures created and isolated
- [x] Data isolation verified (per-user, per-term)
- [x] Hardcoded personal data references cleaned from JS/HTML
- [x] 12 HTTP endpoint smoke tests pass
- [x] Student dashboard API endpoint wiring (CHUNK 27)
- [x] Dynamic academic branding rendering in frontend (CHUNK 27)
- [x] Service worker cache isolation verified for authenticated endpoints
- [x] Loading/empty/error states in app.js
- [ ] **BLOCKED:** Google Sheets persistence (requires manual setup)
- [ ] **BLOCKED:** `.dev.vars` with `GOOGLE_SESSION_SECRET`

---

## CHUNK 27 — Student Dashboard Migration

**Date:** 2026-08-31
**Status:** Complete
**Scope:** Convert dashboard from static/legacy data loading to fully authenticated, user-specific dashboard powered by a single backend endpoint.

### What CHUNK 27 delivers

1. **Authenticated dashboard endpoint** — `GET /api/v1/dashboard` derives user from session cookie, resolves active enrollment, schedule, entries, buildings, academic context, and profile in a single round-trip.
2. **Dynamic academic branding** — Header subtitle now reads from `state.academic` (program name, department, campus) instead of hardcoded "BS Computer Science · San Bartolome".
3. **Frontend migration** — `app.js` init() replaced separate `AcademicCatalog.init()` + `/api/v1/me` calls with single `GET /api/v1/dashboard` fetch.
4. **3 synthetic student fixtures** — Maria Santos (BSCS-2A, 8 entries), Juan Dela Cruz (BSIT-1B, 7 entries), Ana Reyes (BSBA-3A, 5 entries) seeded on dev server startup.
5. **Loading/empty/error states** — `state.loading`, `state.error` fields added; UI renders spinner during load, error message on failure, empty schedule message when no classes.
6. **Service worker isolation** — `/api/v1/` already in `NO_CACHE_PATHS`; authenticated responses never cached in shared cache.
7. **Entry-to-UI mapping** — `mapEntryToSchedule()` converts dashboard entries to the format `renderSchedule()`, `renderToday()`, and `buildingByCode()` expect.

### Repo API corrections discovered

- `ScheduleEntries` (not `Entries`), `CatalogBuildings` (not `Buildings`)
- `CatalogSeed` has no `getProgramById`/`getDepartmentById`/`getCampusById` — use `Programs.getById`, `Departments.getById`, `Campuses.getById`
- `Schedule` has no `programId`, `termId`, `type`, `subjectCount`, `totalUnits`, `dayCount`, `metadata`
- `Enrollment` has no `scheduleId` field; relationship is `Schedule.enrollmentId → Enrollment.enrollmentId`

### Entry → UI card mapping

| Entry field | UI field | Used by |
|---|---|---|
| `buildingCode` | `item.code` | `buildingByCode()`, `buildingShort()` |
| `code` | `item.course` | Subject code column |
| `title` | `item.subject` | Subject title column |
| `buildingName` | `item.buildingName` | `buildingLabel()`, `buildingShort()` (preferred) |
| `roomCode` | `item.room` | Room column |
| `floor` | `item.floor` | `floorShort()` |

### Smoke tests

```
PASS Health (200)
PASS Dashboard (401 — requires auth, correct)
PASS Bootstrap (200)
PASS Me (401 — requires auth, correct)
PASS Academic Campuses (200, 1 campus)
PASS Academic Departments (200, 6 departments)
PASS Academic Programs (200, 13 programs)
PASS Academic Terms (200, 2 terms)
PASS Academic Subjects (200, 38 subjects)
PASS Academic Buildings (200, 4 buildings)
PASS Academic Rooms (200, 10 rooms)
PASS Google Status (200)
PASS Static files (11/11)
ALL SMOKE TESTS PASSED
```

---

## CHUNK 28 — Student Schedule CRUD & Manual Editing

**Date started:** 2026-08-31
**Status:** Complete
**Scope:** Authenticated student schedule management (CREATE/READ/UPDATE/DELETE) with ownership verification, conflict detection, provenance tracking, and frontend CRUD UI

### What CHUNK 28 delivers

1. **GET /api/v1/schedule** — Returns all active entries for authenticated user's active enrollment, with resolved subject/building/room details.
2. **POST /api/v1/schedule/entries** — Creates a new schedule entry with:
   - Ownership verification (enrollmentSubjectId must belong to user's active enrollment)
   - Catalog validation (buildingId, roomId, dayOfWeek, times)
   - Time conflict detection via `ScheduleEntries.hasConflict()`
   - Exact duplicate prevention
   - `originType = STUDENT_MANUAL` for all student-created entries
3. **PATCH /api/v1/schedule/entries/:id** — Updates an existing entry with:
   - Full ownership chain verification (entry → schedule → enrollment → user)
   - Conflict detection (excluding self)
   - Provenance preservation (COR imports retain `COR_IMPORT` origin)
4. **DELETE /api/v1/schedule/entries/:id** — Soft-deletes an entry (marks as `REMOVED`) with ownership verification.
5. **Repository layer additions** — Added `update()` and `delete()` methods to `ScheduleEntries` repo.
6. **Frontend CRUD UI:**
   - Floating Action Button (FAB) on schedule page for adding classes
   - Add/Edit modal with subject dropdown, day picker, time inputs, building→room cascading selects
   - Delete confirmation dialog
   - Error display for validation failures
   - Automatic schedule reload and UI re-render after mutations
7. **Provenance indicators** — Visual badges on schedule cards showing "📋 COR" for imported entries and "✦ You" for student-added entries.
8. **Edit buttons** — Pencil icon on each schedule card/row for quick editing.
9. **Dev server updates:**
   - CORS headers now allow `PATCH` and `DELETE` methods
   - Parameterized route handling for `/api/v1/schedule/entries/:id`
   - `sendWebResponse` fix: `Set-Cookie` headers now included in `writeHead` instead of separate `setHeader` call

### Security model

- Server derives ownership from authenticated session; never trusts client-supplied IDs
- Every related resource (entry, schedule, enrollment) is verified against the authenticated user
- `originType` is always set server-side — never from client input
- Conflict detection runs server-side for every create/update
- Soft-delete preserves audit trail

### Changes

| File | Action | Description |
|---|---|---|
| `functions/api/v1/schedule/index.js` | **NEW** | GET /api/v1/schedule — list entries with ownership |
| `functions/api/v1/schedule/entries.js` | **NEW** | POST /api/v1/schedule/entries — create with conflict detection |
| `functions/api/v1/schedule/entries/[id].js` | **NEW** | PATCH/DELETE /api/v1/schedule/entries/:id — update/delete with ownership |
| `functions/api/repo/index.js` | MODIFIED | Added `update()` and `delete()` methods to ScheduleEntries |
| `scripts/dev-server.mjs` | MODIFIED | Added route imports, CORS for PATCH/DELETE, parameterized route handling, Set-Cookie fix |
| `assets/js/app.js` | MODIFIED | Added CRUD API functions, modal, provenance badges, edit buttons, reload logic |
| `assets/css/styles.css` | MODIFIED | Added CRUD form, provenance badges, edit button, responsive styles |
| `schedule.html` | MODIFIED | Added CRUD modal container, FAB button |

### Smoke tests

```
1. GET /schedule (no auth): 401 ✓
2. POST /schedule/entries (no auth): 401 ✓
3. schedule.html status: 200 ✓
   Has crud-modal: True
   Has schedule-add-btn: True
4. app.js status: 200 ✓
   Has CRUD functions: True
   Has provenance: True
   Has CRUD modal: True
5. styles.css status: 200 ✓
   Has CRUD styles: True
   Has provenance styles: True
6. Academic subjects: 38 items ✓
ALL SMOKE TESTS PASSED
```

---

## CHUNK 29 — Student Productivity CRUD (Tasks & Notes)

**Date started:** 2026-08-31
**Status:** Complete
**Scope:** Full backend CRUD for Tasks and Notes with ownership isolation, dashboard summaries, frontend API migration, and cross-user security

### What CHUNK 29 delivers

1. **Tasks CRUD API:**
   - `GET /api/v1/tasks` — List all OPEN/COMPLETED tasks for authenticated user (excludes DELETED)
   - `POST /api/v1/tasks` — Create task with title, description, priority, dueDate, optional subjectId/scheduleEntryId
   - `PATCH /api/v1/tasks/:id` — Update task fields with ownership verification; auto-sets completedAt on COMPLETED
   - `DELETE /api/v1/tasks/:id` — Soft-delete (status → DELETED, sets deletedAt)
   - Enriched response: subjectCode, subjectName, scheduleDay, scheduleTime resolved from catalog
   - Validation: title required, priority LOW/MEDIUM/HIGH, status OPEN/COMPLETED/DELETED, dueDate must be ISO date

2. **Notes CRUD API:**
   - `GET /api/v1/notes` — List all ACTIVE notes for authenticated user (excludes DELETED)
   - `POST /api/v1/notes` — Create note with title, body, optional subjectId/scheduleEntryId
   - `PATCH /api/v1/notes/:id` — Update note fields with ownership verification
   - `DELETE /api/v1/notes/:id` — Soft-delete (status → DELETED, sets deletedAt)
   - Enriched response: subjectCode, subjectName, scheduleDay, scheduleTime
   - Validation: title required, body optional

3. **Repository layer extensions** (`functions/api/repo/index.js`):
   - `Tasks` module: create, getById, getByUserId, update (with special completedAt logic), soft-delete
   - `Notes` module: create, getById, getByUserId, update, soft-delete
   - In-memory `_tasks` and `_notes` Maps; DevReset.clearAll() clears both

4. **Dashboard integration** (`functions/api/v1/dashboard.js`):
   - `formatDashboardTasks(userId)` — Returns today's open tasks, upcoming tasks (7 days), overdue tasks, recent notes
   - `formatDashboardNotes(userId)` — Returns recent notes
   - Replaced hardcoded empty arrays with real data queries

5. **Dev server routing** (`scripts/dev-server.mjs`):
   - GET/POST `/api/v1/tasks` and `/api/v1/notes` registered as static routes
   - PATCH/DELETE for `tsk_*` and `nt_*` prefixes via parameterized handling

6. **Frontend migration** (`assets/js/app.js`):
   - Tasks: localStorage replaced with API-backed async CRUD (`_tasksCache`, `fetchTasksFromApi()`)
   - Notes: localStorage replaced with API-backed async CRUD (`_notesCache`, `fetchNotesFromApi()`)
   - All task/note event handlers converted to async
   - Dashboard init seeds `_tasksCache` and `_notesCache` from dashboard response
   - Workspace view setup awaits task/note fetch before rendering

### Security model

- Server derives ownership from authenticated session; never trusts client-supplied userId/profileId
- Every related resource (subject, schedule entry) is verified against authenticated user before linking
- Cross-user isolation: Student A cannot see, modify, or delete Student B's tasks/notes
- Soft-delete preserves audit trail

### Smoke tests (2026-08-31)

```
=== Tasks CRUD ===
  ✓ Maria GET tasks returns 200
  ✓ Maria tasks is array
  ✓ Create task returns 201
  ✓ Task has tsk_ prefix
  ✓ Task title matches
  ✓ Task priority HIGH
  ✓ Task status OPEN
  ✓ Second task created
  ✓ List shows 2 tasks
  ✓ Patch returns 200
  ✓ Status updated to COMPLETED
  ✓ Description updated
  ✓ completedAt set
  ✓ Juan sees 0 tasks (isolation)
  ✓ Juan patch returns 404 (isolation)
  ✓ Juan delete returns 404 (isolation)
  ✓ Delete returns 200
  ✓ Delete returns DELETED status
  ✓ List shows 1 task after delete
  ✓ Patch deleted returns 404

=== Notes CRUD ===
  ✓ Create note returns 201
  ✓ Note has nt_ prefix
  ✓ Note title matches
  ✓ Second note created
  ✓ Notes list shows 2
  ✓ Note patch returns 200
  ✓ Note title updated
  ✓ Juan sees 0 notes (isolation)
  ✓ Juan note patch returns 404 (isolation)
  ✓ Note delete returns 200
  ✓ Notes list shows 1 after delete
  ✓ Missing title returns 422
  ✓ Missing note title returns 422

=== Results: 33 passed, 0 failed ===
ALL SMOKE TESTS PASSED
```

### Changes

| File | Action | Description |
|---|---|---|
| `functions/api/repo/index.js` | MODIFIED | Added Tasks and Notes repository modules with CRUD methods |
| `functions/api/v1/tasks/index.js` | NEW | Tasks GET/POST with auth, validation, ownership resolution |
| `functions/api/v1/tasks/[id].js` | NEW | Tasks PATCH/DELETE with ownership verification |
| `functions/api/v1/notes/index.js` | NEW | Notes GET/POST with auth, validation, ownership resolution |
| `functions/api/v1/notes/[id].js` | NEW | Notes PATCH/DELETE with ownership verification |
| `functions/api/v1/dashboard.js` | MODIFIED | Added formatDashboardTasks/Notes helpers, real task/note data |
| `scripts/dev-server.mjs` | MODIFIED | Added task/note route imports, GET/POST, parameterized PATCH/DELETE |
| `assets/js/app.js` | MODIFIED | localStorage → API-backed async CRUD for tasks and notes |
| `scripts/test-tasks-notes.mjs` | NEW | Smoke test script for tasks/notes CRUD + isolation |
