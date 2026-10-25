# Dashboard Redesign — Plan Prompt (QCU-Schedule)

> Copy this whole document as the prompt for the redesign task. It was written
> against the actual codebase, so every instruction references real files,
> functions, element IDs, and data fields. No guessing required.

---

## Role & Objective

Act as an expert frontend developer and UI/UX engineer. Redesign the student
dashboard of the QCU Schedule web app
(https://github.com/TsmHabib03/QCU-Schedule-Web-App) to match the visual
language of the provided reference image
(`bbbd82a062f5841b4eb4c94ff616c977.jpg`, mirrored locally by
`design-mockup/home-dashboard.html`): soft drop shadows, large rounded corners,
pastel and vibrant block colors, clean sans-serif typography.

Adapt the **aesthetic only**. The reference is a generic task manager; this app
is a student schedule PWA. Do not copy its text, its "Search a task…" widget,
its To-Do / Progress / Done category buttons, or its hamburger menu.

This is a **reskin + feature extension of an existing, working app**, not a
rebuild. Preserve all authentication, routing, state management, caching, and
backend integrations exactly as they are.

---

## Codebase Map (verified — read these before editing)

| Concern | Where |
|---|---|
| Landing + dashboard (one page, auth-gated) | `index.html` — `#auth-landing` (public) and `#auth-dashboard` (authenticated), toggled by the inline auth-gate script in `<head>` (~lines 29–133) |
| All rendering logic | `assets/js/app.js` (~3,100 lines) |
| Dashboard data fetch + session cache | `assets/js/data-cache.js` → `window.QCUData.dashboard()`; snapshot in `sessionStorage`, verified via `?check=1`, invalidated across tabs via `BroadcastChannel` |
| Dashboard design system | `assets/css/soft-ui.css` (`--soft-primary: #4A3AFF`, pastel tints, `home-today-*` / `soft-*` classes) |
| Base shell + loading | `assets/css/styles.css`, `assets/css/student.css`, `assets/css/loading.css`, `assets/js/loading.js` (`QCULoading`, `data-loading-region="shell|dashboard"` skeletons) |
| Reference mockup (target look) | `design-mockup/home-dashboard.html` (Tailwind + Poppins; phone-frame layout) |
| Build / cache-busting / deploy | `package.json` — `npm run build` = `build:css` + `build:cache` (generates the `?v=` hashes on every asset link) + `build:pages` (stages `.build/pages`); deploy via wrangler |
| Backend | Cloudflare Pages Functions in `functions/api/**` — **out of scope, do not modify** |
| Tests to keep green | `npm run test:student`, `test:loading`, `test:schedule`, `test:cache` |

### Data you will render (already available — no new endpoints needed)

`GET /api/v1/dashboard` returns, among other things:

```jsonc
{
  "status": "OK", "routing": "dashboard", "cacheKey": "…",
  "entries": [ /* schedule entries */ ],
  "profile": {
    "userId": "…", "email": "…",
    "name": "Full Name",              // COR-extracted name, falls back to Google account name
    "picture": "https://lh3.googleusercontent.com/…",  // Google profile photo — MAY BE NULL
    "profile": { "firstName": "…", "middleName": "…", "lastName": "…" }
  },
  "academic": { "program": {…}, "campus": {…}, "term": {…}, "enrollmentSubjects": […] },
  "buildings": [ … ], "tasks": [ … ], "notes": [ … ]
}
```

Each entry is normalized by `mapEntryToSchedule()` (app.js:213) into:

```
{ day, start, end, subject, course, building, buildingName, code,
  room, floor, units, instructor, notes, entryId, originType, modality }
```

- `course` = subject/course code (e.g. `CC102`), `subject` = title.
- `instructor` = professor name — **already in the model, currently not shown on dashboard cards. Add it.**
- `day` is a weekday **name** (`"Monday"`…), not a date — the schedule is a recurring weekly pattern.

### Critical invariants (violating these breaks the app)

1. **Times**: always go through `parseMinutes()` (app.js:73). It accepts
   `"08:00"`, `"8:00 AM"`, and Google-Sheets ISO (`1899-12-30T…`). Never
   `.split(":")` a raw time string. Invalid times return `NaN` — every render
   path must stay NaN-safe (existing templates show `"TBA"`/`"Time not set"`).
2. **Clock**: everything is Asia/Manila via `QCU_TIME` (app.js:43). The
   dashboard re-renders **every second** (`tick()` rebuilds today's list for
   live countdowns). Templates must be cheap and deterministic — that is why
   `todayTint()` hashes the course code instead of picking a random pastel.
   Never put non-deterministic markup (random ids, Math.random) inside a
   per-second template.
3. **Auth gate**: the `<head>` script in `index.html` decides
   landing vs. dashboard vs. redirect (admin/onboarding). Do not touch it or
   move it. New dashboard markup goes inside `#auth-dashboard` only.
4. **Cache discipline**: `window.QCUData.dashboard()` is the single data path;
   never `fetch('/api/v1/dashboard')` directly from new UI code. Call
   `renderHome()`-style functions from `applyDashboard()` / `tick()` as the
   existing code does (app.js:2792, 952).
5. **Build**: all asset links carry generated `?v=` hashes. After editing
   HTML/CSS/JS, run `npm run build` — never hand-edit the `?v=` strings.
6. **Light mode only.** No dark mode. Icons via lucide (`iconify()`), never emoji.
7. **PWA**: keep `manifest.json`, `service-worker.js`, offline fallback, and
   the skeleton/`aria-busy` loading regions working; update skeletons in
   `loading.css` if the new layout has different shapes.

---

## Specific UI/UX Transformations

### 1. Header & Navigation

**No hamburger menu.** The app has none today and must not gain one.
Navigation stays exactly where it is: the bottom nav rendered by
`renderShell()` (app.js:319) — Home / Bus / center Classroom FAB / Tasks /
Settings. Keep it byte-for-byte unless a color-token rename touches it.

**Google profile avatar.** Replace the static brand/`data-student-name` hero
treatment with a live avatar component:

- Source: `state.profile.picture` (already returned by the dashboard endpoint —
  no OAuth, GIS client, or backend change is needed).
- Render a circular photo (~44–48 px, 2–3 px white ring, soft shadow) at the
  top-right of the dashboard hero, beside the existing weather chip
  (`#home-weather-chip`). Tapping it navigates to `settings.html`.
- Fallbacks, in order: Google photo → initials disc built from
  `state.profile.name` (first letters of first + last word, on a
  `--soft-primary` background) → generic `user` lucide icon.
- Escape the URL with `esc()`, set a meaningful `alt` (the student's name),
  lazy-load, and handle `onerror` by swapping to the initials disc.
- The avatar must live in markup that is **not** rebuilt by the per-second
  tick (hero text uses `setText()`; keep using it — see app.js:963-965).

**Greeting.** The hero already computes a Manila-hour greeting in
`renderHome()`. Extend it to the reference pattern:

- Line 1: `Good morning|afternoon|evening, FirstName` (first word of
  `state.profile.name`, as app.js:965 already does).
- Line 2 (new): a schedule summary — `You have N classes today`
  (N = `classesForDay(QCU_TIME.weekday()).length`), `No classes today — enjoy
  the break`, or `All N classes done` when everything is finished.
- When a non-today day is selected in the calendar strip (below), the summary
  switches to `N classes on {Day}`.

### 2. Component Removals (read carefully)

There is **nothing to delete**: the production dashboard never had a hamburger,
a "Search a task…" bar, or To-Do/Progress/Done buttons — those exist only in
the reference image and the Tailwind mockup. The requirement therefore means:

- **Do not port** any of those task-manager widgets into the new dashboard.
- Leave `workspace.html` (Tasks & Notes page) and its search/filters
  completely alone — that is a different page with its own purpose.
- The dashboard's "Tasks & Notes" mini-column (`renderTasksNotesColumn()`,
  app.js:854) may remain as a compact preview; restyle it with the new tokens
  but keep its function.

### 3. Core Scheduling Features

**Calendar strip (horizontal day picker).** Add a horizontal, scrollable
Mon–Sun strip directly under the hero, styled like the reference's date
picker:

- Evolve the existing `weekStripTemplate()` (app.js:406) — it already renders
  Mon–Sun pills with this week's real dates and per-day class counts.
- Each pill: 3-letter day name + date number; the selected day gets the solid
  `--soft-primary` fill, white text, pill radius (`9999px`), and the fab-style
  shadow; unselected days show a small dot (or count) when classes exist.
- Default selection = today. Selecting a day re-renders the class timeline
  below via `classesForDay(day)` (app.js:1038) **inline** — this replaces the
  old "tap a pill → day modal" interaction; `openDayModal()` may be retired
  for the dashboard once parity is confirmed (keep it if `schedule.html`
  still uses it).
- Markup as a `role="tablist"` / `role="tab"` set with `aria-selected`,
  arrow-key support, and `aria-live="polite"` on the timeline container.
- Scroll-into-view the selected pill on load; hide the scrollbar
  (`scrollbar-width: none` + `::-webkit-scrollbar{display:none}`).
- The schedule is a weekly pattern (entries carry day names, not dates), so
  the strip covers the current week only. Week-to-week paging is **out of
  scope** — do not fake future dates.

**Class details timeline (vertical).** The dashboard already renders a
vertical day timeline (`#today-grid`, built from `todayTileTemplate()`,
`todayDoneRowTemplate()`, `breakTileTemplate()`, `nowMarkerTemplate()`).
Redesign it into the reference's stacked, colorful card list:

- Keep the existing structure: finished classes → compact muted "done" rows;
  the in-session/next class as the featured card; break tiles for gaps ≥ 60
  min (`BREAK_MIN`); a subtle "Now" marker line. This logic is battle-tested —
  restyle, don't re-architect.
- **Card contents** (per class card, in the reference's block style):
  - Course code chip (e.g. `CC102`) — `item.course`.
  - Subject title — `item.subject` (use `subjectDisplayName()` where a code
    needs expanding).
  - Time window — `formatTime(item.start)` – `formatTime(item.end)` (NaN-safe:
    `"Time not set"`).
  - Room assignment — `buildingLabel(item) · item.room · item.floor`, joined
    with `.filter(Boolean)` exactly like app.js:536 (never render `"· · —"`).
  - Professor — `item.instructor` with a lucide `user`/`graduation-cap` icon;
    render the row only when the field is non-empty (COR imports often lack it).
  - Live status: keep the In session / Up next / Done / Scheduled badge,
    the "Xm left · ends …" line, and the current-class progress bar
    (`todayTiming()`, app.js:458).
- The featured (current/next) card may render wider/taller — mirror the
  reference's hero card emphasis. All other cards are equal-height blocks.

**Card design tokens.** Align the existing pastel system with the reference
palette (values from `design-mockup/home-dashboard.html`), implemented as CSS
variables in `soft-ui.css`:

| Token | Value |
|---|---|
| Page background | `#F4F5FB` |
| Primary / accent | `#4A3AFF` (already `--soft-primary`) |
| Headings (navy) | `#1B1E39` |
| Secondary text (grey) | `#8E92AD` / `#9AA0B5` |
| Pastel blocks | peach `#FFE8D6` (icon `#FF9F6E`), cyan/mint `#DCF4F7` (icon `#4FC8DD`), lavender `#EAE6FF` (icon `#8B7CF6`) — keep the remaining tints (sky, butter, blush) in the same family |
| Card radius | `22–26px`; pills `9999px` |
| Card shadow | `0 10px 30px -8px rgba(27,30,57,0.10)` |
| Icon squares | 36–40 px, `rgba(255,255,255,0.6)` background, 12 px radius, tinted lucide icon |

Keep the deterministic per-subject tint via `todayTint()` (hash of the course
code) — a subject must keep its color across ticks and days.

Typography: the app already loads **Plus Jakarta Sans** on the dashboard
(`index.html`) and preloads Public Sans — keep the current stack (it matches
the reference's friendly geometric sans) and **do not add Poppins or any new
font dependency**.

---

## Layout Plan (mobile-first)

1. **≤ 420 px (primary target)**: single column — hero (greeting + avatar +
   weather chip) → calendar strip → class timeline → Classroom updates /
   Tasks & Notes preview columns stacked below → footer. Bottom nav stays
   fixed.
2. **≥ 1024 px**: the existing `soft-grid` three-column layout may remain
   (timeline left, calendar + Classroom updates middle, Tasks & Notes right),
   now headed by the full-width hero + calendar strip. The strip lives above
   the columns and drives the timeline column.
3. Verify 320 px, 375 px, 768 px, 1440 px breakpoints in `responsive.css` /
   `soft-ui.css`; no horizontal page scroll at any width (only the strip
   scrolls internally).

---

## Execution Phases

**Phase 0 — Recon (no edits).** Read `index.html`, `assets/js/app.js`
(renderShell, renderHome, weekStripTemplate, today*, applyDashboard, tick),
`assets/js/data-cache.js`, `assets/css/soft-ui.css`, and
`design-mockup/home-dashboard.html`. Confirm every ID and function referenced
above exists.

**Phase 1 — Tokens + hero.** Add/align CSS variables in `soft-ui.css`; build
the avatar component with initials fallback; extend the greeting with the
class-count summary. Files: `soft-ui.css`, `app.js` (renderHome hero block),
`index.html` (hero markup inside `#auth-dashboard`).

**Phase 2 — Calendar strip.** Convert `weekStripTemplate()` into the
tablist strip; wire day selection to re-render the timeline inline; retire
the dashboard day-modal path if parity is confirmed. Keep `schedule.html`
untouched.

**Phase 3 — Class cards.** Redesign `todayTileTemplate()` /
`todayDoneRowTemplate()` / `breakTileTemplate()` with the pastel block style;
add the professor row and course-code chip; align shadows, radii, and the
featured-card emphasis. Keep `todayTint()`, `todayTiming()`, and all NaN-safe
patterns intact.

**Phase 4 — Loading + a11y + responsive.** Update skeleton placeholders to
the new shapes (`loading.css` + inline placeholders in `index.html`); add
`role`/`aria` attributes for the strip and timeline; run the responsive pass.

**Phase 5 — Build & verify.** `npm run build` (regenerates `?v=` hashes and
the staged `.build/pages` build), then:
`npm run test:student && npm run test:loading && npm run test:schedule && npm run test:cache`.
Manually verify: signed-in dashboard, avatar with and without a Google
picture, day switching, per-second countdown still smooth, offline reload
from the session snapshot, and the landing page (`?auth=` error states)
unaffected.

---

## Definition of Done

- [ ] Hero shows greeting + first name, live class-count summary, and the
      Google profile photo (with initials fallback) — no backend changes.
- [ ] No hamburger, no task search bar, no category buttons anywhere on the
      dashboard; `workspace.html` behavior unchanged.
- [ ] Horizontal scrollable Mon–Sun strip defaults to today and re-renders
      the timeline inline; keyboard + screen-reader operable.
- [ ] Class cards are rounded pastel blocks showing course code, subject,
      time, room/building/floor, and professor (when present), with live
      status and the in-session progress bar.
- [ ] Cards keep a deterministic color per subject across ticks.
- [ ] Mobile-first layout verified from 320 px up; no dark mode introduced.
- [ ] Auth gate, routing, `QCUData` cache flow, service worker, and all four
      test suites still pass; `npm run build` succeeds with fresh hashes.

## Out of Scope

- Backend / Cloudflare Functions / OAuth changes (profile.picture already ships).
- `schedule.html`, `workspace.html`, `campus-eta.html`, `buildings.html`,
  `settings.html`, `google.html`, onboarding, and admin flows.
- Week-to-week calendar paging, dark mode, new fonts, and any new dependency.
