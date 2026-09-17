/* ============================================================
   QCU Student Portal — app.js
   All UI templates and rendering logic.
   Light mode only. No dark mode.
   ============================================================ */

const state = {
  schedule: [],
  buildings: [],
  academic: null,  // Academic context from dashboard endpoint
  profile: null,   // Student profile (from dashboard endpoint)
  enrollment: null,
  dashboard: null, // Full dashboard response
  loading: true,
  error: null,
  settings: {
    notifications: localStorage.getItem("qcu-notifications") === "true"
  }
};

const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const page = document.body.dataset.page || "home";
// Sub-pages belong to a nav tab: the Full Schedule and Buildings pages are
// reached from Home, so they highlight Home instead of leaving the whole bar
// with no active tab (which also made their hover states look different from
// every page that does have one).
const NAV_PARENT_PAGE = { schedule: "home", buildings: "home", tasks: "workspace", notes: "workspace", google: "FAB" };
const navPage = NAV_PARENT_PAGE[page] || page;
let scheduleDay = "all";

/* ── Utils ───────────────────────────────────────────── */
function iconify() { if (window.lucide) window.lucide.createIcons(); }

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const QCU_TIME = window.QCU_TIME || (() => {
  const zone = "Asia/Manila";
  function weekday(date = new Date()) {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(date);
  }
  function minutes(date = new Date()) {
    const value = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
    const p = Object.fromEntries(value.map(x => [x.type, x.value]));
    return Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
  }
  function dateLabel(date = new Date(), opts = { month: "short", day: "numeric", year: "numeric" }) {
    return new Intl.DateTimeFormat([], { ...opts, timeZone: zone }).format(date);
  }
  return Object.freeze({ zone, weekday, minutes, dateLabel });
})();
window.QCU_TIME = QCU_TIME;

async function loadJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return fallback;
    const t = await r.text();
    if (!t.trim()) return fallback;
    const d = JSON.parse(t);
    return Array.isArray(d) && d.length ? d : fallback;
  } catch { return fallback; }
}

function parseMinutes(v) {
  // Times reach the UI in several shapes and every one of them must work:
  //   "08:00"                    canonical 24h written by the schedule CRUD
  //   "8:00 AM"                  COR drafts / hand-edited rows
  //   "1899-12-30T00:00:00.000Z" Google Sheets time cells, which the Apps Script
  //                              serialises with Date.toISOString(). Sheets holds
  //                              time-only values on the 1899 epoch, and the ISO
  //                              is UTC — so the campus timezone is what turns
  //                              it back into the 08:00 the student typed.
  // Missing or malformed values must never poison math downstream, so anything
  // unrecognised returns NaN (callers skip it instead of rendering garbage).
  const s = String(v ?? "").trim();
  if (!s) return NaN;

  // "H:MM am/pm" — must be checked before the bare 24h form, or "7:30pm" would
  // silently parse as 07:30.
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)\b/i.exec(s);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 12 || min > 59) return NaN;
    const mer = m[3].toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return h * 60 + min;
  }

  // "HH:MM" (optionally seconds). Trailing text is tolerated ("07:30 - 09:30").
  m = /^(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)/.exec(s);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]);
    return (h > 23 || min > 59) ? NaN : h * 60 + min;
  }

  // ISO datetime (Sheets time cell) — read it in campus time.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (d.getTime() !== d.getTime()) return NaN;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: QCU_TIME.zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(d).map(x => [x.type, x.value]));
    const h = Number(p.hour), min = Number(p.minute);
    if (h !== h || min !== min || h > 23 || min > 59) return NaN;
    return h * 60 + min;
  }

  return NaN;
}

function minutesNow(date = new Date()) {
  return QCU_TIME.minutes(date);
}

function formatTime(v) {
  // Derive the clock from parseMinutes so every accepted input shape formats
  // identically (splitting the raw string broke on ISO values).
  const mins = parseMinutes(v);
  if (mins !== mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

// Stored dates arrive either as "2026-09-14" (date input) or as a full ISO
// datetime ("2026-09-14T16:00:00.000Z"). Rendering the raw value leaked ISO
// strings into task cards, so every date goes through here and is shown in
// campus time. `withTime` defaults to true only when the value carries a clock.
function formatDateLabel(value, withTime) {
  if (!value) return "";
  const date = new Date(value);
  if (date.getTime() !== date.getTime()) return String(value);
  const hasClock = /T\d{2}:\d{2}/.test(String(value));
  const opts = (withTime === undefined ? hasClock : withTime)
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: QCU_TIME.zone }).format(date);
}

function getStatus(item, now = new Date()) {
  if (item.noClasses) return item.day === QCU_TIME.weekday() ? "today-off" : "inactive";
  const today = QCU_TIME.weekday(now);
  if (item.day !== today) return "inactive";
  const cur = minutesNow(now);
  const s = parseMinutes(item.start);
  const e = parseMinutes(item.end);
  if (cur >= s && cur < e) return "current";
  if (cur >= e) return "finished";
  const upcoming = state.schedule
    .filter(x => !x.noClasses && x.day === today && parseMinutes(x.start) > cur)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  return upcoming[0] === item ? "next" : "upcoming";
}

function getCurrentAndNext(now = new Date()) {
  const today = QCU_TIME.weekday(now);
  const current = state.schedule.find(x => !x.noClasses && getStatus(x, now) === "current");
  const next = state.schedule
    .filter(x => !x.noClasses && x.day === today && parseMinutes(x.start) > minutesNow(now))
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start))[0];
  return { current, next };
}

function statusLabel(s) {
  return { current: "Current", next: "Next", finished: "Finished",
           upcoming: "Upcoming", inactive: "Inactive", "today-off": "No Classes" }[s] || "Upcoming";
}

function setText(id, val) {
  document.querySelectorAll(`[id="${id}"]`).forEach(n => { n.textContent = val; });
}

function setInnerHTML(el, html) {
  if (!el) return;
  if (el._last === html) return;
  el._last = html;
  el.innerHTML = html;
}

function buildingByCode(code) { return state.buildings.find(b => b.code === code); }

function buildingLabel(item) {
  // Prefer direct buildingName (from dashboard), fall back to lookup by code
  if (item.buildingName) return item.buildingName;
  const b = buildingByCode(item.code);
  return b ? b.name : item.building || "";
}

function formatBrandSub() {
  const a = state.academic;
  if (!a) return "Student Portal";
  const parts = [];
  if (a.program) parts.push(a.program.abbrev || a.program.name);
  else if (a.department) parts.push(a.department.name);
  if (a.campus) parts.push(a.campus.shortName || a.campus.name);
  return parts.length ? parts.join(" · ") : "Student Portal";
}

/** Map a dashboard entry to the schedule item shape expected by the UI. */
function mapEntryToSchedule(entry) {
  // Parse room code to extract building code if not provided
  let buildingCode = entry.buildingCode || "";
  let buildingName = entry.buildingName || "";
  let roomCode = entry.roomCode || "";
  let floorStr = entry.floor != null ? String(entry.floor) : "—";

  // Fallback: parse room code like "IL502A" → building=IL, floor=5, room=02A
  if (!buildingCode && entry.notes) {
    const m = entry.notes.match(/^([A-Z]{2})/i);
    if (m) buildingCode = m[1].toUpperCase();
  }
  if (!buildingName && buildingCode) {
    const bMap = {
      IA: "TechVoc", IB: "Yellow Bldg", IC: "Belmonte Hall",
      ID: "Admin", IE: "Metal Casting", IF: "KorPhil",
      IG: "PhilChi", IH: "Chem Lab", IJ: "Canteen",
      IK: "Bautista Bldg", IL: "New Academic Bldg",
    };
    buildingName = bMap[buildingCode] || buildingCode;
  }
  if (floorStr === "—" && entry.notes) {
    const fm = entry.notes.match(/^[A-Z]{2}(\d)/i);
    if (fm) floorStr = fm[1] + "F";
  }

  return {
    day: entry.day,
    start: entry.start,
    end: entry.end,
    subject: entry.title || entry.course || "Class session",
    course: entry.code || "",
    building: buildingName,
    buildingName,
    code: buildingCode,
    room: roomCode || entry.notes || "",
    floor: floorStr,
    units: entry.units || 0,
    instructor: entry.instructor || "",
    notes: entry.notes || "",
    entryId: entry.entryId,
    buildingId: entry.buildingId,
    roomId: entry.roomId,
    enrollmentSubjectId: entry.enrollmentSubjectId,
    originType: entry.originType || "COR_IMPORT",
    modality: entry.modality || "ONSITE",
  };
}

function classesForBuilding(code) {
  return state.schedule.filter(x => !x.noClasses && x.code === code);
}

function subjectsForBuilding(code) {
  const seen = new Set(), out = [];
  classesForBuilding(code).forEach(x => {
    if (!seen.has(x.subject)) { seen.add(x.subject); out.push(x.subject); }
  });
  return out;
}

function roomsForBuilding(code) {
  const seen = new Set(), out = [];
  classesForBuilding(code).forEach(x => {
    if (!seen.has(x.room)) { seen.add(x.room); out.push(x.room); }
  });
  return out;
}

const BREAK_MIN = 60;

function formatGap(minutes) {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function dayWithBreaks(day) {
  const classes = [...state.schedule]
    .filter(x => x.day === day && !x.noClasses)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  const items = [];
  classes.forEach((x, i) => {
    items.push({ kind: "class", item: x });
    const next = classes[i + 1];
    if (!next) return;
    const gap = parseMinutes(next.start) - parseMinutes(x.end);
    if (gap >= BREAK_MIN) {
      items.push({ kind: "break", start: x.end, end: next.start, minutes: gap });
    }
  });
  return items;
}

function orderedSchedule(now = new Date()) {
  const today = QCU_TIME.weekday(now);
  return [...state.schedule].sort((a, b) => {
    if (a.day === today && b.day !== today) return -1;
    if (a.day !== today && b.day === today) return 1;
    const dd = dayNames.indexOf(a.day) - dayNames.indexOf(b.day);
    return dd || parseMinutes(a.start) - parseMinutes(b.start);
  });
}

/* ── Shell (header + nav) ────────────────────────────── */
function renderShell() {
  if (state.loading) return;
  window.QCULoading.finish('dashboard');
  const navItems = [
    ["home",      "index.html",     "layout-dashboard", "Home"],
    ["campus-eta", "campus-eta.html", "bus",             "Bus"],
    ["FAB",       "#google-connect", "google",           "Google"],
    ["workspace", "workspace.html", "clipboard-list",   "Tasks"],
    ["settings",  "settings.html",  "settings",         "Settings"]
  ];

  const header = document.getElementById("app-header");
  if (header) {
    const brandSub = formatBrandSub();
    header.innerHTML = `
      <div class="header-inner">
        <a href="index.html" class="header-brand">
           <img class="brand-logo" src="assets/images/QCU college of computer studies logo.jpg" alt="QCU Logo">
          <div class="brand-text">
            <p id="greeting" class="brand-name">QCUians Schedule</p>
            <p class="brand-sub">${brandSub}</p>
          </div>
        </a>
        <div class="header-right">
          <div class="header-clock">
            <p id="live-day"  class="clock-day">Today</p>
            <p id="live-date" class="clock-date">Loading…</p>
            <p id="live-time" class="clock-time">00:00</p>
          </div>
          <img class="qc-logo" src="assets/images/Quezon_City_Government.png" alt="QC Government logo">
        </div>
      </div>`;
  }

  const nav = document.getElementById("bottom-nav");
  if (nav) {
    nav.innerHTML = `
      <div>
        ${navItems.map(([key, href, icon, label]) => {
          if (key === "FAB") {
            // Central floating Classroom button: perfect circle, indigo,
            // white chalkboard icon. Breaks out above the bar; the label
            // "Classroom" aligns with the other tab labels.
            return `<a class="nav-item nav-fab${navPage === "FAB" ? " active" : ""}" href="google.html" aria-label="Google Classroom"${navPage === "FAB" ? ' aria-current="page"' : ""}>
              <span class="nav-fab-btn">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="2" y="4" width="20" height="16" rx="2.5" fill="#fff"/>
                  <path d="M7.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="#4A3AFF"/>
                  <path d="M3 17.5c0-1.93 2.01-3.5 4.5-3.5s4.5 1.57 4.5 3.5V18H3v-.5Z" fill="#4A3AFF"/>
                  <path d="M16.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="#4A3AFF"/>
                  <path d="M12 17.5c0-1.93 2.01-3.5 4.5-3.5s4.5 1.57 4.5 3.5V18H12v-.5Z" fill="#4A3AFF"/>
                </svg>
              </span>
              <span class="nav-fab-label">Classroom</span>
            </a>`;
          }
          return `<a class="nav-item ${navPage === key ? "active" : ""}"
             href="${href}" aria-label="${label}" ${navPage === key ? 'aria-current="page"' : ''}>
            <i data-lucide="${icon}"></i>
            <span>${label}</span>
          </a>`;
        }).join("")}
      </div>`;
  }
  window.QCULoading.finish('shell');
}

/* ── Provenance Badge ──────────────────────────────── */
function provenanceBadge(originType) {
  if (originType === "STUDENT_MANUAL") {
    return `<span class="provenance-badge provenance-manual" title="Added by you">✦ You</span>`;
  }
  if (originType === "COR_IMPORT") {
    return `<span class="provenance-badge provenance-cor" title="Imported from COR">📋 COR</span>`;
  }
  return "";
}

function weekOverview(now = new Date()) {
  const counts = {};
  dayNames.forEach(d => { counts[d] = 0; });
  state.schedule.forEach(x => {
    if (!x.noClasses && counts[x.day] !== undefined) counts[x.day] += 1;
  });
  return counts;
}

function weekStripTemplate(now = new Date()) {
  const today = QCU_TIME.weekday(now);
  const counts = weekOverview(now);
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  // Map weekday name → date of this week (week starts Monday).
  const monday = new Date(now);
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  monday.setDate(now.getDate() - dow);

  const pills = days.map((d, i) => {
    const count = counts[d] || 0;
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const isToday = d === today;
    return `
      <button type="button" class="week-pill${isToday ? " is-today" : ""}"
        data-day="${d}" aria-label="View ${d}'s schedule">
        <span class="week-pill-day">${d.slice(0, 3)}</span>
        <span class="week-pill-date">${date.getDate()}</span>
        <span class="week-pill-count${count ? " has-classes" : ""}">${count ? `${count} class${count > 1 ? "es" : ""}` : "Off"}</span>
      </button>`;
  }).join("");

  return `<div class="week-pill-strip">${pills}</div>`;
}

/* ── Today Task line-up (vertical) ───────────────────── */
// Deterministic pastel per subject. tick() rebuilds this list every second, so
// a random pick would make the boxes strobe; a subject keeps its tint instead.
const TODAY_TINTS = ["peach", "mint", "lavender", "sky", "butter", "blush"];

function todayTint(item) {
  const key = String(item.course || item.subject || item.entryId || `${item.day}${item.start}`);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `pastel-${TODAY_TINTS[h % TODAY_TINTS.length]}`;
}

function todayDuration(item) {
  const s = parseMinutes(item.start), e = parseMinutes(item.end);
  if (s !== s || e !== e || e <= s) return null;
  return e - s;
}

function untilLabel(minutes) {
  // minutesNow() is fractional (seconds included) — round before formatting or
  // a countdown renders as "4h 59.616666666666674m".
  const whole = Math.max(0, Math.round(minutes));
  return whole >= 60 ? formatGap(whole) : `${whole}m`;
}

// Live line for a class box: what is happening relative to the clock right now.
function todayTiming(item, status, now) {
  const mins = todayDuration(item);
  if (mins === null || parseMinutes(item.start) !== parseMinutes(item.start)) {
    // Nothing to count down from. Say so instead of rendering "starts —".
    return { live: "Time not set · add it in Schedule", pct: null };
  }
  const dur = formatGap(mins);
  const nowMin = minutesNow(now);
  const start = parseMinutes(item.start), end = parseMinutes(item.end);

  if (status === "current") {
    const left = Math.max(0, end - nowMin);
    const pct = mins ? Math.min(100, Math.max(0, ((nowMin - start) / mins) * 100)) : 0;
    return {
      live: left > 0
        ? `${untilLabel(left)} left · ends ${formatTime(item.end)}`
        : `Ending now · ends ${formatTime(item.end)}`,
      pct
    };
  }
  if (status === "next") {
    return { live: `Starts in ${untilLabel(start - nowMin)} · ${dur} long`, pct: null };
  }
  return { live: `${dur} long · starts ${formatTime(item.start)}`, pct: null };
}

function nowMarkerTemplate(now) {
  const label = new Intl.DateTimeFormat([], { timeZone: QCU_TIME.zone, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  return `
    <div class="home-today-now" role="presentation">
      <span class="home-today-now-dot"></span>
      <span class="home-today-now-line"></span>
      <span class="home-today-now-label">Now · ${label}</span>
    </div>`;
}

// Classes whose time already passed collapse to one compact muted line.
function todayDoneRowTemplate(item) {
  const mins = todayDuration(item);
  const hasTime = parseMinutes(item.start) === parseMinutes(item.start) && parseMinutes(item.end) === parseMinutes(item.end);
  return `
    <article class="home-today-done-row ${todayTint(item)}">
      <span class="home-today-done-check"><i data-lucide="check-circle-2"></i></span>
      <span class="home-today-done-main">
        <span class="home-today-done-subject">${item.subject}</span>
        <span class="home-today-done-meta">
          <span class="home-today-done-time">${hasTime ? `${formatTime(item.start)} – ${formatTime(item.end)}` : "Time not set"}</span>
          ${mins === null ? "" : `<span class="home-today-done-duration">${formatGap(mins)}</span>`}
        </span>
      </span>
    </article>`;
}

function todayEmptyTile() {
  return `
    <div class="soft-empty-tile">
      <i data-lucide="calendar-x-2"></i>
      <span class="soft-empty-title">No classes today</span>
      <span class="soft-empty-sub">Enjoy the break — your full week is on the Schedule page.</span>
    </div>`;
}

function todayAllDoneRow() {
  return `
    <div class="home-today-all-done">
      <i data-lucide="check-circle-2"></i>
      <span>All classes done for today</span>
    </div>`;
}

function todayTileTemplate(item, opts) {
  const now = new Date();
  const status = getStatus(item, now);
  const statusWord = { current: "In session", next: "Up next", finished: "Done", upcoming: "Scheduled" }[status] || statusLabel(status);
  const bname = buildingLabel(item);
  const mins = todayDuration(item);
  const timing = todayTiming(item, status, now);
  const feature = opts.feature ? " home-today-card--feature" : "";
  const place = [bname, item.room, item.floor && item.floor !== "—" ? item.floor : ""].filter(Boolean).join(" · ");
  const hasTime = parseMinutes(item.start) === parseMinutes(item.start) && parseMinutes(item.end) === parseMinutes(item.end);
  const stagger = opts.i !== undefined ? ` style="--i:${opts.i}"` : "";

  return `
    <article class="home-today-card ${status}-tile${feature} ${todayTint(item)}"${stagger}>
      <div class="home-today-rail">
        <span class="home-today-rail-time">${hasTime ? formatTime(item.start) : "TBA"}</span>
        <span class="home-today-rail-rule"></span>
        <span class="home-today-rail-end">${hasTime ? formatTime(item.end) : "no time yet"}</span>
      </div>
      <div class="home-today-body">
        <div class="home-today-head">
          <span class="home-today-status">${statusWord}</span>
          ${item.course ? `<span class="home-today-course">${item.course}</span>` : ""}
        </div>
        <h3 class="home-today-subject">${item.subject}</h3>
        ${place ? `<p class="home-today-building"><i data-lucide="map-pin"></i>${place}</p>` : ""}
        <div class="home-today-foot">
          ${mins === null ? "" : `<span class="home-today-duration"><i data-lucide="timer"></i>${formatGap(mins)}</span>`}
          <span class="home-today-live">${timing.live}</span>
        </div>
        ${timing.pct === null ? "" : `<div class="home-today-progress" role="presentation"><span style="width:${timing.pct.toFixed(1)}%"></span></div>`}
      </div>
    </article>`;
}

function breakTileTemplate(start, end, minutes, i) {
  return `
    <article class="home-break-tile" style="--i:${i || 0}">
      <div class="home-break-rail">
        <span>${formatTime(start)}</span>
        <span class="home-break-rail-dash">–</span>
        <span>${formatTime(end)}</span>
      </div>
      <div class="home-break-body">
        <span class="home-break-label"><i data-lucide="utensils"></i>Break</span>
        <p class="home-break-title">Free for ${formatGap(minutes)}</p>
        <p class="home-break-sub">Time to eat, rest, or explore the campus.</p>
      </div>
    </article>`;
}

function trackerCellTemplate(item, label, emptyText, emptyIcon) {
  if (!item) {
    return `
      <span class="home-tracker-empty-icon"><i data-lucide="${emptyIcon || "coffee"}"></i></span>
      <span class="home-tracker-empty">${emptyText}</span>`;
  }
  return `
    <span class="home-tracker-label">${label}</span>
    <p class="home-tracker-subject">${item.subject}</p>
    <p class="home-tracker-time">${formatTime(item.start)} – ${formatTime(item.end)}</p>
    <p class="home-tracker-meta">${buildingLabel(item)} · ${item.room}</p>`;
}

function spotlightTemplate(item, emptyText) {
  if (!item) return `<p class="home-spotlight-empty">${emptyText}</p>`;

  const bname = buildingLabel(item);

  return `
    <div class="home-spotlight">
      <p class="home-spotlight-time">${formatTime(item.start)} <span class="home-spotlight-arrow">→</span> ${formatTime(item.end)}</p>
      <h3 class="home-spotlight-subject">${item.subject}</h3>
      <p class="home-spotlight-meta">${bname} · ${item.room} · ${item.floor}</p>
    </div>`;
}

function countdownTemplate(item, label) {
  if (!item) {
    return `<div class="home-countdown-empty">${label}</div>`;
  }

  const now = new Date();
  const status = getStatus(item, now);
  // Both sides of the arithmetic are campus minutes: the class window comes from
  // parseMinutes (which reads every stored shape) and "now" from the campus clock.
  // Splitting the raw string on ":" produced NaN the moment a row held anything
  // but "HH:mm" — an ISO time cell, or a hand-edited "1:00 PM" — and mixed the
  // device's zone into the countdown.
  const nowMin = minutesNow(now);
  const startMin = parseMinutes(item.start);
  const endMin = parseMinutes(item.end);

  if (status === "current") {
    if (endMin !== endMin) return `<div class="home-countdown-empty">${label}</div>`;
    const remaining = Math.max(0, Math.floor((endMin - nowMin) * 60));
    const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
    const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");

    const totalMin = Math.max(1, endMin - (startMin === startMin ? startMin : endMin));
    const elapsedMin = Math.max(0, nowMin - (startMin === startMin ? startMin : nowMin));
    const pct = Math.min(100, (elapsedMin / totalMin) * 100);

    return `
      <div class="home-countdown-value">${hh}:${mm}:${ss}</div>
      <p class="home-countdown-label">until ${item.subject} ends</p>
      <div class="home-countdown-track"><span class="home-countdown-fill" style="width:${pct}%"></span></div>`;
  }

  if (status === "finished") {
    return `<div class="home-countdown-empty">Class finished</div>`;
  }

  if (startMin !== startMin) return `<div class="home-countdown-empty">${label}</div>`;
  const remaining = Math.max(0, Math.floor((startMin - nowMin) * 60));
  const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return `
    <div class="home-countdown-value">${hh}:${mm}:${ss}</div>
    <p class="home-countdown-label">until next class starts</p>
    <p class="home-countdown-target">${item.subject}</p>
    <p class="home-countdown-subject">${formatTime(item.start)} – ${formatTime(item.end)}</p>`;
}

/* ── Home Page ───────────────────────────────────────── */
// QCity Bus Route 4 mini-card. Schedule-based only (mirrors eta.js): reads
// data/qcity-bus.json and shows today's first/last trip + headway. Never
// estimates or counts down — there is no public real-time feed.
async function renderHomeBusCard() {
  const card = document.getElementById("home-bus-card");
  const sub = document.getElementById("home-bus-sub");
  if (!card || !sub || card.dataset.loaded === "1") return;
  try {
    const resp = await fetch("data/qcity-bus.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const dayKey = QCU_TIME.weekday().toLowerCase();
    const serviceDay = dayKey === "sunday" ? "sunday" : dayKey === "saturday" ? "saturday" : "weekdays";
    const svc = data?.service?.[serviceDay];
    // The JSON stores published times as 24-hour strings ("05:00", "21:00") and this
    // card printed them raw, so the dashboard read "05:00 – 21:00" while the route
    // page read "5:00 AM – 9:00 PM" — the same data in two notations, which reads as
    // a wrong bus time. One clock format for the whole app.
    const clock = (v) => (parseMinutes(v) === parseMinutes(v) ? formatTime(v) : String(v ?? ""));
    let text;
    if (svc && svc.operates !== false && Array.isArray(svc.directions) && svc.directions.length) {
      const dirs = svc.directions;
      const first = dirs.map(d => d.firstTrip).filter(Boolean).sort()[0];
      const last = dirs.map(d => d.lastTrip).filter(Boolean).sort().slice(-1)[0];
      const headway = Number.isFinite(dirs[0]?.headwayPeakMins)
        ? `every ${dirs[0].headwayPeakMins}–${dirs[0].headwayOffPeakMins} min`
        : Number.isFinite(dirs[0]?.headwayMins) ? `every ${dirs[0].headwayMins} min` : null;
      text = first && last
        ? `Today: ${clock(first)} – ${clock(last)}${headway ? " · " + headway : ""}`
        : "Schedule unavailable";
    } else {
      text = "No scheduled service today";
    }
    sub.textContent = text;
    card.hidden = false;
    card.dataset.loaded = "1";
    if (window.lucide?.createIcons) window.lucide.createIcons();
  } catch (_) {
    // Data unavailable: keep the card hidden rather than showing a guess.
  }
}

/* Dynamic month calendar: real current month, today = solid purple pill,
   days with classes get a soft-purple tint. */
function renderHomeCalendar() {
  const calEl = document.getElementById("soft-calendar");
  const labelEl = document.getElementById("calendar-label");
  if (!calEl) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  if (labelEl) labelEl.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(now);

  // Class-count per calendar date (this month only).
  const monthCounts = {};
  state.schedule.forEach(x => {
    if (x.noClasses) return;
    const d = x.date || x.startDate;
    // Entries only carry weekday names; approximate per-month by weekday count.
  });
  const weekdayCounts = {};
  state.schedule.forEach(x => { if (!x.noClasses) weekdayCounts[x.day] = (weekdayCounts[x.day] || 0) + 1; });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const dayNameByDow = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const todayDate = now.getDate();

  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += '<span class="soft-cal-cell"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const hasClasses = (weekdayCounts[dayNameByDow[dow]] || 0) > 0;
    const isToday = d === todayDate;
    const cls = [
      "soft-cal-cell",
      isToday ? "is-today" : "",
      !isToday && hasClasses ? "has-classes" : ""
    ].filter(Boolean).join(" ");
    cells += `<button type="button" class="${cls}" data-day-name="${dayNameByDow[dow]}" aria-label="${dayNameByDow[dow]} ${d}">${d}</button>`;
  }
  calEl.innerHTML = `
    <div class="soft-cal-head">${["S","M","T","W","T","F","S"].map(d => `<span>${d}</span>`).join("")}</div>
    <div class="soft-cal-grid">${cells}</div>`;
  calEl.querySelectorAll(".soft-cal-cell[data-day-name]").forEach(btn => {
    btn.addEventListener("click", () => openDayModal(btn.dataset.dayName));
  });
}

/* Google Classroom updates → middle column goals list. Uses the existing
   /api/google/updates endpoint (announcements, materials, assignments).
   Falls back to a connect prompt when Google isn't linked. */
// The home page re-renders on a one-second tick, so EVERY outcome has to be
// remembered before anything is painted: a 401 from this endpoint is the normal
// "Google is not connected yet" answer, and the cache was only written AFTER the
// paint, so any throw in the paint (or an unusable body) left the cache empty and
// the next tick fetched again — an endless 401 storm in the console. A
// "not connected" verdict also cannot change without a page reload, so it is kept
// for the session instead of expiring.
const CLASSROOM_DATA_TTL_MS = 5 * 60 * 1000;
const CLASSROOM_VERDICT_TTL_MS = 60 * 60 * 1000;
let classroomCache = { at: 0, data: null };

function rememberClassroom(data, ttlMs) {
  classroomCache = { at: Date.now(), data, expiresAt: Date.now() + ttlMs };
}

async function renderClassroomUpdates() {
  const goalsEl = document.getElementById("monthly-goals");
  if (!goalsEl) return;
  if (classroomCache.data && Date.now() < (classroomCache.expiresAt || 0)) {
    paintClassroom(goalsEl, classroomCache.data);
    return;
  }
  try {
    const resp = await fetch("/api/google/updates", { credentials: "include", cache: "no-store" });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401 || data.status === "NOT_CONNECTED" || data.status === "UNAUTHENTICATED") {
      rememberClassroom({ notConnected: true }, CLASSROOM_VERDICT_TTL_MS);
      paintClassroom(goalsEl, { notConnected: true });
      return;
    }
    if (data.status !== "OK" && data.status !== "PARTIAL") throw new Error(data.status || "HTTP " + resp.status);
    rememberClassroom(data, CLASSROOM_DATA_TTL_MS);
    paintClassroom(goalsEl, data);
  } catch (_) {
    rememberClassroom({ unavailable: true }, CLASSROOM_DATA_TTL_MS);
    paintClassroom(goalsEl, { unavailable: true });
  }
}

function paintClassroom(el, data) {
  // A throw here must never take the home page down with it: the page re-renders
  // every second, so one bad paint would repeat forever in the console.
  try {
    paintClassroomCard(el, data);
  } catch (error) {
    console.warn("Classroom card could not be drawn:", error?.message || error);
  }
}

function paintClassroomCard(el, data) {
  const pastels = ["soft-goal--peach", "soft-goal--mint", "soft-goal--lavender"];
  const meta = {
    announcement: { icon: "megaphone", label: "New post" },
    material:     { icon: "file-text", label: "New material" },
    assignment:   { icon: "clipboard-check", label: "New task" },
    email:        { icon: "mail", label: "Email" },
  };

  if (data.notConnected) {
    el.innerHTML = `
      <a class="soft-goal soft-goal--lavender" href="google.html">
        <span class="soft-goal-icon"><i data-lucide="log-in" aria-hidden="true"></i></span>
        <p class="soft-goal-title">Connect Google Classroom to see announcements, materials, and assignments here.</p>
        <i data-lucide="arrow-up-right" aria-hidden="true" class="soft-goal-more"></i>
      </a>`;
    iconify();
    return;
  }
  if (data.unavailable) {
    el.innerHTML = `
      <div class="soft-goal soft-goal--lavender">
        <span class="soft-goal-icon"><i data-lucide="cloud-off" aria-hidden="true"></i></span>
        <p class="soft-goal-title">Classroom updates are unavailable right now.</p>
      </div>`;
    iconify();
    return;
  }

  const updates = (data.updates || []).filter(u => u.source === "classroom").slice(0, 4);
  if (!updates.length) {
    el.innerHTML = `
      <div class="soft-goal soft-goal--mint">
        <span class="soft-goal-icon"><i data-lucide="check-circle-2" aria-hidden="true"></i></span>
        <p class="soft-goal-title">No new posts from your classes.</p>
      </div>`;
    iconify();
    return;
  }

  el.innerHTML = updates.map((u, i) => {
    const m = meta[u.type] || meta.announcement;
    return `
      <a class="soft-goal ${pastels[i % pastels.length]}" href="${esc(u.link || "google.html")}" target="_blank" rel="noopener">
        <span class="soft-goal-icon"><i data-lucide="${m.icon}" aria-hidden="true"></i></span>
        <span class="soft-goal-copy">
          <span class="soft-goal-course">${esc(u.courseName || "Class")}</span>
          <p class="soft-goal-title">${m.label} · ${esc(u.title || "")}</p>
        </span>
        <i data-lucide="arrow-up-right" aria-hidden="true" class="soft-goal-more"></i>
      </a>`;
  }).join("");
  iconify();
}

/* Tasks & Notes → right column vertical list (timestamp + content).
   Data already lives in state.dashboard (tasks + notes from /api/v1/dashboard). */
function renderTasksNotesColumn() {
  const el = document.getElementById("soft-timeline");
  if (!el) return;
  const tasks = (state.dashboard?.tasks || []).filter(t => t.status !== "DONE" && t.status !== "COMPLETED");
  const notes = state.dashboard?.notes || [];

  const items = [
    ...tasks.map(t => ({
      kind: "task",
      icon: "clipboard-check",
      title: t.title || "Untitled task",
      meta: [t.subjectCode, t.dueDate ? "Due " + formatDateLabel(t.dueDate, false) : null].filter(Boolean).join(" · "),
      stamp: t.updatedAt || t.createdAt,
    })),
    ...notes.map(n => ({
      kind: "note",
      icon: "notebook-pen",
      title: n.title || "Untitled note",
      meta: (n.body || "").slice(0, 90) + ((n.body || "").length > 90 ? "…" : ""),
      stamp: n.updatedAt || n.createdAt,
    })),
  ].sort((a, b) => new Date(b.stamp || 0) - new Date(a.stamp || 0)).slice(0, 8);

  if (!items.length) {
    el.innerHTML = `
      <div class="soft-timeline-empty">
        <i data-lucide="notebook-pen" aria-hidden="true"></i>
        <p>No tasks or notes yet</p>
        <a href="workspace.html">Create your first one</a>
      </div>`;
    iconify();
    return;
  }

  el.innerHTML = items.map((it, i) => {
    const pastels = ["pastel-mint", "pastel-peach", "pastel-lavender"];
    const stamp = it.stamp ? formatDateLabel(it.stamp, true) : "";
    return `
      <div class="soft-note ${pastels[i % pastels.length]}">
        <span class="soft-note-icon"><i data-lucide="${it.icon}" aria-hidden="true"></i></span>
        <span class="soft-note-body">
          <p class="soft-note-title">${esc(it.title)}</p>
          ${it.meta ? `<p class="soft-note-meta">${esc(it.meta)}</p>` : ""}
          ${stamp ? `<p class="soft-note-stamp">${esc(stamp)}</p>` : ""}
        </span>
      </div>`;
  }).join("");
  iconify();
}

/* Weekly Schedule Progress: compact Mon–Sun grid + % of this week's class
   sessions already done (ended) vs total. */
function renderWeekProgress() {
  const wrap = document.getElementById("week-progress");
  if (!wrap) return;
  const now = new Date();
  const today = QCU_TIME.weekday(now);
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const classes = state.schedule.filter(x => !x.noClasses);

  if (!classes.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  // This week's Monday (week starts Monday, Asia/Manila).
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dow);

  let total = 0, done = 0;
  const grid = days.map((d, i) => {
    const dayClasses = classes.filter(x => x.day === d);
    const date = new Date(monday); date.setDate(monday.getDate() + i);
    const isToday = d === today;
    const isPast = date < now && !isToday;
    const dayDone = dayClasses.filter(x => isPast || (isToday && getStatus(x, now) === "finished")).length;
    total += dayClasses.length;
    done += dayDone;
    return `
      <button type="button" class="soft-week-day${isToday ? " is-today" : ""}${dayClasses.length && dayDone === dayClasses.length ? " is-done" : ""}" data-day="${d}" aria-label="${d}: ${dayClasses.length} classes">
        <span class="soft-week-day-label">${d.slice(0, 3)}</span>
        <span class="soft-week-day-count">${dayClasses.length || "–"}</span>
      </button>`;
  }).join("");

  const pct = total ? Math.round((done / total) * 100) : 0;
  setText("week-progress-pct", pct + "%");
  document.getElementById("week-progress-fill").style.width = pct + "%";
  setText("week-progress-sub", `${done} of ${total} class sessions done this week`);
  const gridEl = document.getElementById("week-progress-grid");
  if (gridEl) {
    gridEl.innerHTML = grid;
    gridEl.querySelectorAll(".soft-week-day").forEach(btn =>
      btn.addEventListener("click", () => openDayModal(btn.dataset.day)));
  }
}


/* Today Task cards: next subject first, exact start/end times, break slots.
   No static empty state — a real "free day" card only when data says so. */
function renderHome() {
  if (state.error && !state.dashboard) {
    const skeleton = document.getElementById('hero-skeleton');
    if (skeleton) skeleton.style.display = 'none';
    setInnerHTML(document.getElementById('today-grid'), '<p class="empty-state">Your schedule could not be loaded. Use the recovery action above.</p>');
    return;
  }
  const now = new Date();
  const hour = Math.floor(QCU_TIME.minutes(now) / 60);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  setText("home-greeting", `${greeting},`);
  const heroMain = document.getElementById("home-hero-main");
  if (heroMain) heroMain.dataset.studentName = (state.profile?.name || "Student").split(" ")[0];

  const heroSkeleton = document.getElementById("hero-skeleton");
  if (heroSkeleton) heroSkeleton.style.display = "none";

  // Left column: today's line-up. Finished classes collapse to compact rows,
  // then a "now" marker, then the current/next class as the purple feature box,
  // breaks, and the rest of the day in order.
  const grid = document.getElementById("today-grid");
  if (grid) {
    const today = QCU_TIME.weekday(now);
    const todaysClasses = state.schedule
      .filter(x => x.day === today && !x.noClasses)
      .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
    const tiles = [];

    if (!todaysClasses.length) {
      tiles.push(todayEmptyTile());
    } else {
      const done = todaysClasses.filter(x => getStatus(x, now) === "finished");
      const ahead = todaysClasses.filter(x => getStatus(x, now) !== "finished");

      done.forEach(item => tiles.push(todayDoneRowTemplate(item)));

      if (ahead.length) {
        // The Now marker only means something when at least one class left has a
        // real clock time (entries whose COR row lost its time are all "upcoming").
        const hasClock = x => parseMinutes(x.start) === parseMinutes(x.start) && parseMinutes(x.end) === parseMinutes(x.end);
        if (ahead.some(hasClock)) tiles.push(nowMarkerTemplate(now));
        const lastDone = done[done.length - 1];
        if (lastDone && hasClock(lastDone) && hasClock(ahead[0])) {
          const gap = parseMinutes(ahead[0].start) - parseMinutes(lastDone.end);
          if (gap >= BREAK_MIN) tiles.push(breakTileTemplate(lastDone.end, ahead[0].start, gap, 0));
        }
        const feature = ahead[0];   // in session now, or the next class up
        let breakIndex = 0;
        ahead.forEach((item, i) => {
          tiles.push(todayTileTemplate(item, { feature: item === feature, i }));
          const nextClass = ahead[i + 1];
          if (nextClass) {
            const gap = parseMinutes(nextClass.start) - parseMinutes(item.end);
            if (gap >= BREAK_MIN) tiles.push(breakTileTemplate(item.end, nextClass.start, gap, breakIndex++));
          }
        });
      } else {
        tiles.push(todayAllDoneRow());
      }
    }
    setInnerHTML(grid, tiles.join(""));
  }

  renderHomeBusCard();
  renderWeekProgress();
  renderHomeCalendar();
  renderClassroomUpdates();
  renderTasksNotesColumn();
  iconify();
}

/* ── Day Modal (weekly overview) ─────────────────────── */
function classesForDay(day) {
  return state.schedule
    .filter(x => x.day === day && !x.noClasses)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
}

function openDayModal(day) {
  const modal   = document.getElementById("day-modal");
  const content = document.getElementById("day-modal-content");
  if (!modal || !content) return;

  const classes = classesForDay(day);
  const isToday = day === QCU_TIME.weekday();
  // NaN-safe hours: entries with missing/malformed times are skipped, and the
  // stat shows "—" (never 0) when no class on the day carries a usable time.
  const hours = classes.reduce((sum, x) => {
    const s = parseMinutes(x.start), e = parseMinutes(x.end);
    if (s !== s || e !== e || e <= s) return sum;   // NaN or invalid range
    return sum + (e - s) / 60;
  }, 0);
  const timedCount = classes.filter(x => {
    const s = parseMinutes(x.start), e = parseMinutes(x.end);
    return s === s && e === e && e > s;
  }).length;
  const hoursText = timedCount ? String(Math.round(hours * 10) / 10) : "—";

  const rows = classes.length
    ? classes.map(x => {
        const bname = buildingLabel(x);
        const hasTime = parseMinutes(x.start) === parseMinutes(x.start) && parseMinutes(x.end) === parseMinutes(x.end);
        // Same place formatting as the Today Schedule boxes: never "· · —".
        const place = [bname, x.room, x.floor && x.floor !== "—" ? x.floor : ""].filter(Boolean).join(" · ");
        return `
          <div class="day-modal-row">
            <div class="day-modal-time">
              ${hasTime ? `<span class="day-modal-start">${formatTime(x.start)}</span>
              <span class="day-modal-to">→</span>
              <span class="day-modal-end">${formatTime(x.end)}</span>`
              : `<span class="day-modal-start day-modal-notime">Time not set</span>`}
            </div>
            <div class="day-modal-main">
              <span class="day-modal-subject">${x.subject}</span>
              ${place ? `<span class="day-modal-meta"><i data-lucide="map-pin" aria-hidden="true"></i>${place}</span>` : ""}
            </div>
            <span class="day-modal-course">${x.course}</span>
          </div>`;
      }).join("")
    : `<div class="day-modal-state">No classes scheduled on ${day}.</div>`;
  const noTimesNote = classes.length && !timedCount
    // Explain the "—" instead of leaving the stat looking broken.
    ? `<p class="day-modal-note">These classes have no time saved yet. Import the COR again or set the time in Schedule.</p>`
    : "";

  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${isToday ? "Today" : day}</span>
          <h2 class="modal-title">${day}'s classes</h2>
        </div>
        <button class="modal-close-btn" data-close-modal aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>

      <div class="day-modal-stats">
        <div class="day-modal-stat">
          <span class="day-modal-stat-label">Classes</span>
          <span class="day-modal-stat-value">${classes.length}</span>
        </div>
        <div class="day-modal-stat">
          <span class="day-modal-stat-label">Hours</span>
          <span class="day-modal-stat-value">${hoursText}</span>
        </div>
      </div>

      <div class="day-modal-rows">${rows}</div>
      ${noTimesNote}

      <a class="day-modal-full" href="schedule.html">
        Full schedule
        <i data-lucide="arrow-right" aria-hidden="true"></i>
      </a>
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
}

/* ── Schedule Page ───────────────────────────────────── */
function dayShort(day) {
  return day.slice(0, 3);
}

function buildingShort(item) {
  // Prefer direct buildingName from dashboard entries
  if (item.buildingName) {
    const name = item.buildingName;
    if (name.includes("New Academic")) return "New Acad Bldg";
    if (name.includes("Bautista"))     return "Bautista Bldg";
    if (name.includes("Belmonte"))     return "Belmonte Hall";
    if (name.includes("Yellow"))       return "Yellow Bldg";
    if (name.includes("Admin"))        return "Admin";
    if (name.includes("TechVoc"))      return "TechVoc";
    if (name.includes("Metal"))        return "Metal Casting";
    if (name.includes("KorPhil"))      return "KorPhil";
    if (name.includes("PhilChi"))      return "PhilChi";
    if (name.includes("Chem"))         return "Chem Lab";
    if (name.includes("Canteen"))      return "Canteen";
    return name;
  }
  const b = buildingByCode(item.code);
  if (!b) return item.building || "";
  const name = b.name;
  if (name.includes("New Academic")) return "New Acad Bldg";
  if (name.includes("Bautista"))     return "Bautista Bldg";
  if (name.includes("Belmonte"))     return "Belmonte Hall";
  if (name.includes("Yellow"))       return "Yellow Bldg";
  if (name.includes("Admin"))        return "Admin";
  if (name.includes("TechVoc"))      return "TechVoc";
  if (name.includes("Metal"))        return "Metal Casting";
  if (name.includes("KorPhil"))      return "KorPhil";
  if (name.includes("PhilChi"))      return "PhilChi";
  if (name.includes("Chem"))         return "Chem Lab";
  if (name.includes("Canteen"))      return "Canteen";
  return name;
}

function floorShort(floor) {
  if (!floor) return "";
  if (floor.includes("Ground")) return "GF";
  const m = floor.match(/(\d+)/);
  return m ? `${m[1]}F` : floor;
}

function renderSchedule() {
  const rows = document.getElementById("schedule-rows");
  if (!rows) return;
  if (state.error && !state.dashboard) {
    setText("schedule-result", "Timetable unavailable");
    setInnerHTML(rows, '<tr class="schedule-empty-row"><td colspan="6" class="schedule-state"><strong>Your schedule could not be loaded.</strong><p>Use the retry button above to try again.</p></td></tr>');
    return;
  }
  const now   = new Date();
  const today = QCU_TIME.weekday(now);
  const entries = orderedSchedule(now).filter(item => !item.noClasses && (scheduleDay === "all" || normalizeDayName(item.day) === normalizeDayName(scheduleDay)));
  const summary = `${entries.length} class${entries.length === 1 ? "" : "es"} ${scheduleDay === "all" ? "this week" : `on ${scheduleDay}`}`;
  const result = document.getElementById("schedule-result");
  if (result && result.textContent !== summary) result.textContent = summary;
  if (!entries.length) {
    const title = scheduleDay === "all" ? "Your timetable is empty" : `No classes on ${scheduleDay}`;
    const hint = scheduleDay === "all" ? "Add a class to start building your week." : "Choose another day or view the full week.";
    setInnerHTML(rows, `<tr class="schedule-empty-row"><td colspan="6" class="schedule-state"><strong>${title}</strong><p>${hint}</p></td></tr>`);
    return;
  }

  // Build rows with break/free periods between classes on the same day
  const html = [];
  let lastDay = null;
  let lastEnd = null;

  entries.forEach(item => {
    const status  = getStatus(item, now);
    const isToday = item.day === today;
    const rowClass = [`${status}-row`, isToday ? "today-row" : "", item.noClasses ? "no-class-row" : ""]
      .filter(Boolean).join(" ");

    // Insert break row between consecutive classes on the same day with gap >= BREAK_MIN
    if (!item.noClasses && lastDay === item.day && lastEnd !== null) {
      const gap = parseMinutes(item.start) - lastEnd;
      if (gap >= BREAK_MIN) {
        html.push(`
          <tr class="break-row">
            <td data-label="Time" colspan="6" style="text-align:center;">
              <span class="break-free-label">FREE</span>
              ${formatTime(minutesToTime(lastEnd))} – ${formatTime(item.start)}
              <span class="break-duration">· ${formatGap(gap)} break</span>
            </td>
          </tr>`);
      }
    }

    if (item.noClasses) {
      html.push(`
        <tr class="${rowClass}">
          <td data-label="Time"    class="time-cell">${dayShort(item.day)}</td>
          <td data-label="Subject" class="subject-cell font-bold">No Classes Scheduled</td>
          <td data-label="Code">—</td>
          <td data-label="Location">—</td>
          <td data-label="Units">—</td>
          <td data-label="Status"><span class="status-dot status-dot-off" title="No Classes"></span></td>
        </tr>`);
    } else {
      const bname = buildingShort(item);
      const loc = `${bname} · ${floorShort(item.floor)} · ${item.room}`;
      const prov = provenanceBadge(item.originType);
      const editBtn = item.entryId
        ? `<button class="icon-btn icon-btn--sm" data-action="edit-entry" data-entry-id="${esc(item.entryId)}" aria-label="Edit class" title="Edit class"><i data-lucide="pencil"></i></button>`
        : "";
      html.push(`
        <tr class="${rowClass}" ${item.entryId ? `data-entry-id="${esc(item.entryId)}"` : ""}>
          <td data-label="Time" class="time-cell">
            <span class="day-abbr">${dayShort(item.day)}</span>
            <span class="time-range">${formatTime(item.start)} – ${formatTime(item.end)}</span>
          </td>
          <td data-label="Subject" class="subject-cell">${esc(item.subject)} ${prov}</td>
          <td data-label="Code"><span class="code-cell">${esc(item.course || "—")}</span></td>
          <td data-label="Location" class="location-cell">${esc(loc)}</td>
          <td data-label="Units"><span class="units-chip">${item.units > 0 ? item.units : "Lab"}</span></td>
          <td data-label="Status"><span class="schedule-status"><span class="status-dot status-dot-${status}" aria-hidden="true"></span>${status === "inactive" ? "Scheduled" : statusLabel(status)}</span> ${editBtn}</td>
        </tr>`);
      lastDay = item.day;
      lastEnd = parseMinutes(item.end);
    }
  });

  setInnerHTML(rows, html.join(""));
  if (window.lucide) window.lucide.createIcons({ root: rows });
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeShort(v) {
  if (!v) return "—";
  const [h, m] = v.split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")}`;
}

/* ── Buildings Page ──────────────────────────────────── */
function renderBuildings() {
  const grid = document.getElementById("building-grid");
  if (!grid) return;

  grid.innerHTML = state.buildings.map((item, index) => {
    const classCount = classesForBuilding(item.code).length;
    const subjects   = subjectsForBuilding(item.code);
    const rooms      = roomsForBuilding(item.code).length ? roomsForBuilding(item.code) : item.rooms;

    return `
      <button class="building-card" data-building-index="${index}" type="button">
        <div class="building-card-image">
          ${item.image ? `<img src="assets/images/${item.image}" alt="${item.name}" loading="lazy">` : ""}
          <span class="building-code-badge">${item.code}</span>
        </div>
        <div class="building-card-body">
          <p class="building-name">${item.name}</p>
          <p class="building-desc">${item.description || ""}</p>
          <div style="display:flex; gap:16px; margin-top:8px; padding-top:12px; border-top:1px solid var(--divider);">
            <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Floors</p><p style="font-size:13px; font-weight:700;">${item.floors}</p></div>
            <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Rooms</p><p style="font-size:13px; font-weight:700;">${rooms.length}</p></div>
            <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Classes</p><p style="font-size:13px; font-weight:700;">${classCount}</p></div>
          </div>
          ${subjects.length ? `
            <div style="margin-top:8px;">
              <p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Subjects</p>
              <p style="font-size:12px; font-weight:600; color:var(--text); line-height:1.4;">${subjects.join(", ")}</p>
            </div>` : ""}
        </div>
      </button>`;
  }).join("");

  grid.onclick = (e) => {
    const btn = e.target.closest("[data-building-index]");
    if (btn) openBuildingModal(state.buildings[Number(btn.dataset.buildingIndex)]);
  };
}

/* ── Building Modal ──────────────────────────────────── */
function openBuildingModal(building) {
  const modal   = document.getElementById("building-modal");
  const content = document.getElementById("building-modal-content");
  if (!modal || !content) return;

  const subjects    = subjectsForBuilding(building.code);
  const rooms       = roomsForBuilding(building.code).length ? roomsForBuilding(building.code) : building.rooms;
  const classCount  = classesForBuilding(building.code).length;

  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${building.code}</span>
          <h2 class="modal-title">${building.name}</h2>
        </div>
        <button class="modal-close-btn" data-close-modal aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>

      <div class="building-modal-image">
        <img src="assets/images/${building.image}" alt="${building.name}">
      </div>

      <p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:14px;">${building.description}</p>

      <div class="modal-info-grid">
        <div class="modal-info-cell">
          <p class="modal-info-label">Floors</p>
          <p class="modal-info-value">${building.floors}</p>
        </div>
        <div class="modal-info-cell">
          <p class="modal-info-label">Rooms</p>
          <p class="modal-info-value">${rooms.length ? rooms.join(", ") : "—"}</p>
        </div>
        <div class="modal-info-cell">
          <p class="modal-info-label">Classes / Week</p>
          <p class="modal-info-value">${classCount}</p>
        </div>
      </div>

      ${subjects.length ? `
        <div>
          <p style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Subjects</p>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${subjects.map(s => `<span class="chip chip-gray">${s}</span>`).join("")}
          </div>
        </div>` : ""}
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
}

function closeModal() {
  document.getElementById("building-modal")?.classList.remove("open");
  document.getElementById("day-modal")?.classList.remove("open");
  document.body.classList.remove("modal-open");
}

/* ── Settings Page ───────────────────────────────────── */
// Sign out lives in the Settings list now (settings.html), so this only keeps
// whatever else the page needs. The notification toggle and reset button were
// removed with their rows.
function renderSettings() {}

/* ── Clock ───────────────────────────────────────────── */
function updateClock() {
  const now  = new Date();
  const hour = Math.floor(QCU_TIME.minutes(now) / 60);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  setText("live-time", new Intl.DateTimeFormat([], { timeZone: QCU_TIME.zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(now));
  setText("live-day",  QCU_TIME.weekday());
  setText("live-date", QCU_TIME.dateLabel(now));
  // Note: #greeting is the header BRAND ("QCUians Schedule"), not a greeting —
  // the live greeting lives in #home-greeting. Do not overwrite the brand here.
}

/* ── Subjects (full names + color map) ───────────────── */
const SUBJECT_NAMES = {
  "CC102":  "Fundamentals of Programming",
  "CC101":  "Introduction to Computing",
  "NSTP 1": "National Service Training Program 1",
  "MATH 1": "Mathematics in the Modern World",
  "MATH 2": "College Algebra",
  "FIL 1":  "Komunikasyon sa Akademikong Filipino",
  "PE 1":   "Physical Fitness and Wellness",
  "RIZAL":  "Life and Works of Rizal",
  "GEE 1":  "Gender and Society",
  "GEE 2":  "People and the Earth's Ecosystems"
};

const SUBJECT_COLORS = {
  "CC102":  { bg: "#EDE7F6", fg: "#5E35B1", border: "#D1C4E9" },
  "CC101":  { bg: "#E3F2FD", fg: "#1565C0", border: "#BBDEFB" },
  "NSTP 1": { bg: "#FFF3E0", fg: "#E65100", border: "#FFE0B2" },
  "MATH 1": { bg: "#E8F5E9", fg: "#2E7D32", border: "#C8E6C9" },
  "MATH 2": { bg: "#E8F5E9", fg: "#2E7D32", border: "#C8E6C9" },
  "FIL 1":  { bg: "#FCE4EC", fg: "#C62828", border: "#F8BBD0" },
  "PE 1":   { bg: "#E0F7FA", fg: "#00838F", border: "#B2EBF2" },
  "RIZAL":  { bg: "#F3E5F5", fg: "#7B1FA2", border: "#E1BEE7" },
  "GEE 1":  { bg: "#FFF8E1", fg: "#F57F17", border: "#FFECB3" },
  "GEE 2":  { bg: "#E8F5E9", fg: "#1B5E20", border: "#C8E6C9" }
};

function subjectFullName(code) {
  return SUBJECT_NAMES[code] || code;
}

function subjectDisplayName(code) {
  const hardcoded = SUBJECT_NAMES[code];
  if (hardcoded) return `${hardcoded} (${code})`;
  // Check enrollment subjects from dashboard for a real title
  const es = state.academic?.enrollmentSubjects?.find(e => e.subjectCode === code);
  if (es?.title) return `${es.title} (${code})`;
  return code;
}

function subjectColor(code) {
  return SUBJECT_COLORS[code] || { bg: "#EEF1F5", fg: "#5F6368", border: "#E5E7EB" };
}

function allSubjects() {
  const seen = new Set();
  const result = [];

  // 1. Primary source: enrollment subjects from the dashboard (richer data)
  if (state.academic?.enrollmentSubjects?.length) {
    state.academic.enrollmentSubjects.forEach(es => {
      const code = es.subjectCode || "";
      if (code && !seen.has(code)) {
        seen.add(code);
        result.push({ code, title: es.title || "", units: es.units || 0 });
      }
    });
  }

  // 2. Fallback: derive from schedule entries (course field)
  if (!result.length) {
    state.schedule.forEach(x => {
      if (!x.noClasses && x.course && !seen.has(x.course)) {
        seen.add(x.course);
        result.push({ code: x.course, title: x.subject || "", units: 0 });
      }
    });
  }

  return result;
}

/* ── Task Manager (API-backed) ────────────────────────── */
const TASKS_KEY = "qcu-tasks";
let _tasksCache = null;
const loadErrors = new Map();
function loadNotice(key, message, retry, retryLabel = 'Try again') {
  let notice = document.getElementById('load-notice-' + key);
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'load-notice-' + key;
    notice.className = 'load-notice';
    notice.setAttribute('role', 'status');
    (document.querySelector('.page-container') || document.querySelector('main') || document.body).prepend(notice);
  }
  notice.replaceChildren();
  notice.hidden = !message;
  if (!message) return;
  const text = document.createElement('span');
  text.textContent = message;
  notice.appendChild(text);
  if (retry) {
    const button = document.createElement('button');
    button.className = 'btn-secondary';
    button.textContent = retryLabel;
    button.onclick = retry;
    notice.appendChild(button);
  }
}
async function readWithFeedback(url, key, retry, hasContent = false) {
  const started = performance.now();
  const target = document.getElementById(key === 'tasks' ? 'task-list' : key === 'notes' ? 'note-list' : '');
  const initialLists = key === 'dashboard' && !hasContent ? ['task-list','note-list'].map(id => document.getElementById(id)).filter(Boolean) : [];
  for (const list of initialLists) {
    list.innerHTML = window.QCULoading.cards();
    list.setAttribute('aria-busy','true');
  }
  if (target && !hasContent) {
    target.innerHTML = window.QCULoading.cards();
    target.setAttribute('aria-busy','true');
  }
  loadNotice(key, hasContent ? 'Refreshing…' : '');
  const slow = setTimeout(() => loadNotice(key, 'This is taking longer than usual. Still checking…'), 8000);
  try {
    const response = await fetch(url, {credentials:'include', cache:'no-store', signal:AbortSignal.timeout(35000)});
    if (!response.ok) {
      // Routing signals arrive with a 4xx on purpose (409 for "your account is
      // active but has nothing to show"). They are instructions, not failures,
      // so hand the body to the caller's routing branches.
      const body = await response.clone().json().catch(() => null);
      if (response.status === 409 && body && ['ONBOARDING_REQUIRED', 'INCOMPLETE'].includes(body.status)) {
        loadErrors.delete(key);
        loadNotice(key, '');
        return body;
      }
      const error = new Error(response.status === 401 ? 'Your session expired. Sign in again.' : response.status === 429 ? `Too many requests. Retry after ${response.headers.get('Retry-After') || 'a few'} seconds.` : body?.error || 'The service is unavailable. Please try again.');
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (['tasks','notes'].includes(key) && !Array.isArray(data.data)) throw new Error('The service returned an unexpected result. Please retry.');
    loadErrors.delete(key);
    loadNotice(key, '');
    return data;
  } catch (error) {
    const message = navigator.onLine === false ? 'You are offline. Reconnect and try again.' : error.message;
    loadErrors.set(key, message);
    loadNotice(key, (hasContent ? 'Refresh failed. Showing your last loaded content. ' : '') + message,
      error.status === 401 ? () => { location.href = '/api/auth/google/start?returnTo=' + encodeURIComponent(location.pathname || '/'); } : retry,
      error.status === 401 ? 'Sign in again' : 'Try again');
    throw error;
  } finally {
    clearTimeout(slow);
    for (const list of initialLists) { list.removeAttribute('aria-busy'); list.querySelector('.loading-placeholder')?.remove(); }
    if (target) { target.removeAttribute('aria-busy'); if (!hasContent) target.querySelector('.loading-placeholder')?.remove(); }
    performance.measure('qcu-' + key, {start:started, end:performance.now()});
  }
}
let _tasksFetching = false;

async function fetchTasksFromApi() {
  if (_tasksFetching) return _tasksCache || [];
  _tasksFetching = true;
  try {
    const d = await readWithFeedback('/api/v1/tasks', 'tasks', async () => { await fetchTasksFromApi(); renderTasks(); }, _tasksCache !== null);
    _tasksCache = Array.isArray(d.data) ? d.data : [];
    return _tasksCache;
  } catch { return _tasksCache || []; }
  finally { _tasksFetching = false; }
}

async function loadTasks() {
  return await fetchTasksFromApi();
}

async function addTask(data) {
  try {
    const r = await fetch("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title: data.title,
        description: data.description || "",
        priority: (data.priority || "medium").toUpperCase(),
        subjectId: data.subjectId || null,
        dueDate: data.deadline || null,
      }),
    });
    if (r.ok) { await fetchTasksFromApi(); }
  } catch {}
}

async function updateTask(id, data) {
  try {
    const payload = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description;
    if (data.priority !== undefined) payload.priority = data.priority.toUpperCase();
    if (data.deadline !== undefined) payload.dueDate = data.deadline || null;
    if (data.subjectId !== undefined) payload.subjectId = data.subjectId || null;
    const r = await fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (r.ok) { await fetchTasksFromApi(); }
  } catch {}
}

async function deleteTask(id) {
  try {
    const r = await fetch(`/api/v1/tasks/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { await fetchTasksFromApi(); }
  } catch {}
}

async function toggleTask(id) {
  try {
    const tasks = _tasksCache || await fetchTasksFromApi();
    const task = tasks.find(t => (t.taskId || t.id) === id);
    if (!task) return;
    const newStatus = task.status === "COMPLETED" ? "OPEN" : "COMPLETED";
    const r = await fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: newStatus }),
    });
    if (r.ok) { await fetchTasksFromApi(); }
  } catch {}
}

const PRIORITY_META = {
  // Pastel chips and accents from the soft-UI palette, so a priority reads like
  // every other card on the dashboard instead of a traffic-light badge.
  high:   { label: "High",   color: "#C43D63", bg: "#FFE3EC", border: "#FFD0DE", icon: "arrow-up", accent: "#F08CA6" },
  medium: { label: "Medium", color: "#A9770F", bg: "#FFF2CE", border: "#FFE7A8", icon: "minus",    accent: "#E9C46A" },
  low:    { label: "Low",    color: "#0F7F7E", bg: "#E0F7F6", border: "#C7EFEC", icon: "arrow-down", accent: "#7FD8D2" }
};

function priorityBadge(priority) {
  const p = PRIORITY_META[priority];
  if (!p) return "";
  return `<span class="priority-badge" style="background:${p.bg};color:${p.color};border-color:${p.border};">
    <i data-lucide="${p.icon}"></i>${p.label}
  </span>`;
}

function filteredTasks() {
  const search = (document.getElementById("task-search")?.value || "").toLowerCase();
  const status = document.getElementById("task-filter-status")?.value || "all";
  const subject = document.getElementById("task-filter-subject")?.value || "all";
  const sort = document.getElementById("task-sort")?.value || "newest";

  let tasks = _tasksCache || [];

  if (search) {
    tasks = tasks.filter(t =>
      (t.title || "").toLowerCase().includes(search) ||
      (t.description || "").toLowerCase().includes(search)
    );
  }
  if (status === "pending") tasks = tasks.filter(t => t.status !== "COMPLETED");
  if (status === "done") tasks = tasks.filter(t => t.status === "COMPLETED");
  if (subject !== "all") tasks = tasks.filter(t =>
    (t.subjectCode || "").toLowerCase() === subject.toLowerCase()
  );

  if (sort === "newest") tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (sort === "oldest") tasks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (sort === "deadline") tasks.sort((a, b) => (a.dueDate || "zzz").localeCompare(b.dueDate || "zzz"));
  if (sort === "priority") tasks.sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const aVal = order[a.priority] ?? 3;
    const bVal = order[b.priority] ?? 3;
    return aVal - bVal;
  });
  if (sort === "alpha") tasks.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return tasks;
}

function taskCardTemplate(t) {
  const done = t.status === "COMPLETED";
  const doneClass = done ? " completed" : "";
  const priorityClass = t.priority ? ` task-card--priority-${t.priority.toLowerCase()}` : "";
  const sc = subjectColor(t.subjectCode || t.subject || "");
  const deadline = t.dueDate ? `<span class="task-meta"><i data-lucide="calendar"></i>${esc(formatDateLabel(t.dueDate, false))}</span>` : "";
  const subject = t.subjectCode
    ? `<span class="subject-chip" style="background:${sc.bg};color:${sc.fg};border-color:${sc.border};">${subjectDisplayName(t.subjectCode)}</span>`
    : "";
  const priority = t.priority ? priorityBadge(t.priority.toLowerCase()) : "";
  const accent = t.priority ? (PRIORITY_META[t.priority.toLowerCase()]?.accent || "") : "";
  const taskId = t.taskId || t.id;

  return `
    <article class="task-card${doneClass}${priorityClass}" data-task-id="${esc(taskId)}"${accent ? ` style="--task-accent:${accent}"` : ""}>
      <button class="task-check-btn${done ? " checked" : ""}" data-action="toggle" data-id="${esc(taskId)}" aria-label="Toggle done"></button>
      <div class="task-card-content">
        <div class="task-card-header">
          <h3 class="task-card-title${done ? " done" : ""}">${esc(t.title || "Untitled task")}</h3>
          <div class="task-card-actions">
            <button class="icon-btn" data-action="edit" data-id="${esc(taskId)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button class="icon-btn icon-btn--danger" data-action="delete" data-id="${esc(taskId)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        ${t.description ? `<p class="task-card-desc">${esc(t.description)}</p>` : ""}
        <div class="task-card-footer">
          ${priority}
          ${subject}
          ${deadline}
        </div>
      </div>
    </article>`;
}

function renderTasks() {
  const list = document.getElementById("task-list");
  if (!list) return;
  if (_tasksFetching && _tasksCache === null) return;
  if (_tasksCache === null && (loadErrors.has('tasks') || loadErrors.has('dashboard'))) { list.replaceChildren(); return; }

  const subjectSelect = document.getElementById("task-filter-subject");
  if (subjectSelect && subjectSelect.children.length <= 1) {
    allSubjects().forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.code; opt.textContent = `${subjectDisplayName(s.code)}`;
      subjectSelect.appendChild(opt);
    });
  }

  const tasks = filteredTasks();
  const hasFilters = (document.getElementById("task-search")?.value || "") ||
                     (document.getElementById("task-filter-status")?.value || "all") !== "all" ||
                     (document.getElementById("task-filter-subject")?.value || "all") !== "all";
  let html;
  if (!tasks.length && hasFilters) {
    html = `<div class="empty-state"><i data-lucide="search-x" class="empty-icon"></i><span class="empty-text">No matching tasks</span><span class="empty-sub">Try adjusting your search or filters.</span></div>`;
  } else if (!tasks.length) {
    html = `<div class="empty-state"><i data-lucide="clipboard-list" class="empty-icon"></i><span class="empty-text">No tasks yet</span><span class="empty-sub">Tap the + button to add your first task.</span></div>`;
  } else {
    html = tasks.map(taskCardTemplate).join("");
  }
  setInnerHTML(list, html);
  iconify();
}

function openTaskModal(task) {
  const modal = document.getElementById("task-modal");
  const content = document.getElementById("task-modal-content");
  if (!modal || !content) return;

  const isEdit = !!task;
  const subjects = allSubjects();
  const taskSubjectCode = task ? (task.subjectCode || task.subject || "") : "";
  const subjectOptions = subjects.map(s =>
    `<option value="${s.code}" ${task && taskSubjectCode.toUpperCase() === s.code.toUpperCase() ? "selected" : ""}>${subjectDisplayName(s.code)}</option>`
  ).join("");
  const curPriority = (task && task.priority ? task.priority.toLowerCase() : "medium");
  const priorityOptions = Object.entries(PRIORITY_META).map(([k, v]) =>
    `<option value="${k}" ${k === curPriority ? "selected" : ""}>${v.label}</option>`
  ).join("");
  const taskId = task ? (task.taskId || task.id) : "";

  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${isEdit ? "Edit" : "New"} Task</span>
          <h2 class="modal-title">${isEdit ? "Edit Task" : "Add Task"}</h2>
        </div>
        <button class="modal-close-btn" data-close-task-modal aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <form id="task-form" class="task-form">
        <label class="form-field">
          <span class="form-label">Title *</span>
          <input type="text" id="tf-title" required placeholder="e.g. Submit Problem Set 3" value="${isEdit ? (task.title || "").replace(/"/g, "&quot;") : ""}">
        </label>
        <label class="form-field">
          <span class="form-label">Description</span>
          <textarea id="tf-desc" rows="3" placeholder="Optional details…">${isEdit ? (task.description || "") : ""}</textarea>
        </label>
        <div class="form-row">
          <label class="form-field form-field--half">
            <span class="form-label">Subject</span>
            <select id="tf-subject">
              <option value="">None</option>
              ${subjectOptions}
            </select>
          </label>
          <label class="form-field form-field--half">
            <span class="form-label">Priority</span>
            <select id="tf-priority">${priorityOptions}</select>
          </label>
        </div>
        <label class="form-field">
          <span class="form-label">Deadline</span>
          <input type="date" id="tf-deadline" value="${isEdit && task.dueDate ? task.dueDate : ""}">
        </label>
        <button type="submit" class="action-button">
          <i data-lucide="${isEdit ? "save" : "plus"}"></i>
          ${isEdit ? "Save Changes" : "Add Task"}
        </button>
      </form>
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();

  document.getElementById("task-form").addEventListener("submit", async e => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('[type="submit"]');
    if (submitBtn?.disabled) return;
    window.QCULoading.button(submitBtn, true);
    const data = {
      title: document.getElementById("tf-title").value.trim(),
      description: document.getElementById("tf-desc").value.trim(),
      subject: document.getElementById("tf-subject").value,
      priority: document.getElementById("tf-priority").value,
      deadline: document.getElementById("tf-deadline").value
    };
    if (!data.title) { window.QCULoading.button(submitBtn, false); return; }
    try {
      if (isEdit) await updateTask(taskId, { title: data.title, description: data.description, subjectId: data.subject || null, priority: data.priority, deadline: data.deadline || null });
      else await addTask({ title: data.title, description: data.description, subjectId: data.subject || null, priority: data.priority, deadline: data.deadline || null });

      closeTaskModal();
      renderTasks();
    } finally {
      window.QCULoading.button(submitBtn, false);
    }
  });
}

function closeTaskModal() {
  const modal = document.getElementById("task-modal");
  if (modal) modal.classList.remove("open");
  document.body.classList.remove("modal-open");
}

/* ── Notes (API-backed) ──────────────────────────────── */
let _notesCache = null;
let _notesFetching = false;

async function fetchNotesFromApi() {
  if (_notesFetching) return _notesCache || [];
  _notesFetching = true;
  try {
    const d = await readWithFeedback('/api/v1/notes', 'notes', async () => { await fetchNotesFromApi(); renderNotes(); }, _notesCache !== null);
    _notesCache = Array.isArray(d.data) ? d.data : [];
    return _notesCache;
  } catch { return _notesCache || []; }
  finally { _notesFetching = false; }
}

async function loadNotes() {
  return await fetchNotesFromApi();
}

async function addNote(data) {
  try {
    const r = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title: data.title,
        body: data.body || "",
        subjectId: data.subjectId || null,
      }),
    });
    if (r.ok) { await fetchNotesFromApi(); }
  } catch {}
}

async function updateNote(id, data) {
  try {
    const payload = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.body !== undefined) payload.body = data.body;
    if (data.subjectId !== undefined) payload.subjectId = data.subjectId || null;
    const r = await fetch(`/api/v1/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (r.ok) { await fetchNotesFromApi(); }
  } catch {}
}

async function deleteNote(id) {
  try {
    const r = await fetch(`/api/v1/notes/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { await fetchNotesFromApi(); }
  } catch {}
}

function filteredNotes() {
  const search = (document.getElementById("note-search")?.value || "").toLowerCase();
  const subject = document.getElementById("note-filter-subject")?.value || "all";
  const sort = document.getElementById("note-sort")?.value || "newest";

  let notes = _notesCache || [];

  if (search) {
    notes = notes.filter(n =>
      (n.title || "").toLowerCase().includes(search) ||
      (n.body || "").toLowerCase().includes(search)
    );
  }
  if (subject !== "all") notes = notes.filter(n =>
    (n.subjectCode || "").toLowerCase() === subject.toLowerCase()
  );

  if (sort === "newest") notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (sort === "oldest") notes.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (sort === "alpha") notes.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return notes;
}

function noteCardTemplate(n) {
  const sc = subjectColor(n.subjectCode || n.subject || "");
  const subject = n.subjectCode
    ? `<span class="subject-chip" style="background:${sc.bg};color:${sc.fg};border-color:${sc.border};">${subjectDisplayName(n.subjectCode)}</span>`
    : "";
  const date = n.createdAt ? `<span class="task-meta"><i data-lucide="clock"></i>${QCU_TIME.dateLabel(new Date(n.createdAt), { month: "short", day: "numeric" })}</span>` : "";
  const bodyPreview = (n.body || "").length > 140 ? (n.body || "").slice(0, 140) + "…" : (n.body || "");
  const noteId = n.noteId || n.id;

  return `
    <article class="note-card" data-note-id="${esc(noteId)}" style="border-left:3px solid ${sc.border || 'var(--blue)'};">
      <div class="note-card-inner">
        <div class="note-card-header">
          <h3 class="note-card-title">${esc(n.title || "Untitled note")}</h3>
          <div class="task-card-actions">
            <button class="icon-btn" data-action="edit-note" data-id="${esc(noteId)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button class="icon-btn icon-btn--danger" data-action="delete-note" data-id="${esc(noteId)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        ${bodyPreview ? `<p class="note-card-body">${esc(bodyPreview)}</p>` : ""}
        <div class="note-card-footer">
          ${subject}
          ${date}
        </div>
      </div>
    </article>`;
}

function renderNotes() {
  const list = document.getElementById("note-list");
  if (!list) return;
  if (_notesFetching && _notesCache === null) return;
  if (_notesCache === null && (loadErrors.has('notes') || loadErrors.has('dashboard'))) { list.replaceChildren(); return; }

  const subjectSelect = document.getElementById("note-filter-subject");
  if (subjectSelect && subjectSelect.children.length <= 1) {
    allSubjects().forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.code; opt.textContent = `${subjectDisplayName(s.code)}`;
      subjectSelect.appendChild(opt);
    });
  }

  const notes = filteredNotes();
  const hasFilters = (document.getElementById("note-search")?.value || "") ||
                     (document.getElementById("note-filter-subject")?.value || "all") !== "all";
  let html;
  if (!notes.length && hasFilters) {
    html = `<div class="empty-state"><i data-lucide="search-x" class="empty-icon"></i><span class="empty-text">No matching notes</span><span class="empty-sub">Try adjusting your search or filters.</span></div>`;
  } else if (!notes.length) {
    html = `<div class="empty-state"><i data-lucide="notebook-pen" class="empty-icon"></i><span class="empty-text">No notes yet</span><span class="empty-sub">Tap the + button to jot down your first note.</span></div>`;
  } else {
    html = notes.map(noteCardTemplate).join("");
  }
  setInnerHTML(list, html);
  iconify();
}

function openNoteModal(note) {
  const modal = document.getElementById("note-modal");
  const content = document.getElementById("note-modal-content");
  if (!modal || !content) return;

  const isEdit = !!note;
  const subjects = allSubjects();
  const noteSubjectCode = note ? (note.subjectCode || note.subject || "") : "";
  const subjectOptions = subjects.map(s =>
    `<option value="${s.code}" ${note && noteSubjectCode.toUpperCase() === s.code.toUpperCase() ? "selected" : ""}>${subjectDisplayName(s.code)}</option>`
  ).join("");
  const noteId = note ? (note.noteId || note.id) : "";

  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${isEdit ? "Edit" : "New"} Note</span>
          <h2 class="modal-title">${isEdit ? "Edit Note" : "Add Note"}</h2>
        </div>
        <button class="modal-close-btn" data-close-note-modal aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <form id="note-form" class="task-form">
        <label class="form-field">
          <span class="form-label">Title *</span>
          <input type="text" id="nf-title" required placeholder="e.g. Lecture 5 Notes" value="${isEdit ? (note.title || "").replace(/"/g, "&quot;") : ""}">
        </label>
        <label class="form-field">
          <span class="form-label">Subject</span>
          <select id="nf-subject">
            <option value="">None</option>
            ${subjectOptions}
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">Content</span>
          <textarea id="nf-body" rows="8" placeholder="Write your note here…">${isEdit ? (note.body || "") : ""}</textarea>
        </label>
        <button type="submit" class="action-button">
          <i data-lucide="${isEdit ? "save" : "plus"}"></i>
          ${isEdit ? "Save Changes" : "Add Note"}
        </button>
      </form>
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();

  document.getElementById("note-form").addEventListener("submit", async e => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('[type="submit"]');
    if (submitBtn?.disabled) return;
    window.QCULoading.button(submitBtn, true);
    const data = {
      title: document.getElementById("nf-title").value.trim(),
      subject: document.getElementById("nf-subject").value,
      body: document.getElementById("nf-body").value.trim()
    };
    if (!data.title) { window.QCULoading.button(submitBtn, false); return; }
    try {
      if (isEdit) await updateNote(noteId, { title: data.title, body: data.body, subjectId: data.subject || null });
      else await addNote({ title: data.title, body: data.body, subjectId: data.subject || null });

      closeNoteModal();
      renderNotes();
    } finally {
      window.QCULoading.button(submitBtn, false);
    }
  });
}

function closeNoteModal() {
  const modal = document.getElementById("note-modal");
  if (modal) modal.classList.remove("open");
  document.body.classList.remove("modal-open");
}

/* ── Tick ────────────────────────────────────────────── */
function tick() {
  updateClock();
  if (page === "home")     renderHome();
  if (page === "schedule") renderSchedule();
  if (page === "tasks")    renderTasks();
  if (page === "notes")    renderNotes();
  if (page === "workspace") { renderTasks(); renderNotes(); }
  // campus-eta page uses its own loop in eta.js
}

/* ── Schedule CRUD API ─────────────────────────────── */
async function fetchScheduleFromApi() {
  return readWithFeedback('/api/v1/schedule', 'schedule', reloadSchedule, state.schedule.length > 0);
}

async function createScheduleEntry(payload) {
  const resp = await fetch("/api/v1/schedule/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return await resp.json();
}

async function updateScheduleEntry(entryId, payload) {
  const resp = await fetch(`/api/v1/schedule/entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return await resp.json();
}

async function deleteScheduleEntryApi(entryId) {
  const resp = await fetch(`/api/v1/schedule/entries/${entryId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return await resp.json();
}

// The API returns canonical days ("MONDAY"); every view in this file compares
// title-case day names ("Monday") — including dayNames.indexOf() ordering and
// the schedule page's day filter buttons — so map to that one form here.
function dayTitleCase(value) {
  const canonical = normalizeDayName(value);
  if (!canonical) return "";
  return canonical[0] + canonical.slice(1).toLowerCase();
}

function mapApiEntry(item) {
  return {
    day: dayTitleCase(item.dayOfWeek),
    start: item.startTime,
    end: item.endTime,
    subject: item.title || "",
    course: item.code || "",
    building: item.buildingName || "",
    buildingName: item.buildingName || "",
    code: item.buildingCode || "",
    room: item.roomCode || "",
    floor: item.floor != null ? String(item.floor) : "—",
    units: item.units || 0,
    instructor: "",
    notes: "",
    entryId: item.entryId,
    buildingId: item.buildingId,
    roomId: item.roomId,
    enrollmentSubjectId: item.enrollmentSubjectId,
    originType: item.originType || "COR_IMPORT",
    modality: item.modality || "ONSITE",
  };
}

/* ── Schedule CRUD Modal ──────────────────────────── */
const CRUD_DAY_MAP = {
  "Mon": "MONDAY", "Tue": "TUESDAY", "Wed": "WEDNESDAY",
  "Thu": "THURSDAY", "Fri": "FRIDAY", "Sat": "SATURDAY", "Sun": "SUNDAY",
};
const CRUD_DAY_REVERSE = Object.fromEntries(Object.entries(CRUD_DAY_MAP).map(([k, v]) => [v, k]));

// Entries arrive with the day capitalised ("Monday") from the API mapping, while
// the picker's option values are canonical ("MONDAY"). Comparing the two forms
// directly never matched, so the Day select silently defaulted to its first
// option (Monday) for every class — editing a Wednesday class moved it.
function normalizeDayName(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) {
    const names = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const n = Number(raw);
    if (n >= 0 && n <= 6) return names[n];
    if (n === 7) return "SUNDAY";
    return "";
  }
  const head = raw.toUpperCase().replace(/[^A-Z]/g, " ").trim().split(/\s+/)[0] || "";
  const aliases = {
    MON: "MONDAY", MONDAY: "MONDAY", TUE: "TUESDAY", TUES: "TUESDAY", TUESDAY: "TUESDAY",
    WED: "WEDNESDAY", WEDS: "WEDNESDAY", WEDNESDAY: "WEDNESDAY",
    THU: "THURSDAY", THUR: "THURSDAY", THURS: "THURSDAY", THURSDAY: "THURSDAY",
    FRI: "FRIDAY", FRIDAY: "FRIDAY", SAT: "SATURDAY", SATURDAY: "SATURDAY",
    SUN: "SUNDAY", SUNDAY: "SUNDAY",
  };
  return aliases[head] || "";
}

let _crudEditingEntry = null;
let _crudEnrollmentSubjects = [];
let _crudReturnFocus = null;

function openCrudModal(entry = null) {
  _crudEditingEntry = entry;
  const modal = document.getElementById("crud-modal");
  const content = document.getElementById("crud-modal-content");
  if (!modal || !content) return;
  _crudReturnFocus = document.activeElement;

  const isEdit = !!entry;
  const title = isEdit ? "Edit Class" : "Add Class";

  const editingDay = normalizeDayName(entry?.day);
  const dayOptions = Object.entries(CRUD_DAY_MAP).map(([abbr, full]) =>
    `<option value="${full}" ${editingDay === full ? "selected" : ""}>${abbr} (${full})</option>`
  ).join("");

  const buildingOptions = (state.buildings || []).map(b =>
    `<option value="${b.buildingId}" ${entry?.buildingId === b.buildingId ? "selected" : ""}>${esc(b.name)}</option>`
  ).join("");

  // The modal used to show native validation bubbles only — a `required` select
  // with no options (a class whose subject is not in the catalog) blocked the
  // submit and looked like a dead button. `novalidate` hands validation to
  // handleCrudSubmit, which writes a visible message next to the field.
  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${isEdit ? "EDIT" : "ADD"}</span>
          <h2 class="modal-title">${title}</h2>
        </div>
        <button class="modal-close-btn" data-close-crud-modal aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>

      <form id="crud-form" class="crud-form" novalidate>
        <div class="crud-field">
          <label for="crud-subject">Subject</label>
          <select id="crud-subject" required aria-required="true">
            <option value="">Select subject…</option>
          </select>
        </div>

        <div class="crud-row">
          <div class="crud-field">
            <label for="crud-day">Day</label>
            <select id="crud-day" required>${dayOptions}</select>
          </div>
          <div class="crud-field">
            <label for="crud-modality">Modality</label>
            <select id="crud-modality">
              <option value="ONSITE" ${entry?.modality === "ONSITE" || !entry ? "selected" : ""}>On-site</option>
              <option value="ONLINE" ${entry?.modality === "ONLINE" ? "selected" : ""}>Online</option>
              <option value="HYBRID" ${entry?.modality === "HYBRID" ? "selected" : ""}>Hybrid</option>
              <option value="TBA" ${entry?.modality === "TBA" ? "selected" : ""}>TBA</option>
            </select>
          </div>
        </div>

        <div class="crud-row">
          <div class="crud-field">
            <label for="crud-start">Start Time</label>
            <input type="time" id="crud-start" required value="${entry?.start || ""}">
          </div>
          <div class="crud-field">
            <label for="crud-end">End Time</label>
            <input type="time" id="crud-end" required value="${entry?.end || ""}">
          </div>
        </div>

        <div class="crud-row">
          <div class="crud-field">
            <label for="crud-building">Building</label>
            <select id="crud-building">
              <option value="">None</option>
              ${buildingOptions}
            </select>
          </div>
          <div class="crud-field">
            <label for="crud-room">Room</label>
            <select id="crud-room">
              <option value="">None</option>
            </select>
          </div>
        </div>

        <div class="crud-field" id="crud-location-field">
          <label for="crud-location">Location Note</label>
          <input type="text" id="crud-location" placeholder="e.g. Online via Zoom" value="${esc(entry?.locationText || "")}">
        </div>

        <div class="crud-actions">
          ${isEdit ? `<button type="button" class="btn btn-danger" id="crud-delete-btn"><i data-lucide="trash-2"></i> Delete</button>` : ""}
          <div class="crud-actions-right">
            <button type="button" class="btn btn-secondary" data-close-crud-modal>Cancel</button>
            <button type="submit" class="btn btn-primary" id="crud-save-btn">${isEdit ? "Save Changes" : "Add Class"}</button>
          </div>
        </div>

        <p id="crud-error" class="crud-error" style="display:none;"></p>
      </form>
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();

  // Populate subjects dropdown
  populateSubjectDropdown(entry);
  document.getElementById("crud-subject")?.focus();

  // Set up cascading building → room
  const buildingSelect = document.getElementById("crud-building");
  const roomSelect = document.getElementById("crud-room");
  if (buildingSelect && roomSelect) {
    buildingSelect.addEventListener("change", () => {
      populateRoomDropdown(buildingSelect.value, entry?.roomId);
    });
    // Trigger initial room population
    if (buildingSelect.value) {
      populateRoomDropdown(buildingSelect.value, entry?.roomId);
    }
  }

  // Delete handler
  const deleteBtn = document.getElementById("crud-delete-btn");
  if (deleteBtn && entry) {
    deleteBtn.addEventListener("click", () => {
      confirmDeleteEntry(entry);
    });
  }

  // Form submit handler
  const form = document.getElementById("crud-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleCrudSubmit(entry);
    });
  }
}

function populateSubjectDropdown(entry) {
  const select = document.getElementById("crud-subject");
  if (!select) return;

  // Load enrollment subjects from academic catalog
  if (state.academic?.enrollmentSubjects?.length) {
    _crudEnrollmentSubjects = state.academic.enrollmentSubjects;
  }

  // Fallback: use known subjects from current schedule if no enrollment subjects available.
  // The schedule carries the class's real enrollmentSubjectId, so the picker can
  // offer an id instead of falling back to a subject code (a code sent as an id
  // made every save fail with "Enrollment subject not found").
  if (!_crudEnrollmentSubjects.length && state.schedule.length) {
    const seen = new Set();
    state.schedule.forEach(s => {
      const key = s.enrollmentSubjectId || s.course;
      if (key && !seen.has(key)) {
        seen.add(key);
        _crudEnrollmentSubjects.push({
          enrollmentSubjectId: s.enrollmentSubjectId || null,
          subjectCode: s.course || "",
          title: s.subject || "",
        });
      }
    });
  }

  select.innerHTML = '<option value="">Select subject…</option>';

  const options = _crudEnrollmentSubjects.slice();

  // Whatever the catalog knows, the class being edited must stay selectable —
  // otherwise the picker shows the placeholder and the save is blocked.
  if (entry && (entry.enrollmentSubjectId || entry.course)) {
    const covered = options.some(es =>
      (entry.enrollmentSubjectId && es.enrollmentSubjectId === entry.enrollmentSubjectId) ||
      (!entry.enrollmentSubjectId && entry.course && es.subjectCode === entry.course)
    );
    if (!covered) {
      options.unshift({
        enrollmentSubjectId: entry.enrollmentSubjectId || null,
        subjectCode: entry.course || "",
        title: entry.subject || "",
        isCurrent: true,
      });
    }
  }

  options.forEach(es => {
    const opt = document.createElement("option");
    opt.value = es.enrollmentSubjectId || es.subjectCode || "";
    const label = es.title
      ? `${es.title} (${es.subjectCode || "?"})`
      : es.subjectCode || "";
    opt.textContent = es.isCurrent ? `${label} — current` : label;
    if (entry?.enrollmentSubjectId && es.enrollmentSubjectId === entry.enrollmentSubjectId) {
      opt.selected = true;
    } else if (!entry?.enrollmentSubjectId && entry?.course && es.subjectCode === entry.course) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function populateRoomDropdown(buildingId, selectedRoomId) {
  const roomSelect = document.getElementById("crud-room");
  if (!roomSelect) return;

  roomSelect.innerHTML = '<option value="">None</option>';

  if (!buildingId) return;

  // Load rooms from catalog
  const allRooms = state.buildingsRooms || [];
  const filtered = allRooms.filter(r => r.buildingId === buildingId);

  filtered.forEach(room => {
    const opt = document.createElement("option");
    opt.value = room.roomId;
    opt.textContent = room.roomCode || room.roomId;
    if (room.roomId === selectedRoomId) opt.selected = true;
    roomSelect.appendChild(opt);
  });
}

async function handleCrudSubmit(existingEntry) {
  const errorEl = document.getElementById("crud-error");
  const saveBtn = document.getElementById("crud-save-btn");
  if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
  if (saveBtn?.disabled) return;

  const field = (id) => document.getElementById(id);
  const fail = (input, message) => {
    const err = new Error(message);
    err.field = input;
    throw err;
  };

  try {
    const subjectEl = field("crud-subject");
    const dayEl = field("crud-day");
    const startEl = field("crud-start");
    const endEl = field("crud-end");
    const modalityEl = field("crud-modality");
    const buildingEl = field("crud-building");
    const roomEl = field("crud-room");
    const locationEl = field("crud-location");

    [subjectEl, dayEl, startEl, endEl].forEach(el => el?.removeAttribute("aria-invalid"));

    const subjectVal = subjectEl?.value || "";
    const dayVal = dayEl?.value || "";
    const startVal = startEl?.value || "";
    const endVal = endEl?.value || "";
    const modalityVal = modalityEl?.value || "ONSITE";
    const buildingVal = buildingEl?.value || "";
    const roomVal = roomEl?.value || "";
    const locationVal = locationEl?.value || "";

    // ── Validation (shown in the modal, never a silent native bubble) ──
    if (!subjectVal) {
      if (!subjectEl || subjectEl.options.length <= 1) {
        fail(subjectEl, "No subjects are available for your enrollment yet. Import your COR first, then try again.");
      }
      fail(subjectEl, "Please select a subject.");
    }
    if (!dayVal) fail(dayEl, "Please select a day.");
    if (!startVal || !endVal) fail(startEl, "Please enter start and end times.");
    if (startVal >= endVal) fail(endEl, "End time must be after start time.");

    const es = _crudEnrollmentSubjects.find(s =>
      s.enrollmentSubjectId === subjectVal || s.subjectCode === subjectVal
    );

    // Only send the subject when it is actually different. Resending an
    // unchanged subject is what made a plain "move this class to Monday" fail
    // with "Enrollment subject not found".
    const currentSubject = existingEntry?.enrollmentSubjectId || null;
    const nextSubject = es?.enrollmentSubjectId || (currentSubject && subjectVal === currentSubject ? currentSubject : subjectVal);
    const subjectChanged = Boolean(existingEntry?.entryId) && nextSubject !== currentSubject;

    const payload = {
      dayOfWeek: dayVal,
      startTime: startVal,
      endTime: endVal,
      modality: modalityVal,
      buildingId: buildingVal || null,
      roomId: roomVal || null,
      locationText: locationVal || null,
    };
    if (!existingEntry?.entryId || subjectChanged) {
      payload.enrollmentSubjectId = nextSubject;
    }

    window.QCULoading.button(saveBtn, true);

    let result;
    if (existingEntry?.entryId) {
      result = await updateScheduleEntry(existingEntry.entryId, payload);
    } else {
      result = await createScheduleEntry(payload);
    }

    if (!result?.ok) {
      const code = result?.error?.code;
      let msg = result?.error?.message || result?.error || "Failed to save entry.";
      if (code === "SCHEDULE_CONFLICT" && Array.isArray(result?.error?.conflicts) && !result?.error?.message) {
        const clash = result.error.conflicts[0];
        const clashDay = clash.dayOfWeek ? `${clash.dayOfWeek[0]}${clash.dayOfWeek.slice(1).toLowerCase()}` : "";
        const span = clash.startTime && clash.endTime ? ` ${clash.startTime}–${clash.endTime}` : "";
        if (clashDay || span) msg = `That overlaps another class on ${clashDay}${span}. Pick a different day or time.`;
      }
      const err = new Error(msg);
      // The API names the twin row when it rejects an exact duplicate, so the
      // modal can offer to delete it instead of leaving the student stuck.
      err.duplicateEntryId = result?.error?.duplicateEntryId || null;
      throw err;
    }

    // Success — close modal, reload schedule
    const modal = document.getElementById("crud-modal");
    if (modal) modal.classList.remove("open");
    document.body.classList.remove("modal-open");

    // Reload schedule from API and re-render
    await reloadSchedule();
  } catch (err) {
    if (err?.field) {
      err.field.setAttribute("aria-invalid", "true");
      err.field.focus();
    }
    if (errorEl) {
      const duplicateId = err?.duplicateEntryId;
      if (duplicateId) {
        // Offer the fix instead of only the complaint: the row that blocks the
        // save is an exact copy of this class, so deleting it is safe.
        errorEl.innerHTML = `${esc(err.message || "An error occurred.")}
          <button type="button" class="crud-error-action" id="crud-delete-duplicate">Delete the extra copy</button>`;
        errorEl.style.display = "block";
        document.getElementById("crud-delete-duplicate")?.addEventListener("click", async (event) => {
          const btn = event.currentTarget;
          window.QCULoading.button(btn, true);
          const res = await deleteScheduleEntryApi(duplicateId);
          if (res?.ok) {
            closeCrudModal();
            await reloadSchedule();
          } else {
            window.QCULoading.button(btn, false);
            errorEl.textContent = res?.error?.message || res?.error || "Could not delete the extra copy.";
          }
        });
      } else {
        errorEl.textContent = err.message || "An error occurred.";
        errorEl.style.display = "block";
      }
    }
  } finally {
    window.QCULoading.button(saveBtn, false);
  }
}

function confirmDeleteEntry(entry) {
  if (!entry?.entryId) return;
  const confirmed = window.confirm(
    `Delete "${entry.subject || entry.course || "this class"}" on ${entry.day}?`
  );
  if (!confirmed) return;

  window.QCULoading.action(document.getElementById("crud-delete-btn"), () => performDeleteEntry(entry));
}

async function performDeleteEntry(entry) {
  const errorEl = document.getElementById("crud-error");
  if (errorEl) { errorEl.style.display = "none"; }

  try {
    const result = await deleteScheduleEntryApi(entry.entryId);
    if (!result?.ok) {
      throw new Error(result?.error || "Failed to delete entry.");
    }

    // Close modal, reload
    const modal = document.getElementById("crud-modal");
    if (modal) modal.classList.remove("open");
    document.body.classList.remove("modal-open");

    await reloadSchedule();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || "Failed to delete entry.";
      errorEl.style.display = "block";
    }
  }
}

async function reloadSchedule() {
  try {
    const data = await fetchScheduleFromApi();
    if (data?.ok && data.data?.entries) {
      state.schedule = data.data.entries.map(mapApiEntry);
    }
  } catch (e) {
    console.warn("Schedule reload failed:", e);
  }
  // Re-render all schedule views
  if (page === "home") renderHome();
  if (page === "schedule") renderSchedule();
  iconify();
}

/* ── Schedule CRUD Modal Close Handler ────────────── */
function closeCrudModal() {
  const modal = document.getElementById("crud-modal");
  const wasOpen = modal?.classList.contains("open");
  if (modal) modal.classList.remove("open");
  document.body.classList.remove("modal-open");
  _crudEditingEntry = null;
  if (wasOpen && _crudReturnFocus?.isConnected) _crudReturnFocus.focus();
}

/* ── Sign Out ────────────────────────────────────── */
window.signOut = function (button) {
  window.QCULoading.button(button, true);
  // GET /api/auth/logout does a 302 redirect that clears all cookies
  // reliably before landing on the login page.
  window.location.href = "/api/auth/logout";
};

/* ── Init ────────────────────────────────────────────── */
async function init() {
  if (window.__QCU_INIT_STARTED) return;
  window.__QCU_INIT_STARTED = true;

  // HTML contains responsive placeholders until the profile and data are ready.
  renderShell();
  iconify();
  if (page === "google") window.QCUGoogleIntegration?.init();

  // Fetch authenticated dashboard data (single endpoint)
  try {
    const data = await readWithFeedback('/api/v1/dashboard', 'dashboard', () => location.reload(), !!state.dashboard);

    if (data.status === "UNAUTHENTICATED") {
      loadNotice('dashboard', 'Sign in to see your schedule.', () => { location.href='/api/auth/google/start'; }, 'Sign in again');
      // Not logged in — show shell with defaults, no schedule
      state.loading = false;
      renderShell();
      tick();
      return;
    }

    if (data.status === "INCOMPLETE") {
      loadNotice('dashboard', 'Finish reviewing your COR to see your schedule.', () => { location.href='/onboarding.html'; }, 'Continue COR review');
      // Logged in but not yet onboarded
      state.loading = false;
      renderShell();
      tick();
      return;
    }

    // Active account with nothing to show (a legacy row, or a COR that produced
    // no classes): send it to the COR import instead of rendering an empty week.
    if (data.status === "ONBOARDING_REQUIRED") {
      window.location.replace('/onboarding.html');
      return;
    }

    if (data.status === "DEACTIVATED") {
      loadNotice('dashboard', 'Your account is deactivated. Contact your administrator.');
      state.loading = false;
      renderShell();
      tick();
      return;
    }

    if (data.status !== 'OK') throw new Error('Dashboard data is unavailable.');
    if (data.status === "OK") {
      state.dashboard = data;
      state.profile = data.profile || null;
      state.enrollment = data.enrollment || null;
      state.academic = data.academic || null;
      state.buildings = (data.buildings || []).map(b => ({
        code: b.code,
        name: b.name,
        shortName: b.shortName,
        buildingId: b.buildingId,
        campusId: b.campusId,
        floors: b.floors,
        rooms: Array.isArray(b.rooms) ? b.rooms : [],
        image: b.image || null,
        description: b.description || "",
        lat: b.lat,
        lng: b.lng,
      }));
      // Map dashboard entries to schedule item format expected by UI
      state.schedule = (data.entries || []).map(mapEntryToSchedule);
      // Seed task/note caches from dashboard response
      if (Array.isArray(data.tasks)) _tasksCache = data.tasks;
      if (Array.isArray(data.notes)) _notesCache = data.notes;
    }
  } catch (e) {
    console.warn("Dashboard load failed:", e);
    state.error = "Failed to load schedule data";
    if (!loadErrors.has('dashboard')) loadNotice('dashboard', 'Could not load the dashboard. ' + e.message, () => location.reload());
  }

  state.loading = false;

  renderShell();
  iconify();
  tick();

  if (page === "buildings") renderBuildings();
  if (page === "settings")  renderSettings();

  /* ── Modal close handlers ─────────────────────────── */
  ["building-modal", "day-modal", "task-modal", "note-modal", "crud-modal"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", e => {
        if (e.target.id === id || e.target.closest("[data-close-modal]") ||
            e.target.closest("[data-close-task-modal]") || e.target.closest("[data-close-note-modal]") ||
            e.target.closest("[data-close-crud-modal]")) {
          closeModal();
          closeTaskModal();
          closeNoteModal();
          closeCrudModal();
        }
      });
    }
  });

  /* ── Schedule Add FAB handler ─────────────────────── */
  const scheduleAddBtn = document.getElementById("schedule-add-btn");
  if (scheduleAddBtn) {
    scheduleAddBtn.addEventListener("click", () => openCrudModal(null));
  }
  document.getElementById("schedule-days")?.addEventListener("click", e => {
    const button = e.target.closest("[data-schedule-day]");
    if (!button) return;
    scheduleDay = button.dataset.scheduleDay;
    document.querySelectorAll("[data-schedule-day]").forEach(day => {
      day.setAttribute("aria-pressed", String(day === button));
    });
    renderSchedule();
  });

  // "Today" jumps the table to the current day — the full schedule is the only
  // place the week lives now, so it needs to be able to centre today.
  document.getElementById("schedule-today-btn")?.addEventListener("click", () => {
    const today = QCU_TIME.weekday();
    const target = [...document.querySelectorAll("[data-schedule-day]")]
      .find(day => normalizeDayName(day.dataset.scheduleDay) === normalizeDayName(today));
    if (!target) return;
    target.click();
    target.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  });
  document.getElementById("crud-modal")?.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const controls = [...e.currentTarget.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter(el => !el.disabled && el.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });

  /* ── Schedule Edit button delegation ─────────────── */
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-action='edit-entry']");
    if (!btn) return;
    const entryId = btn.dataset.entryId;
    if (!entryId) return;
    const entry = state.schedule.find(s => s.entryId === entryId);
    if (entry) openCrudModal(entry);
  });

  document.getElementById("home-week-strip")?.addEventListener("click", e => {
    const cell = e.target.closest("[data-day]");
    if (cell) openDayModal(cell.dataset.day);
  });

  /* ── Task page event listeners ────────────────────── */
  const taskList = document.getElementById("task-list");
  if (taskList) {
    taskList.addEventListener("click", async e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "toggle") { await window.QCULoading.action(btn, () => toggleTask(id)); renderTasks(); }
      if (action === "edit") {
        const task = (_tasksCache || []).find(t => (t.taskId || t.id) === id);
        if (task) openTaskModal(task);
      }
      if (action === "delete") { await window.QCULoading.action(btn, () => deleteTask(id)); renderTasks(); }
    });
  }

  if (!document.querySelector(`[data-page="tasks"] .fab, [data-page="workspace"] .fab`)) {
    const tasksFab = document.createElement("button");
    tasksFab.className = "fab";
    tasksFab.innerHTML = '<i data-lucide="plus"></i>';
    tasksFab.setAttribute("aria-label", "Add task or note");
    tasksFab.addEventListener("click", () => {
      const active = document.querySelector("[data-workspace-view].is-active")?.dataset.workspaceView || "tasks";
      if (active === "notes") openNoteModal(null);
      else openTaskModal(null);
    });
    document.querySelector(`[data-page="tasks"] .page-container, [data-page="workspace"] .page-container`)?.appendChild(tasksFab);
  }

  document.getElementById("task-search")?.addEventListener("input", renderTasks);
  document.getElementById("task-filter-status")?.addEventListener("change", renderTasks);
  document.getElementById("task-filter-subject")?.addEventListener("change", renderTasks);
  document.getElementById("task-sort")?.addEventListener("change", renderTasks);

  /* ── Task search clear button ─────────────────────── */
  const taskSearch = document.getElementById("task-search");
  const taskClear = document.getElementById("task-search-clear");
  if (taskSearch && taskClear) {
    taskSearch.addEventListener("input", () => {
      taskClear.classList.toggle("visible", taskSearch.value.length > 0);
    });
    taskClear.addEventListener("click", () => {
      taskSearch.value = "";
      taskClear.classList.remove("visible");
      renderTasks();
      taskSearch.focus();
    });
  }

  /* ── Notes page event listeners ───────────────────── */
  const noteList = document.getElementById("note-list");
  if (noteList) {
    noteList.addEventListener("click", async e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "edit-note") {
        const note = (_notesCache || []).find(n => (n.noteId || n.id) === id);
        if (note) openNoteModal(note);
      }
      if (action === "delete-note") { await window.QCULoading.action(btn, () => deleteNote(id)); renderNotes(); }
    });
  }

  if (page === "notes" && !document.querySelector(`[data-page="notes"] .fab`)) {
    const notesFab = document.createElement("button");
    notesFab.className = "fab";
    notesFab.innerHTML = '<i data-lucide="plus"></i>';
    notesFab.setAttribute("aria-label", "Add note");
    notesFab.addEventListener("click", () => openNoteModal(null));
    document.querySelector(`[data-page="notes"] .page-container`)?.appendChild(notesFab);
  }

  if (page === "workspace") {
    const workspace = document.querySelector("[data-page=workspace]");
    const buttons = workspace?.querySelectorAll("[data-workspace-view]") || [];
    const panels = workspace?.querySelectorAll("[data-workspace-panel]") || [];
    const setWorkspaceView = async (view, updateUrl = true) => {
      buttons.forEach(button => {
        const active = button.dataset.workspaceView === view;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      panels.forEach(panel => {
        const active = panel.dataset.workspacePanel === view;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
      if (updateUrl) history.replaceState({}, "", `${location.pathname}#${view}`);
      await Promise.all([_tasksCache === null ? fetchTasksFromApi() : null, _notesCache === null ? fetchNotesFromApi() : null]);
      renderTasks();
      renderNotes();
      iconify();
    };
    buttons.forEach(button => button.addEventListener("click", () => setWorkspaceView(button.dataset.workspaceView)));
    const initialView = location.hash === "#notes" ? "notes" : "tasks";
    setWorkspaceView(initialView, false);
  }

  document.getElementById("note-search")?.addEventListener("input", renderNotes);
  document.getElementById("note-filter-subject")?.addEventListener("change", renderNotes);
  document.getElementById("note-sort")?.addEventListener("change", renderNotes);

  /* ── Note search clear button ─────────────────────── */
  const noteSearch = document.getElementById("note-search");
  const noteClear = document.getElementById("note-search-clear");
  if (noteSearch && noteClear) {
    noteSearch.addEventListener("input", () => {
      noteClear.classList.toggle("visible", noteSearch.value.length > 0);
    });
    noteClear.addEventListener("click", () => {
      noteSearch.value = "";
      noteClear.classList.remove("visible");
      renderNotes();
      noteSearch.focus();
    });
  }

  /* ── Global keyboard shortcuts ────────────────────── */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModal(); closeTaskModal(); closeNoteModal(); closeCrudModal(); }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:" && location.hostname !== "127.0.0.1" && location.hostname !== "localhost") {
    // Remember whether a worker was already in control BEFORE we register.
    // On a first-ever visit there is no controller, so the controllerchange
    // that clients.claim() fires is expected and must NOT trigger a reload.
    var hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.register("service-worker.js").then(function (reg) {
      // Ask the browser to re-check service-worker.js on every load so a new
      // deploy (bumped CACHE_NAME) is picked up without closing all tabs.
      reg.update();
    }).catch(function () {});

    // When a new worker takes over an already-controlled page, reload once so
    // the tab runs the freshly-fetched HTML/JS instead of the old worker's copy.
    var swReloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (swReloaded || !hadController) return;
      swReloaded = true;
      window.location.reload();
    });
  }

  iconify();
  if (!window.__QCU_TICK_TIMER) window.__QCU_TICK_TIMER = setInterval(tick, 1000);
}

init();
