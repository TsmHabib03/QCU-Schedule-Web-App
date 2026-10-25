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
// Utility pages belong to Settings; Schedule is a primary destination.
const NAV_PARENT_PAGE = { buildings: "settings", tasks: "workspace", notes: "workspace" };
const navPage = NAV_PARENT_PAGE[page] || page;
// Integration authorization is separate from the Google login identity.
// Never infer Classroom access from a verified login email or an OAuth URL.
let googleConnection = null;
let googleStatusRequest = null;
let googleStatusCheckedAt = 0;
let googleStatusVersion = 0;
function publishGoogleConnection(account) {
  googleConnection = account;
  renderHomeAvatar();
  window.dispatchEvent(new CustomEvent('qcu-google-state', { detail: account }));
}
window.QCUGoogleConnection = {
  get account() { return googleConnection; },
  async refresh(force = false) {
    if (googleStatusRequest) return googleStatusRequest;
    if (!force && googleConnection && Date.now() - googleStatusCheckedAt < 30000) return googleConnection;
    const version = googleStatusVersion;
    const localProxy = ['localhost', '127.0.0.1'].includes(location.hostname) && ['5500', '5501', '5502', '5503'].includes(location.port);
    const endpoint = localProxy ? `${location.protocol}//${location.hostname}:8788/api/google/status` : '/api/google/status';
    googleStatusRequest = (async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', credentials: localProxy ? 'include' : 'same-origin', signal: AbortSignal.timeout(35000) });
        if (!response.headers.get('Content-Type')?.includes('application/json')) {
          throw Object.assign(new Error('Google connection is unavailable.'), { code: 'INVALID_API_RESPONSE' });
        }
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.error || 'Could not check Google connection.'), { status: response.status });
        if (version !== googleStatusVersion) return googleConnection;
        googleStatusCheckedAt = Date.now();
        publishGoogleConnection(result);
        return result;
      } catch (error) {
        if (version === googleStatusVersion) publishGoogleConnection(null);
        throw error;
      } finally { googleStatusRequest = null; }
    })();
    return googleStatusRequest;
  },
  disconnect() {
    googleStatusVersion++;
    googleStatusCheckedAt = Date.now();
    publishGoogleConnection({ connected: false, status: 'not_connected' });
    try { localStorage.setItem('qcu-google-changed', String(Date.now())); } catch (_) {}
  }
};
window.addEventListener('focus', () => {
  if (state.dashboard && navigator.onLine) window.QCUGoogleConnection.refresh(true).catch(() => {});
});
window.addEventListener('storage', event => {
  if (event.key === 'qcu-google-changed' && state.dashboard) window.QCUGoogleConnection.refresh(true).catch(() => {});
});
let scheduleDay = "all";
let scheduleEditing = false;
let scheduleSelectedEntry = null;
const workspaceCategory = { task: 'all', note: 'all' };
let workspaceView = page === "notes" || (page === "workspace" && location.hash === "#notes") ? "notes" : "tasks";

/* ── Utils ───────────────────────────────────────────── */
function iconify() { if (window.lucide && document.querySelector('i[data-lucide]')) window.lucide.createIcons(); }

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
  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  function weekday(date = new Date()) {
    return dayFormatter.format(date);
  }
  function minutes(date = new Date()) {
    const value = timeFormatter.formatToParts(date);
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
  document.querySelectorAll(`[id="${id}"]`).forEach(n => { if (n.textContent !== String(val)) n.textContent = val; });
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
    ["schedule",  "schedule.html",  "calendar-days",    "Schedule"],
    ["campus-eta", "campus-eta.html", "bus",             "QC Bus"],
    ["workspace", "workspace.html", "clipboard-list",   "Tasks"],
    ["settings",  "settings.html",  "settings",         "Settings"]
  ];

  const header = document.getElementById("app-header");
  if (header) {
    const brandSub = formatBrandSub();
    header.innerHTML = page === 'settings' ? `
      <div class="header-inner profile-toolbar">
        <a class="profile-toolbar-btn" href="index.html" aria-label="Back to Home"><i data-lucide="chevron-left" aria-hidden="true"></i></a>
        <h1>My profile</h1>
        <button id="profile-notifications-btn" class="profile-toolbar-btn" type="button" aria-label="Notification settings"><i data-lucide="bell" aria-hidden="true"></i><span class="profile-bell-dot" hidden></span></button>
      </div>` : `
      <div class="header-inner">
        <a href="index.html" class="header-brand">
           <img class="brand-logo" src="assets/images/brand/qcu-mark.svg" alt="QCU Schedule">
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
          <a id="home-avatar" class="home-avatar qc-pride-avatar" href="settings.html" aria-label="Open profile settings"><i data-lucide="user" aria-hidden="true"></i></a>
        </div>
      </div>`;
  }

  const nav = document.getElementById("bottom-nav");
  if (nav) {
    nav.innerHTML = `
      <div class="nav-strip">
        ${navItems.map(([key, href, icon, label]) => {
          return `<a class="nav-item ${navPage === key ? "active" : ""}"
             data-nav-page="${key}" href="${href}" aria-label="${label}" ${navPage === key ? 'aria-current="page"' : ''}>
            <i data-lucide="${icon}" aria-hidden="true"></i>
            <span class="nav-label" aria-hidden="true">${label}</span>
          </a>`;
        }).join("")}
        ${navPage === "workspace" ? `
          <button class="nav-add" type="button" data-workspace-add aria-label="Add ${workspaceView === 'notes' ? 'note' : 'task'}" title="Add ${workspaceView === 'notes' ? 'note' : 'task'}" aria-haspopup="dialog" aria-controls="${workspaceView === 'notes' ? 'note' : 'task'}-modal">
            <i data-lucide="plus" aria-hidden="true"></i>
          </button>` : `
          <a class="nav-add nav-google" href="settings.html#google-connection" aria-label="Google Classroom integration and updates" title="Google Classroom integration and updates">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          </a>`}
      </div>`;
    initNavigation(nav);
  }
  renderHomeAvatar();
  window.QCULoading.finish('shell');
}

function initNavigation(nav) {
  // Share the existing editor across routes, keeping its API and form logic.
  let modal = document.getElementById("crud-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "crud-modal";
    modal.className = "modal-backdrop";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Schedule entry form");
    modal.innerHTML = '<div id="crud-modal-content" class="modal-card"></div>';
    nav.closest(".app-shell").appendChild(modal);
  }
  if (!modal._navigationBound) {
    modal._navigationBound = true;
    modal.addEventListener("click", e => {
      if (e.target === modal || e.target.closest("[data-close-crud-modal]")) closeCrudModal();
    });
    modal.addEventListener("keydown", e => {
      if (e.key === "Escape") { closeCrudModal(); return; }
      if (e.key !== "Tab") return;
      const controls = [...modal.querySelectorAll('button, input, select, textarea, a[href]')]
        .filter(el => !el.disabled && el.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    });
  }
  const select = key => nav.querySelectorAll("[data-nav-page]").forEach(link => {
    link.classList.toggle("active", link.dataset.navPage === key);
  });
  // Carry the departing selection into the next page so a normal route link
  // can animate without delaying navigation or changing browser behavior.
  let previous;
  try {
    previous = sessionStorage.getItem("qcu-nav-from");
    sessionStorage.removeItem("qcu-nav-from");
  } catch { /* Navigation works when browser storage is unavailable. */ }
  if (previous && previous !== navPage && [...nav.querySelectorAll('[data-nav-page]')].some(link => link.dataset.navPage === previous) &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    select(previous);
    requestAnimationFrame(() => requestAnimationFrame(() => select(navPage)));
  }
  nav.onclick = e => {
    if (e.target.closest("[data-workspace-add]")) {
      if (workspaceView === "notes") openNoteModal(null);
      else openTaskModal(null);
      return;
    }
    const link = e.target.closest("[data-nav-page]");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.dataset.navPage !== navPage) {
      try { sessionStorage.setItem("qcu-nav-from", navPage); } catch { /* Optional motion state. */ }
      select(link.dataset.navPage);
    }
  };
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

const HOME_WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let homeSelectedDay = null;
let homeToday = null;
let homeSelectedDate = null;
let homePreviousDate = null;
let homeMonth = null;

const homeDateKey = date => date.toISOString().slice(0, 10);
const homeDateFromKey = key => new Date(key + 'T00:00:00Z');
function homeMonday(date) {
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday;
}
function selectHomeDate(key) {
  const date = homeDateFromKey(key);
  if (!Number.isFinite(date.getTime())) return;
  homeSelectedDate = key;
  homeSelectedDay = HOME_WEEK_DAYS[(date.getUTCDay() + 6) % 7];
  homeMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  renderHome();
}

// Represent Manila calendar dates at UTC midnight so browser timezones cannot
// shift the current week or its date numbers.
function homeCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: QCU_TIME.zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
}

function selectHomeDay(day) {
  if (!HOME_WEEK_DAYS.includes(day)) return;
  const date = homeMonday(homeSelectedDate ? homeDateFromKey(homeSelectedDate) : homeCalendarDate());
  date.setUTCDate(date.getUTCDate() + HOME_WEEK_DAYS.indexOf(day));
  selectHomeDate(homeDateKey(date));
}

function keepHomeDayVisible(button) {
  const strip = button?.parentElement;
  if (!strip) return;
  const box = button.getBoundingClientRect(), viewport = strip.getBoundingClientRect();
  if (box.left < viewport.left + 4) strip.scrollLeft -= viewport.left + 4 - box.left;
  else if (box.right > viewport.right - 4) strip.scrollLeft += box.right - viewport.right + 4;
}

function renderHomeAvatar() {
  const avatar = document.getElementById('home-avatar');
  if (!avatar) return;
  avatar.classList.toggle('google-verified-avatar', googleConnection?.connected === true);
  const name = String(state.profile?.name || '').trim();
  const picture = String(state.profile?.picture || '').trim();
  const key = JSON.stringify([name, picture]);
  if (avatar.dataset.profileKey === key) return;
  avatar.dataset.profileKey = key;
  avatar.setAttribute('aria-label', name ? `Open ${name}’s profile settings` : 'Open profile settings');
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words.length ? (Array.from(words[0])[0] + (words.length > 1 ? Array.from(words[words.length - 1])[0] : '')).toUpperCase() : '';
  const fallback = () => {
    avatar.innerHTML = `<span class="avatar-face" aria-hidden="true">${initials ? esc(initials) : '<i data-lucide="user"></i>'}</span>`;
    iconify();
  };
  if (!/^https?:\/\//i.test(picture)) { fallback(); return; }
  avatar.innerHTML = `<span class="avatar-face"><img src="${esc(picture)}" alt="${esc(name || 'Student')}’s profile photo" loading="lazy" referrerpolicy="no-referrer"></span>`;
  avatar.querySelector('img').addEventListener('error', fallback, { once: true });
}

function homeClassStatus(item, now) {
  if (todayDuration(item) === null) return 'upcoming';
  if (homeSelectedDate) {
    const todayKey = homeDateKey(homeCalendarDate(now));
    if (homeSelectedDate < todayKey) return 'finished';
    if (homeSelectedDate > todayKey) return 'upcoming';
  }
  const today = QCU_TIME.weekday(now);
  if (item.day === today) return getStatus(item, now);
  return HOME_WEEK_DAYS.indexOf(item.day) < HOME_WEEK_DAYS.indexOf(today) ? 'finished' : 'upcoming';
}

/* ── Today Task line-up (vertical) ───────────────────── */
// Deterministic pastel per subject across clock updates and day selections.
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
function homeClassPlace(item) {
  const floor = String(item.floor ?? '').trim();
  const floorLabel = floor && floor !== '—' ? (/^\d+$/.test(floor) ? `Floor\u00a0${floor}` : floor) : '';
  return [buildingLabel(item), item.room, floorLabel].filter(value => value && value !== '—').join(' · ');
}

function todayDoneRowTemplate(item) {
  const mins = todayDuration(item);
  const hasTime = mins !== null;
  const place = homeClassPlace(item);
  return `
    <article class="home-today-done-row ${todayTint(item)}">
      <span class="home-today-done-check"><i data-lucide="check-circle-2" aria-hidden="true"></i><span class="loading-sr">Done</span></span>
      <span class="home-today-done-main">
        <span class="home-today-done-subject">${esc(item.subject || subjectDisplayName(item.course))}</span>
        ${item.course ? `<span class="home-today-course">${esc(item.course)}</span>` : ''}
        <span class="home-today-done-meta">
          <span class="home-today-done-time">${hasTime ? `${formatTime(item.start)} – ${formatTime(item.end)}` : "Time not set"}</span>
          ${mins === null ? "" : `<span class="home-today-done-duration">${formatGap(mins)}</span>`}
        </span>
        <span class="home-today-done-details"><i data-lucide="map-pin" aria-hidden="true"></i>${esc(place || 'Room to be announced')}</span>
        <span class="home-today-done-details"><i data-lucide="graduation-cap" aria-hidden="true"></i>${esc(String(item.instructor || '').trim() || 'Professor to be announced')}</span>
      </span>
    </article>`;
}

function todayEmptyTile(day) {
  return `
    <div class="soft-empty-tile">
      <i data-lucide="calendar-x-2"></i>
      <span class="soft-empty-title">${day ? `No classes on ${esc(day)}` : 'No classes today'}</span>
      <span class="soft-empty-sub">Enjoy the break — your full week is on the <a href="schedule.html">Schedule page</a>.</span>
    </div>`;
}

function todayAllDoneRow() {
  return `
    <div class="home-today-all-done">
      <i data-lucide="check-circle-2"></i>
      <span>All classes done for today</span>
    </div>`;
}

function todayTileTemplate(item, opts = {}) {
  const now = opts.now || new Date();
  const status = homeClassStatus(item, now);
  const statusWord = { current: "In session", next: "Up next", finished: "Done", upcoming: "Scheduled" }[status] || statusLabel(status);
  const mins = todayDuration(item);
  const timing = todayTiming(item, status, now);
  const feature = opts.feature ? " home-today-card--feature" : "";
  const place = homeClassPlace(item);
  const hasTime = mins !== null;
  const stagger = opts.i !== undefined ? ` style="--i:${opts.i}"` : "";

  return `
    <article class="home-today-card ${status}-tile${feature} ${todayTint(item)}" data-schedule-index="${state.schedule.indexOf(item)}"${stagger}>
      <div class="home-today-rail">
        <span class="home-today-rail-time">${hasTime ? formatTime(item.start) : "TBA"}</span>
        <span class="home-today-rail-rule"></span>
        <span class="home-today-rail-end">${hasTime ? formatTime(item.end) : "no time yet"}</span>
      </div>
      <div class="home-today-body">
        <div class="home-today-head">
          <span class="home-today-status">${statusWord}</span>
          ${item.course ? `<span class="home-today-course">${esc(item.course)}</span>` : ""}
        </div>
        <h3 class="home-today-subject">${esc(item.subject || subjectDisplayName(item.course))}</h3>
        <p class="home-today-building"><i data-lucide="map-pin" aria-hidden="true"></i>${esc(place || 'Room to be announced')}</p>
        <p class="home-today-professor"><i data-lucide="graduation-cap" aria-hidden="true"></i>${esc(String(item.instructor || '').trim() || 'Professor to be announced')}</p>
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

/* One compact current-week picker. Dates follow the campus timezone, while
   the recurring timetable continues to use its existing weekday state. */
function renderHomeCalendar() {
  const strip = document.getElementById('soft-calendar');
  if (!strip) return;
  const todayDate = homeCalendarDate();
  const monday = homeMonday(homeSelectedDate ? homeDateFromKey(homeSelectedDate) : todayDate);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  setText('calendar-label', format.format(monday) + ' \u2013 ' + format.format(sunday));
  const counts = weekOverview();
  const key = monday.toISOString() + JSON.stringify(counts);
  if (strip.dataset.weekKey !== key) {
    strip.dataset.weekKey = key;
    strip.innerHTML = HOME_WEEK_DAYS.map((day, index) => {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + index);
      const count = counts[day] || 0;
      return '<button type="button" role="tab" class="home-date-tab" id="home-day-' + index + '" data-date="' + homeDateKey(date) + '" data-day-name="' + day + '" aria-controls="today-grid" aria-label="' + day + ', ' + format.format(date) + ', ' + count + (count === 1 ? ' class' : ' classes') + '"><span class="home-date-day">' + day.slice(0, 3) + '</span><span class="home-date-number">' + date.getUTCDate() + '</span><span class="home-date-dot' + (count ? ' has-classes' : '') + '" aria-hidden="true"></span></button>';
    }).join('');
    strip.onclick = event => {
      const button = event.target.closest('[data-day-name]');
      if (button && strip.contains(button)) selectHomeDay(button.dataset.dayName);
    };
    strip.onkeydown = event => {
      const button = event.target.closest('[data-day-name]');
      if (!button) return;
      const index = HOME_WEEK_DAYS.indexOf(button.dataset.dayName);
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % 7;
      else if (event.key === 'ArrowLeft') next = (index + 6) % 7;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 6;
      else return;
      event.preventDefault();
      selectHomeDay(HOME_WEEK_DAYS[next]);
      strip.querySelectorAll('[role="tab"]')[next].focus({ preventScroll: true });
    };
  }
  strip.querySelectorAll('[role="tab"]').forEach(button => {
    const selected = button.dataset.dayName === homeSelectedDay;
    const isToday = button.dataset.date === homeDateKey(todayDate);
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('is-today', isToday);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (isToday) button.setAttribute('aria-current', 'date');
    else button.removeAttribute('aria-current');
  });
  keepHomeDayVisible(strip.querySelector('.is-selected'));
}

function renderHomeMonth() {
  const calendar = document.getElementById('home-month-calendar');
  if (!calendar) return;
  const today = homeCalendarDate();
  if (!homeMonth) homeMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(homeMonth);
  setText('home-month-label', monthLabel);
  const counts = weekOverview();
  const key = homeDateKey(homeMonth) + ':' + homeSelectedDate + ':' + homeDateKey(today) + JSON.stringify(counts);
  if (calendar.dataset.monthKey === key) return;
  calendar.dataset.monthKey = key;
  const start = homeMonday(homeMonth);
  const days = new Date(Date.UTC(homeMonth.getUTCFullYear(), homeMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const weeks = Math.ceil(((homeMonth.getUTCDay() + 6) % 7 + days) / 7);
  const labelFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const focusDate = homeSelectedDate && homeDateFromKey(homeSelectedDate).getUTCMonth() === homeMonth.getUTCMonth() && homeDateFromKey(homeSelectedDate).getUTCFullYear() === homeMonth.getUTCFullYear()
    ? homeSelectedDate : homeDateKey(homeMonth);
  const rows = [];
  for (let row = 0; row < weeks; row++) {
    const cells = [];
    for (let column = 0; column < 7; column++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + row * 7 + column);
      const dateKey = homeDateKey(date);
      const inMonth = date.getUTCMonth() === homeMonth.getUTCMonth();
      const count = counts[HOME_WEEK_DAYS[column]] || 0;
      cells.push(!inMonth ? '<div role="gridcell" class="home-month-blank"></div>'
        : `<div role="gridcell" aria-selected="${dateKey === homeSelectedDate}"><button type="button" class="home-month-date${dateKey === homeSelectedDate ? ' is-selected' : ''}${dateKey === homeDateKey(today) ? ' is-today' : ''}" data-date="${dateKey}" tabindex="${dateKey === focusDate ? 0 : -1}"${dateKey === homeDateKey(today) ? ' aria-current="date"' : ''} aria-label="${labelFormat.format(date)}, ${count} ${count === 1 ? 'class' : 'classes'}"><span>${date.getUTCDate()}</span><span class="home-month-dot${count ? ' has-classes' : ''}" aria-hidden="true"></span></button></div>`);
    }
    rows.push('<div role="row" class="home-month-row">' + cells.join('') + '</div>');
  }
  calendar.innerHTML = '<div role="row" class="home-month-row home-month-weekdays">' + HOME_WEEK_DAYS.map(day => '<span role="columnheader" aria-label="' + day + '">' + day.slice(0, 3) + '</span>').join('') + '</div>' + rows.join('');
  calendar.onclick = event => {
    const button = event.target.closest('button[data-date]');
    if (!button) return;
    selectHomeDate(button.dataset.date);
    calendar.querySelector('button[data-date="' + homeSelectedDate + '"]')?.focus({ preventScroll: true });
  };
  calendar.onkeydown = event => {
    const button = event.target.closest('button[data-date]');
    if (!button) return;
    const date = homeDateFromKey(button.dataset.date);
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in offsets) date.setUTCDate(date.getUTCDate() + offsets[event.key]);
    else if (event.key === 'Home') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    else if (event.key === 'End') date.setUTCDate(date.getUTCDate() + 6 - (date.getUTCDay() + 6) % 7);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + (event.key === 'PageUp' ? -1 : 1));
      date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
    } else return;
    event.preventDefault();
    selectHomeDate(homeDateKey(date));
    calendar.querySelector('button[data-date="' + homeSelectedDate + '"]')?.focus({ preventScroll: true });
  };
  const previous = document.getElementById('home-month-prev');
  const next = document.getElementById('home-month-next');
  previous.onclick = () => { homeMonth.setUTCMonth(homeMonth.getUTCMonth() - 1); renderHomeMonth(); };
  next.onclick = () => { homeMonth.setUTCMonth(homeMonth.getUTCMonth() + 1); renderHomeMonth(); };
  document.getElementById('home-month-today').onclick = () => selectHomeDate(homeDateKey(homeCalendarDate()));
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
      <a class="soft-goal soft-goal--lavender" href="settings.html#google-connection">
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
      <a class="soft-goal ${pastels[i % pastels.length]}" href="${esc(u.link || "settings.html#google-connection")}" target="_blank" rel="noopener">
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
  let total = 0, done = 0;
  days.forEach((d, i) => {
    const dayClasses = classes.filter(x => x.day === d);
    total += dayClasses.length;
    done += dayClasses.filter(x => todayDuration(x) !== null &&
      (i < days.indexOf(today) || (d === today && getStatus(x, now) === 'finished'))).length;
  });

  const pct = total ? Math.round((done / total) * 100) : 0;
  setText("week-progress-pct", pct + "%");
  document.getElementById("week-progress-fill").style.width = pct + "%";
  setText("week-progress-sub", `${done} of ${total} class sessions done this week`);
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

  const today = QCU_TIME.weekday(now);
  const todayKey = homeDateKey(homeCalendarDate(now));
  if (!homeSelectedDay || !homeSelectedDate || (homePreviousDate && homePreviousDate !== todayKey && homeSelectedDate === homePreviousDate)) {
    homeSelectedDay = today;
    homeSelectedDate = todayKey;
    homeMonth = new Date(Date.UTC(homeCalendarDate(now).getUTCFullYear(), homeCalendarDate(now).getUTCMonth(), 1));
  }
  homePreviousDate = todayKey;
  homeToday = today;
  const isToday = homeSelectedDate === todayKey;
  const dayClasses = classesForDay(homeSelectedDay);
  const allDone = dayClasses.length && dayClasses.every(item => homeClassStatus(item, now) === 'finished');
  setText("home-greeting", `${greeting}, ${(String(state.profile?.name || '').trim() || 'Student').split(/\s+/)[0]}!`);
  setText('home-summary', !isToday ? `${dayClasses.length} ${dayClasses.length === 1 ? 'class' : 'classes'} on ${homeSelectedDay}`
    : !dayClasses.length ? 'No classes today — enjoy the break' : allDone ? `All ${dayClasses.length} classes done` : `You have ${dayClasses.length} ${dayClasses.length === 1 ? 'class' : 'classes'} today`);
  const summary = document.getElementById('home-summary');
  if (summary) summary.innerHTML = esc(summary.textContent).replace(/\d+ classes?/, '<strong>$&</strong>');
  renderHomeAvatar();
  setText('today-heading', isToday ? 'Today’s schedule' : `${homeSelectedDay}’s schedule`);

  const heroSkeleton = document.getElementById("hero-skeleton");
  if (heroSkeleton) heroSkeleton.style.display = "none";

  // Left column: today's line-up. Finished classes collapse to compact rows,
  // then a "now" marker, then the current/next class as the purple feature box,
  // breaks, and the rest of the day in order.
  const grid = document.getElementById("today-grid");
  if (grid) {
    const todaysClasses = dayClasses;
    const tiles = [];

    if (!todaysClasses.length) {
      tiles.push(todayEmptyTile(isToday ? null : homeSelectedDay));
    } else {
      const done = todaysClasses.filter(x => homeClassStatus(x, now) === "finished");
      const ahead = todaysClasses.filter(x => homeClassStatus(x, now) !== "finished");

      done.forEach(item => tiles.push(todayDoneRowTemplate(item)));

      if (ahead.length) {
        // The Now marker only means something when at least one class left has a
        // real clock time (entries whose COR row lost its time are all "upcoming").
        const hasClock = x => todayDuration(x) !== null;
        if (isToday && ahead.some(hasClock)) tiles.push(nowMarkerTemplate(now));
        const lastDone = done[done.length - 1];
        if (lastDone && hasClock(lastDone) && hasClock(ahead[0])) {
          const gap = parseMinutes(ahead[0].start) - parseMinutes(lastDone.end);
          if (gap >= BREAK_MIN) tiles.push(breakTileTemplate(lastDone.end, ahead[0].start, gap, 0));
        }
        const feature = isToday ? ahead.find(item => ['current', 'next'].includes(homeClassStatus(item, now))) : null;
        let breakIndex = 0;
        ahead.forEach((item, i) => {
          tiles.push(todayTileTemplate(item, { feature: item === feature, i, now }));
          const nextClass = ahead[i + 1];
          if (nextClass && hasClock(item) && hasClock(nextClass)) {
            const gap = parseMinutes(nextClass.start) - parseMinutes(item.end);
            if (gap >= BREAK_MIN) tiles.push(breakTileTemplate(item.end, nextClass.start, gap, breakIndex++));
          }
        });
      } else {
        if (isToday) tiles.push(todayAllDoneRow());
      }
    }
    setInnerHTML(grid, tiles.join(""));
  }

  renderWeekProgress();
  renderHomeCalendar();
  renderHomeMonth();
  renderTasksNotesColumn();
  iconify();
  queueHomeWidgets();
}

let homeWidgetsQueued = false;
function queueHomeWidgets() {
  if (homeWidgetsQueued || !state.dashboard) return;
  homeWidgetsQueued = true;
  const run = () => {
    homeWidgetsQueued = false;
    if (!state.dashboard || document.hidden) return;
    renderHomeBusCard();
    renderClassroomUpdates();
  };
  if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 0);
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

  prepareStudentModal(content, { label: 'Daily schedule', description: 'Your classes and time on campus for this day.', icon: 'calendar-days', close: closeModal });
  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
  content.querySelector("input, .feedback-close")?.focus();
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

function renderScheduleDates(now) {
  const strip = document.getElementById('schedule-days');
  if (!strip) return;
  const monday = homeMonday(homeCalendarDate(now));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  setText('schedule-week-label', `${format.format(monday)} – ${format.format(sunday)}`);
  const key = monday.toISOString();
  if (strip.dataset.weekKey !== key) {
    strip.dataset.weekKey = key;
    setInnerHTML(strip, `<button type="button" class="schedule-date schedule-date--week" data-schedule-day="all" aria-label="Full week" aria-controls="schedule-rows"><i data-lucide="calendar-days" aria-hidden="true"></i><span>Week</span></button>` + HOME_WEEK_DAYS.map((day, index) => {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + index);
      return `<button type="button" class="schedule-date" data-schedule-day="${day}" aria-label="${day}" aria-controls="schedule-rows" title="${day}, ${format.format(date)}"><span class="schedule-date-number">${date.getUTCDate()}</span><span>${dayShort(day)}</span><span class="schedule-date-dot${classesForDay(day).length ? ' has-classes' : ''}" aria-hidden="true"></span></button>`;
    }).join(''));
  }
  strip.querySelectorAll('[data-schedule-day]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.scheduleDay === scheduleDay));
    if (button.dataset.scheduleDay === QCU_TIME.weekday(now)) button.setAttribute('aria-current', 'date');
    else button.removeAttribute('aria-current');
    const dot = button.querySelector('.schedule-date-dot');
    dot?.classList.toggle('has-classes', classesForDay(button.dataset.scheduleDay).length > 0);
  });
}

function renderSchedule() {
  const rows = document.getElementById("schedule-rows");
  if (!rows) return;
  if (state.error && !state.dashboard) {
    setText("schedule-result", "Timetable unavailable");
    setInnerHTML(rows, '<div class="schedule-state"><strong>Your schedule could not be loaded.</strong><p>Use the retry button above to try again.</p></div>');
    return;
  }
  const now   = new Date();
  const today = QCU_TIME.weekday(now);
  renderScheduleDates(now);
  document.querySelector('.schedule-page')?.classList.toggle('is-editing', scheduleEditing);
  setText('schedule-title', scheduleEditing ? 'Edit Schedule' : 'Full Schedule');
  setText('schedule-hint', scheduleEditing ? 'Choose a class below to update its time, room, or professor.' : 'A little structure for every day. Tap a class to edit its details.');
  const entries = orderedSchedule(now).filter(item => !item.noClasses && (scheduleDay === "all" || normalizeDayName(item.day) === normalizeDayName(scheduleDay)));
  const summary = `${entries.length} class${entries.length === 1 ? "" : "es"} ${scheduleDay === "all" ? "this week" : `on ${scheduleDay}`}`;
  const result = document.getElementById("schedule-result");
  if (result && result.textContent !== summary) result.textContent = summary;
  if (!entries.length) {
    const title = scheduleDay === "all" ? "Your timetable is empty" : `No classes on ${scheduleDay}`;
    const hint = scheduleDay === "all" ? "Add a class to start building your week." : "Choose another day or view the full week.";
    setInnerHTML(rows, `<div class="schedule-state"><i data-lucide="calendar-heart" aria-hidden="true"></i><strong>${esc(title)}</strong><p>${hint}</p></div>`);
    iconify();
    return;
  }

  // Keep one chronological timeline at every screen size, including edit mode.
  const html = [];
  let lastDay = null;
  let lastEnd = null;

  entries.forEach(item => {
    const status  = getStatus(item, now);
    const isToday = normalizeDayName(item.day) === normalizeDayName(today);
    const rowClass = ['timeline-slot', `${status}-row`, isToday ? "today-row" : ""]
      .filter(Boolean).join(" ");
    if (lastDay !== item.day) {
      html.push(`<div class="timeline-day-heading"><h2>${esc(item.day)}</h2>${isToday ? '<span>Today</span>' : ''}</div>`);
    }

    // Insert break row between consecutive classes on the same day with gap >= BREAK_MIN
    if (!item.noClasses && lastDay === item.day && lastEnd !== null) {
      const gap = parseMinutes(item.start) - lastEnd;
      if (gap >= BREAK_MIN) {
        html.push(`
          <div class="timeline-slot timeline-break break-row"><span class="timeline-time">${formatTime(minutesToTime(lastEnd))}</span><div class="timeline-break-content"><i data-lucide="coffee" aria-hidden="true"></i><span>${formatGap(gap)} break <small>${formatTime(minutesToTime(lastEnd))} – ${formatTime(item.start)}</small></span></div></div>`);
      }
    }

    {
      const loc = homeClassPlace(item) || 'Room to be announced';
      const hasTime = todayDuration(item) !== null;
      const selected = scheduleSelectedEntry === item.entryId;
      const active = status === 'current' || selected;
      const course = courseVisual(item.course, item.subject);
      const tag = item.entryId ? 'button' : 'div';
      html.push(`
        <div class="${rowClass}${active ? ' is-highlighted' : ''}" ${item.entryId ? `data-entry-id="${esc(item.entryId)}"` : ""}>
          <span class="timeline-time">${hasTime ? formatTime(item.start) : 'TBA'}</span>
          <${tag} class="timeline-class${active ? ' is-highlighted' : ''}" ${item.entryId ? `type="button" data-action="edit-entry" data-entry-id="${esc(item.entryId)}" aria-label="Edit ${esc(item.subject || item.course || 'class')}" aria-haspopup="dialog"` : ''}>
            <span class="timeline-class-top"><span class="timeline-course"><i data-lucide="${course.icon}" aria-hidden="true"></i>${esc(item.course || 'Class')}</span><span class="schedule-status">${selected ? 'Selected' : status === 'inactive' ? 'Scheduled' : statusLabel(status)}</span></span>
            <span class="timeline-subject">${esc(item.subject || item.course || 'Untitled class')}</span>
            <span class="timeline-time-range">${hasTime ? `${formatTime(item.start)} – ${formatTime(item.end)}` : 'Time not set'}<span class="timeline-units">${item.units > 0 ? `${esc(item.units)} units` : 'Lab'}</span></span>
            <span class="timeline-detail"><i data-lucide="map-pin" aria-hidden="true"></i>${esc(loc)}</span>
            ${item.instructor ? `<span class="timeline-detail schedule-professor"><i data-lucide="graduation-cap" aria-hidden="true"></i><span>${esc(item.instructor)}</span></span>` : ''}
            ${item.entryId ? '<span class="timeline-edit-cue">Edit details <i data-lucide="arrow-up-right" aria-hidden="true"></i></span>' : ''}
          </${tag}>
        </div>`);
      lastDay = item.day;
      lastEnd = parseMinutes(item.end);
    }
  });

  setInnerHTML(rows, html.join(""));
  iconify();
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

  prepareStudentModal(content, { label: 'Building details', description: 'Rooms, floors, and classes in this campus building.', icon: 'building-2', close: closeModal });
  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
  content.querySelector("input, .feedback-close")?.focus();
}

function closeModal() {
  closeStudentModal("building-modal");
  closeStudentModal("day-modal");
}

/* ── Settings Page ───────────────────────────────────── */
function renderSettings() {
  window.QCUSettings?.render(state.profile);
}

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

function courseVisual(code = '', title = '') {
  const enrolled = state.academic?.enrollmentSubjects?.find(subject => String(subject.subjectCode || '').toLowerCase() === String(code).toLowerCase());
  const scheduled = state.schedule.find(item => String(item.course || '').toLowerCase() === String(code).toLowerCase());
  return window.QCUCourseIcons?.resolve(code, `${SUBJECT_NAMES[String(code).toUpperCase()] || ''} ${enrolled?.title || ''} ${scheduled?.subject || ''} ${title}`) || { id: 'general', label: 'General studies', icon: 'book-open', tone: 'purple' };
}

function courseIconMarkup(code, title) {
  const visual = courseVisual(code, title);
  return `<span class="study-subject-icon tone-${visual.tone}" data-course-category="${visual.id}" title="${visual.label}" aria-hidden="true"><i data-lucide="${visual.icon}"></i></span>`;
}

function studyMeetingMarkup(item) {
  if (!item.scheduleTime) return '';
  const times = String(item.scheduleTime).split(/[–—-]/).map(value => value.trim());
  if (times.length !== 2 || times.some(value => !Number.isFinite(parseMinutes(value)))) return '';
  const day = dayNames.find(value => normalizeDayName(value) === normalizeDayName(item.scheduleDay));
  return `<span class="task-meta"><i data-lucide="clock" aria-hidden="true"></i>${day ? `${esc(dayShort(day))} · ` : ''}${formatTime(times[0])} – ${formatTime(times[1])}</span>`;
}

function renderWorkspaceCategories(kind, items) {
  const container = document.getElementById(`${kind}-categories`);
  if (!container) return;
  const counts = new Map();
  items.forEach(item => {
    const visual = courseVisual(item.subjectCode || item.subject || '', item.subjectName || '');
    counts.set(visual.id, (counts.get(visual.id) || 0) + 1);
  });
  const categories = window.QCUCourseIcons?.categories || [];
  const available = categories.filter(category => counts.has(category.id));
  // Keep the two category tiles useful even before a student adds their first item.
  if (!available.length) available.push(...categories.filter(category => ['computing', 'general'].includes(category.id)));
  const noun = kind === 'task' ? 'task' : 'note';
  setInnerHTML(container, `<button type="button" class="study-category tone-orange${workspaceCategory[kind] === 'all' ? ' is-selected' : ''}" data-study-kind="${kind}" data-study-category="all" aria-pressed="${workspaceCategory[kind] === 'all'}"><i data-lucide="${kind === 'task' ? 'list-checks' : 'notebook-pen'}" aria-hidden="true"></i><span class="study-category-title">All ${noun}s</span><span class="study-category-footer">${items.length} ${noun}${items.length === 1 ? '' : 's'}<span class="study-category-arrow"><i data-lucide="arrow-right" aria-hidden="true"></i></span></span></button>` + available.map(category => `<button type="button" class="study-category tone-${category.tone}${workspaceCategory[kind] === category.id ? ' is-selected' : ''}" data-study-kind="${kind}" data-study-category="${category.id}" aria-pressed="${workspaceCategory[kind] === category.id}"><i data-lucide="${category.icon}" aria-hidden="true"></i><span class="study-category-title">${category.label}</span><span class="study-category-footer">${counts.get(category.id) || 0} ${noun}${counts.get(category.id) === 1 ? '' : 's'}<span class="study-category-arrow"><i data-lucide="arrow-right" aria-hidden="true"></i></span></span></button>`).join(''));
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
/* ── Toast / side notifications ───────────────────────── */
/* Non-blocking corner notice (e.g. data freshness). Keyed so repeat
   calls update one toast rather than stacking. Auto-dismisses unless
   duration is 0; always dismissible and announced via role="status". */
/* Shared feedback: semantic states, safe text content, and keyed lifecycle. */
const QCU_FEEDBACK_ICONS = { info: 'info', success: 'circle-check', error: 'circle-x' };
function feedbackState(value) { return ['success', 'error'].includes(value) ? value : 'info'; }
function feedbackIcon(name, className = '') {
  const icon = document.createElement('i');
  icon.dataset.lucide = name;
  icon.className = className;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
function feedbackButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = label;
  button.onclick = onClick;
  return button;
}
function feedbackClose(onClick) {
  const button = feedbackButton('', 'feedback-close', onClick);
  button.setAttribute('aria-label', 'Close dialog');
  button.append(feedbackIcon('x'));
  return button;
}
function feedbackHeading(title, description, iconName, id) {
  const body = document.createElement('div'); body.className = 'feedback-intro';
  const icon = document.createElement('span'); icon.className = 'feedback-status-icon';
  icon.append(feedbackIcon(iconName));
  const copy = document.createElement('div'); copy.className = 'feedback-copy';
  const heading = document.createElement('h2'); heading.id = id; heading.className = 'feedback-title'; heading.textContent = title;
  const text = document.createElement('p'); text.id = id + '-description'; text.className = 'feedback-description'; text.textContent = description;
  copy.append(heading, text); body.append(icon, copy);
  return body;
}
// Native dialogs provide protected focus and inert background, including when
// opened over a class editor. Queue requests so each caller receives its answer.
let feedbackDialogQueue = Promise.resolve();
function qcuDialog(options = {}) {
  const show = () => new Promise(resolve => {
    const variant = feedbackState(options.variant);
    const dialog = document.createElement('dialog');
    dialog.className = 'qcu-dialog'; dialog.dataset.feedbackState = variant;
    dialog.setAttribute('aria-labelledby', 'qcu-dialog-title');
    dialog.setAttribute('aria-describedby', 'qcu-dialog-title-description');
    const header = document.createElement('div'); header.className = 'feedback-header';
    const label = document.createElement('span'); label.textContent = options.label || { info: 'Information', success: 'Success', error: 'Confirm action' }[variant];
    let closing = false;
    const finish = confirmed => {
      if (closing) return; closing = true;
      dialog.classList.add('is-closing');
      setTimeout(() => { dialog.close(); dialog.remove(); resolve(confirmed); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    };
    header.append(label, feedbackClose(() => finish(false)));
    const footer = document.createElement('div'); footer.className = 'feedback-actions';
    if (options.secondaryLabel) footer.append(feedbackButton(options.secondaryLabel, 'feedback-secondary', () => finish(false)));
    footer.append(feedbackButton(options.primaryLabel || 'Got it', 'feedback-primary', () => finish(true)));
    dialog.append(header, feedbackHeading(options.title || 'Your schedule', options.message || '', QCU_FEEDBACK_ICONS[variant], 'qcu-dialog-title'), footer);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); }
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll('button')].filter(el => !el.disabled);
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }, true);
    let backdropStart = false;
    dialog.addEventListener('pointerdown', event => { backdropStart = event.target === dialog && outside(event); });
    const outside = event => { const rect = dialog.getBoundingClientRect(); return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; };
    dialog.addEventListener('click', event => { if (backdropStart && event.target === dialog && outside(event)) finish(false); backdropStart = false; });
    document.body.append(dialog); iconify(); dialog.showModal();
    // Destructive confirmations initially focus the safe action.
    (footer.querySelector('.feedback-secondary') || footer.querySelector('button')).focus();
  });
  const result = feedbackDialogQueue.then(show);
  feedbackDialogQueue = result.catch(() => false);
  return result;
}
window.qcuDialog = qcuDialog;

function prepareStudentModal(content, { label, description, icon, close }) {
  const modal = content.closest('.modal-backdrop');
  clearTimeout(modal._closeTimer); modal.classList.remove('is-closing');
  modal.inert = false;
  modal._returnFocus = document.activeElement;
  content.dataset.feedbackState = 'info'; content.classList.add('feedback-editor');
  const oldHeading = content.querySelector('.modal-title');
  const title = oldHeading?.textContent || label;
  content.querySelector('.modal-head')?.remove(); content.querySelector('.modal-drag-handle')?.remove();
  const header = document.createElement('div'); header.className = 'feedback-header';
  const type = document.createElement('span'); type.textContent = label;
  const button = feedbackClose(close);
  button.setAttribute('aria-label', 'Close');
  // Retain the established close selector for integrations and keyboard tests.
  button.setAttribute(modal.id === 'crud-modal' ? 'data-close-crud-modal' : modal.id === 'task-modal' ? 'data-close-task-modal' : modal.id === 'note-modal' ? 'data-close-note-modal' : 'data-close-modal', '');
  header.append(type, button); content.prepend(header);
  const inner = content.querySelector('.modal-inner');
  inner.prepend(feedbackHeading(title, description, icon, modal.id + '-title'));
  modal.setAttribute('aria-labelledby', modal.id + '-title');
  modal.setAttribute('aria-describedby', modal.id + '-title-description');
  const submit = inner.querySelector('.task-form > .action-button');
  if (submit) {
    const actions = document.createElement('div'); actions.className = 'feedback-actions';
    actions.append(feedbackButton('Cancel', 'feedback-secondary', close), submit);
    submit.classList.add('feedback-primary');
    inner.querySelector('.task-form').append(actions);
  }
  modal._feedbackClose = close;
  if (!modal._feedbackBound && modal.id !== 'crud-modal') {
    modal._feedbackBound = true;
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); modal._feedbackClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll('button, input, select, textarea, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }
}
function closeStudentModal(id) {
  const modal = document.getElementById(id);
  if (!modal?.classList.contains('open')) return;
  modal.classList.remove('open'); modal.classList.add('is-closing');
  modal.inert = true;
  modal._closeTimer = setTimeout(() => modal.classList.remove('is-closing'), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  if (!document.querySelector('.modal-backdrop.open')) document.body.classList.remove('modal-open');
  if (modal._returnFocus?.isConnected) modal._returnFocus.focus();
}

function qcuToast(key, message, opts = {}) {
  let wrap = document.getElementById('qcu-toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'qcu-toasts'; wrap.className = 'qcu-toast-wrap'; document.body.append(wrap); }
  let toast = document.getElementById('qcu-toast-' + key);
  if (!toast) { toast = document.createElement('div'); toast.id = 'qcu-toast-' + key; toast.className = 'qcu-toast'; wrap.append(toast); }
  clearTimeout(toast._timer); clearTimeout(toast._removeTimer); toast._removeTimer = null; toast._progress?.cancel(); toast.replaceChildren();
  const variant = feedbackState(opts.variant);
  toast.dataset.feedbackState = variant;
  toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite'); toast.setAttribute('aria-atomic', 'true');
  const icon = document.createElement('span'); icon.className = 'qcu-toast-icon-block'; icon.append(feedbackIcon(opts.icon || QCU_FEEDBACK_ICONS[variant], 'qcu-toast-icon'));
  const text = document.createElement('span'); text.className = 'qcu-toast-msg'; text.textContent = message;
  toast.append(icon, text);
  if (opts.onAction) toast.append(feedbackButton(opts.actionLabel || 'Refresh', 'qcu-toast-action', () => { qcuToastDismiss(key); opts.onAction(); }));
  const close = feedbackClose(() => qcuToastDismiss(key)); close.className = 'qcu-toast-close'; close.setAttribute('aria-label', 'Dismiss notification'); toast.append(close);
  const ttl = Math.max(0, Number(opts.duration ?? 9000) || 0);
  toast._remaining = ttl;
  const pause = () => {
    if (!toast._started) return;
    toast._remaining = Math.max(0, toast._remaining - (performance.now() - toast._started)); toast._started = 0;
    clearTimeout(toast._timer); toast._progress?.pause();
  };
  const resume = () => {
    if (!ttl || toast.matches(':hover') || toast.contains(document.activeElement) || toast._started || !toast.classList.contains('is-visible')) return;
    toast._started = performance.now(); toast._progress?.play(); toast._timer = setTimeout(() => qcuToastDismiss(key), toast._remaining);
  };
  toast._started = 0;
  toast.onpointerenter = pause; toast.onpointerleave = resume;
  toast._pause = pause; toast._resume = resume;
  if (!toast._focusBound) {
    toast._focusBound = true;
    toast.addEventListener('focusin', () => toast._pause());
    toast.addEventListener('focusout', () => requestAnimationFrame(() => toast._resume()));
  }
  if (ttl) {
    const progress = document.createElement('span'); progress.className = 'qcu-toast-progress'; progress.setAttribute('aria-hidden', 'true'); toast.append(progress);
    toast._progress = progress.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ttl, fill: 'forwards' }); toast._progress.pause();
  }
  requestAnimationFrame(() => { if (!toast.isConnected || toast._removeTimer) return; toast.classList.add('is-visible'); resume(); }); iconify();
}
function qcuToastDismiss(key) {
  const toast = document.getElementById('qcu-toast-' + key);
  if (!toast) return;
  clearTimeout(toast._timer); clearTimeout(toast._removeTimer); toast._progress?.cancel(); toast._started = 0;
  toast.classList.remove('is-visible');
  toast._removeTimer = setTimeout(() => toast.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
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
    if (key === 'dashboard' && window.QCUData) {
      const data = await (window.QCUStartup || window.QCUData.dashboard());
      window.QCUStartup = null;
      loadErrors.delete(key);
      loadNotice(key, '');
      return data;
    }
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
    if (key === 'dashboard') window.QCUStartup = null;
    if (error.status === 401 || error.status === 403) {
      window.QCUData?.invalidate('access');
      if (typeof state !== 'undefined' && state.dashboard) hidePrivateContent();
    }
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

let _tasksFetchEpoch = -1;
async function fetchTasksFromApi() {
  const version = window.QCUData?.epoch || 0;
  if (_tasksFetching && _tasksFetchEpoch === version) return _tasksFetching;
  _tasksFetchEpoch = version;
  const work = (async () => {
    try {
      const d = await readWithFeedback('/api/v1/tasks', 'tasks', async () => { await fetchTasksFromApi(); renderTasks(); }, _tasksCache !== null);
      if (version !== (window.QCUData?.epoch || 0)) return _tasksCache || [];
      _tasksCache = Array.isArray(d.data) ? d.data : [];
      return _tasksCache;
    } catch { return _tasksCache || []; }
  })();
  _tasksFetching = work;
  try { return await work; }
  finally { if (_tasksFetching === work) _tasksFetching = false; }
}

async function loadTasks() {
  return await fetchTasksFromApi();
}

async function addTask(data) {
  try {
    const r = await mutationFetch("/api/v1/tasks", {
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
    const r = await mutationFetch(`/api/v1/tasks/${id}`, {
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
    const r = await mutationFetch(`/api/v1/tasks/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { await fetchTasksFromApi(); }
  } catch {}
}

async function toggleTask(id) {
  try {
    const tasks = _tasksCache || await fetchTasksFromApi();
    const task = tasks.find(t => (t.taskId || t.id) === id);
    if (!task) return;
    const newStatus = task.status === "COMPLETED" ? "OPEN" : "COMPLETED";
    const r = await mutationFetch(`/api/v1/tasks/${id}`, {
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

  let tasks = [...(_tasksCache || [])];
  if (workspaceCategory.task !== 'all') tasks = tasks.filter(t => courseVisual(t.subjectCode || t.subject || '', t.subjectName || '').id === workspaceCategory.task);

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
  const deadline = `<span class="task-meta"><i data-lucide="calendar" aria-hidden="true"></i>${t.dueDate ? esc(formatDateLabel(t.dueDate)) : 'No deadline set'}</span>`;
  const subject = t.subjectCode
    ? `<span class="study-subject-name">${esc(t.subjectName || subjectDisplayName(t.subjectCode))}</span>`
    : "";
  const priority = t.priority ? priorityBadge(t.priority.toLowerCase()) : "";
  const accent = t.priority ? (PRIORITY_META[t.priority.toLowerCase()]?.accent || "") : "";
  const taskId = t.taskId || t.id;

  return `
    <article class="task-card${doneClass}${priorityClass}" data-task-id="${esc(taskId)}"${accent ? ` style="--task-accent:${accent}"` : ""}>
      ${courseIconMarkup(t.subjectCode || t.subject || '', t.subjectName || '')}
      <div class="task-card-content">
        <div class="task-card-header">
          <h3 class="task-card-title${done ? " done" : ""}">${esc(t.title || "Untitled task")}</h3>
          <div class="task-card-actions">
            <button class="task-check-btn${done ? " checked" : ""}" data-action="toggle" data-id="${esc(taskId)}" aria-label="${done ? 'Mark pending' : 'Mark complete'}" aria-pressed="${done}"><i data-lucide="check" aria-hidden="true"></i></button>
            <button class="icon-btn" data-action="edit" data-id="${esc(taskId)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button class="icon-btn icon-btn--danger" data-action="delete" data-id="${esc(taskId)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        ${subject}
        ${t.description ? `<p class="task-card-desc">${esc(t.description)}</p>` : ""}
        <div class="task-card-footer">
          ${deadline}
          ${studyMeetingMarkup(t)}
          <span class="study-status ${done ? 'is-done' : 'is-pending'}">${done ? 'Completed' : 'Pending'}</span>
          ${priority}
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
  renderWorkspaceCategories('task', _tasksCache || []);
  setText('task-count', `${tasks.length} shown · ${(_tasksCache || []).filter(task => task.status !== 'COMPLETED').length} pending`);
  const hasFilters = (document.getElementById("task-search")?.value || "") ||
                     (document.getElementById("task-filter-status")?.value || "all") !== "all" ||
                     (document.getElementById("task-filter-subject")?.value || "all") !== "all" || workspaceCategory.task !== 'all';
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

  prepareStudentModal(content, { label: 'Task details', description: 'Keep your coursework and deadlines in one place.', icon: 'clipboard-list', close: closeTaskModal });
  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
  content.querySelector("input, .feedback-close")?.focus();

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
  closeStudentModal("task-modal");
}

/* ── Notes (API-backed) ──────────────────────────────── */
let _notesCache = null;
let _notesFetching = false;

let _notesFetchEpoch = -1;
async function fetchNotesFromApi() {
  const version = window.QCUData?.epoch || 0;
  if (_notesFetching && _notesFetchEpoch === version) return _notesFetching;
  _notesFetchEpoch = version;
  const work = (async () => {
    try {
      const d = await readWithFeedback('/api/v1/notes', 'notes', async () => { await fetchNotesFromApi(); renderNotes(); }, _notesCache !== null);
      if (version !== (window.QCUData?.epoch || 0)) return _notesCache || [];
      _notesCache = Array.isArray(d.data) ? d.data : [];
      return _notesCache;
    } catch { return _notesCache || []; }
  })();
  _notesFetching = work;
  try { return await work; }
  finally { if (_notesFetching === work) _notesFetching = false; }
}

async function loadNotes() {
  return await fetchNotesFromApi();
}

async function addNote(data) {
  try {
    const r = await mutationFetch("/api/v1/notes", {
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
    const r = await mutationFetch(`/api/v1/notes/${id}`, {
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
    const r = await mutationFetch(`/api/v1/notes/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { await fetchNotesFromApi(); }
  } catch {}
}

function filteredNotes() {
  const search = (document.getElementById("note-search")?.value || "").toLowerCase();
  const subject = document.getElementById("note-filter-subject")?.value || "all";
  const sort = document.getElementById("note-sort")?.value || "newest";

  let notes = [...(_notesCache || [])];
  if (workspaceCategory.note !== 'all') notes = notes.filter(n => courseVisual(n.subjectCode || n.subject || '', n.subjectName || '').id === workspaceCategory.note);

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
  const subject = n.subjectCode
    ? `<span class="study-subject-name">${esc(n.subjectName || subjectDisplayName(n.subjectCode))}</span>`
    : "";
  const date = `<span class="task-meta"><i data-lucide="clock" aria-hidden="true"></i>${n.updatedAt || n.createdAt ? esc(formatDateLabel(n.updatedAt || n.createdAt, true)) : 'Date not set'}</span>`;
  const bodyPreview = (n.body || "").length > 140 ? (n.body || "").slice(0, 140) + "…" : (n.body || "");
  const noteId = n.noteId || n.id;

  return `
    <article class="note-card" data-note-id="${esc(noteId)}">
      ${courseIconMarkup(n.subjectCode || n.subject || '', n.subjectName || '')}
      <div class="note-card-inner">
        <div class="note-card-header">
          <h3 class="note-card-title">${esc(n.title || "Untitled note")}</h3>
          <div class="task-card-actions">
            <button class="icon-btn" data-action="edit-note" data-id="${esc(noteId)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button class="icon-btn icon-btn--danger" data-action="delete-note" data-id="${esc(noteId)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        ${subject}
        ${bodyPreview ? `<p class="note-card-body">${esc(bodyPreview)}</p>` : ""}
        <div class="note-card-footer">
          ${date}
          ${studyMeetingMarkup(n)}
          <span class="study-status is-note">Saved note</span>
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
  renderWorkspaceCategories('note', _notesCache || []);
  setText('note-count', `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} shown`);
  const hasFilters = (document.getElementById("note-search")?.value || "") ||
                     (document.getElementById("note-filter-subject")?.value || "all") !== "all" || workspaceCategory.note !== 'all';
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

  prepareStudentModal(content, { label: 'Note details', description: 'Save your ideas and study notes for later.', icon: 'notebook-pen', close: closeNoteModal });
  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
  content.querySelector("input, .feedback-close")?.focus();

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
  closeStudentModal("note-modal");
}

/* ── Tick ────────────────────────────────────────────── */
let lastTickKey = '', lastTickSchedule, lastTickTasks, lastTickNotes;
const liveTimeFormatter = new Intl.DateTimeFormat([], { timeZone: QCU_TIME.zone, hour: 'numeric', minute: '2-digit', hour12: true });
function tick(force = false) {
  if (document.hidden) return;
  updateClock();
  const now = new Date(), minute = minutesNow(now), today = QCU_TIME.weekday(now);
  const boundaries = state.schedule.filter(item => item.day === today)
    .map(item => `${minute >= parseMinutes(item.start)}:${minute >= parseMinutes(item.end)}`).join(',');
  const key = QCU_TIME.dateLabel(now) + ':' + Math.floor(minute / 60) + ':' + boundaries;
  const scheduleChanged = force || key !== lastTickKey || lastTickSchedule !== state.schedule;
  const tasksChanged = force || key !== lastTickKey || lastTickTasks !== _tasksCache;
  const notesChanged = force || key !== lastTickKey || lastTickNotes !== _notesCache;
  if (page === 'home') {
    if (scheduleChanged) renderHome();
    else if (tasksChanged || notesChanged) renderTasksNotesColumn();
    document.querySelectorAll('.home-today-card[data-schedule-index]').forEach(card => {
      const item = state.schedule[Number(card.dataset.scheduleIndex)];
      if (!item) return;
      if (item.day !== today || homeSelectedDate !== homeDateKey(homeCalendarDate(now))) return;
      const timing = todayTiming(item, homeClassStatus(item, now), now);
      const live = card.querySelector('.home-today-live');
      if (live && live.textContent !== timing.live) live.textContent = timing.live;
      const progress = card.querySelector('.home-today-progress span');
      if (progress && timing.pct !== null) progress.style.width = timing.pct.toFixed(1) + '%';
    });
    const marker = document.querySelector('.home-today-now-label');
    const label = 'Now · ' + liveTimeFormatter.format(now);
    if (marker && marker.textContent !== label) marker.textContent = label;
  }
  if (page === 'schedule' && scheduleChanged) renderSchedule();
  if (page === 'settings') renderSettings();
  if (['tasks', 'workspace'].includes(page) && tasksChanged) renderTasks();
  if (['notes', 'workspace'].includes(page) && notesChanged) renderNotes();
  lastTickKey = key; lastTickSchedule = state.schedule; lastTickTasks = _tasksCache; lastTickNotes = _notesCache;
  // campus-eta page uses its own loop in eta.js
}

/* ── Schedule CRUD API ─────────────────────────────── */
function mutationFetch(url, options) {
  return window.QCUData ? window.QCUData.mutate(url, options) : fetch(url, options);
}

async function fetchScheduleFromApi() {
  return readWithFeedback('/api/v1/schedule', 'schedule', reloadSchedule, state.schedule.length > 0);
}

async function createScheduleEntry(payload) {
  const resp = await mutationFetch("/api/v1/schedule/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return await resp.json();
}

async function updateScheduleEntry(entryId, payload) {
  const resp = await mutationFetch(`/api/v1/schedule/entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return await resp.json();
}

async function deleteScheduleEntryApi(entryId) {
  const resp = await mutationFetch(`/api/v1/schedule/entries/${entryId}`, {
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
    instructor: item.instructor ?? item.instructorName ?? "",
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

function openCrudModal(entry = null) {
  _crudEditingEntry = entry;
  const modal = document.getElementById("crud-modal");
  const content = document.getElementById("crud-modal-content");
  if (!modal || !content) return;

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

        <div class="crud-field">
          <label for="crud-professor">Professor <span class="crud-optional">(optional)</span></label>
          <input type="text" id="crud-professor" maxlength="120" placeholder="e.g. Prof. Maria Reyes" value="${esc(entry?.instructor || '')}" autocomplete="off" aria-describedby="crud-professor-hint">
          <p id="crud-professor-hint" class="crud-field-hint">Saved for this class meeting.</p>
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

        <p id="crud-error" role="alert" class="crud-error" style="display:none;"></p>
      </form>
    </div>`;

  prepareStudentModal(content, { label: 'Class schedule', description: isEdit ? 'Update the time, location, or professor for this class.' : 'Choose a subject and set its weekly class meeting.', icon: 'calendar-plus', close: closeCrudModal });
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
    const professorEl = field("crud-professor");

    [subjectEl, dayEl, startEl, endEl, professorEl].forEach(el => el?.removeAttribute("aria-invalid"));

    const subjectVal = subjectEl?.value || "";
    const dayVal = dayEl?.value || "";
    const startVal = startEl?.value || "";
    const endVal = endEl?.value || "";
    const modalityVal = modalityEl?.value || "ONSITE";
    const buildingVal = buildingEl?.value || "";
    const roomVal = roomEl?.value || "";
    const locationVal = locationEl?.value || "";
    const professorVal = (professorEl?.value || "").trim();
    if (professorVal.length > 120) fail(professorEl, "Professor name must be at most 120 characters.");

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
    if (existingEntry?.entryId ? professorVal !== (existingEntry.instructor || '').trim() : professorVal !== '') {
      payload.instructorName = professorVal;
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

    qcuToast("class-save", existingEntry ? "Class changes saved." : "Class added to your schedule.", { variant: "success" });
    // Success — close modal, reload schedule
    closeCrudModal();

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

const pendingClassDeletions = new Set();
async function confirmDeleteEntry(entry) {
  if (!entry?.entryId || pendingClassDeletions.has(entry.entryId)) return;
  pendingClassDeletions.add(entry.entryId);
  try {
  const confirmed = await qcuDialog({
    variant: 'error', label: 'Delete class', title: 'Remove this class?',
    message: `Delete "${entry.subject || entry.course || "this class"}" on ${entry.day}? This will remove the meeting from your schedule.`,
    primaryLabel: 'Delete class', secondaryLabel: 'Keep class'
  });
  if (!confirmed) return;

  await window.QCULoading.action(document.getElementById("crud-delete-btn"), () => performDeleteEntry(entry));
  } finally {
    pendingClassDeletions.delete(entry.entryId);
  }
}

async function performDeleteEntry(entry) {
  const errorEl = document.getElementById("crud-error");
  if (errorEl) { errorEl.style.display = "none"; }

  try {
    const result = await deleteScheduleEntryApi(entry.entryId);
    if (!result?.ok) {
      throw new Error(result?.error || "Failed to delete entry.");
    }

    qcuToast("class-delete", "Class removed from your schedule.", { variant: "success" });
    // Close modal, reload
    closeCrudModal();

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
  _crudEditingEntry = null;
  const selectedId = scheduleSelectedEntry;
  scheduleSelectedEntry = null;
  if (page === 'schedule') {
    renderSchedule();
    if (selectedId) document.getElementById('crud-modal')._returnFocus = document.querySelector(`#schedule-rows button[data-entry-id="${CSS.escape(selectedId)}"]`) || document.getElementById('schedule-add-btn');
  }
  closeStudentModal("crud-modal");
}

/* ── Sign Out ────────────────────────────────────── */
window.signOut = function (button) {
  window.QCUGoogleConnection.disconnect();
  window.QCULoading.button(button, true);
  window.QCUData?.invalidate('logout');
  // GET /api/auth/logout does a 302 redirect that clears all cookies
  // reliably before landing on the login page.
  window.location.href = "/api/auth/logout";
};

/* ── Init ────────────────────────────────────────────── */
let dashboardRefresh = null;
function hidePrivateContent(message = 'Please sign in again to continue.') {
  window.QCUGoogleConnection.disconnect();
  document.getElementById('google-connection')?.close();
  state.dashboard = null;
  state.profile = null;
  if (page === 'settings') renderSettings();
  state.schedule = [];
  state.buildings = [];
  state.academic = null;
  state.enrollment = null;
  _tasksCache = null; _notesCache = null;
  classroomCache = { at: 0, data: null };
  document.querySelector('.app-shell')?.setAttribute('hidden', '');
  let notice = document.getElementById('session-recheck');
  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'session-recheck';
    notice.className = 'load-notice';
    document.body.prepend(notice);
  }
  notice.replaceChildren(document.createTextNode(message + ' '));
  const link = document.createElement('a');
  link.href = '/'; link.textContent = 'Continue';
  notice.appendChild(link);
}
async function refreshDashboard(force = false) {
  if (!window.QCUData || dashboardRefresh) return dashboardRefresh;
  const work = (async () => {
    try {
      const data = await window.QCUData.dashboard({ force });
      if (!Array.isArray(data.entries) || data.status !== 'OK') {
        hidePrivateContent();
        if (data.routing === 'admin') location.replace('/admin.html');
        else if (data.routing === 'onboarding') location.replace('/onboarding.html');
        return;
      }
      applyDashboard(data);
      loadNotice('dashboard', '');
      tick(true);
      if (page === 'buildings') renderBuildings();
    } catch (error) {
      if (document.querySelector('.app-shell')?.hasAttribute('hidden') && error.code !== 'SUPERSEDED') hidePrivateContent('We could not check your account. Reconnect and try again.');
      if (error.code !== 'SUPERSEDED') loadNotice('dashboard', 'Refresh failed. Showing your last loaded content. ' + error.message, () => refreshDashboard(true));
    }
  })();
  dashboardRefresh = work;
  try { return await work; }
  finally { if (dashboardRefresh === work) dashboardRefresh = null; }
}
window.addEventListener('qcu-dashboard-updated', event => {
  const data = event.detail;
  if (data.status !== 'OK' || !Array.isArray(data.entries)) { hidePrivateContent(); return; }
  applyDashboard(data);
  tick(true);
});
window.addEventListener('qcu-dashboard-refresh-failed', event => {
  loadNotice('dashboard', 'Refresh failed. Showing your last loaded content. ' + event.detail.message, () => refreshDashboard(true));
});
let remoteRefreshTimer;
window.addEventListener('qcu-data-invalidated', event => {
  window.QCUStartup = null;
  if (['logout', 'access'].includes(event.detail.reason)) { hidePrivateContent(); return; }
  clearTimeout(remoteRefreshTimer);
  remoteRefreshTimer = setTimeout(() => {
    dashboardRefresh = null;
    if (!document.hidden && state.dashboard) refreshDashboard(true);
  }, 100);
});
window.addEventListener('pageshow', event => {
  // BFCache can restore a page whose cookies now belong to another account.
  if (event.persisted) location.reload();
});
window.addEventListener('pagehide', () => {
  document.querySelector('.app-shell')?.setAttribute('hidden', '');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.dashboard) {
    const shell = document.querySelector('.app-shell');
    shell?.setAttribute('hidden', '');
    refreshDashboard().finally(() => {
      if (state.dashboard) shell?.removeAttribute('hidden');
    });
    tick();
  }
});

function applyDashboard(data) {
  state.error = null;
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
  if (data.cacheInfo?.cached) {
    const time = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(data.cacheInfo.at));
    qcuToast('freshness', 'Last updated at ' + time + '.', { actionLabel: 'Refresh', onAction: () => refreshDashboard(true), icon: 'clock-3' });
  } else qcuToastDismiss('freshness');
}

async function init() {
  if (window.__QCU_INIT_STARTED) return;
  window.__QCU_INIT_STARTED = true;
  if (page === 'home' && ['finishing', 'denied', 'failed', 'admin_denied', 'admin_expired', 'backend_unavailable'].includes(new URLSearchParams(location.search).get('auth'))) return;

  // HTML contains responsive placeholders until the profile and data are ready.
  renderShell();
  iconify();

  // Fetch authenticated dashboard data (single endpoint)
  try {
    const data = await readWithFeedback('/api/v1/dashboard', 'dashboard', () => location.reload(), !!state.dashboard);

    if (data.routing === 'admin') { window.location.replace('/admin.html'); return; }
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

    if (data.status === "DEACTIVATED" || data.status === 'FORBIDDEN') {
      loadNotice('dashboard', 'Your account is deactivated. Contact your administrator.');
      state.loading = false;
      renderShell();
      tick();
      return;
    }

    if (data.status !== 'OK') throw new Error('Dashboard data is unavailable.');
    if (data.status === "OK") {
      applyDashboard(data);
      if (navigator.onLine) window.QCUGoogleConnection.refresh().catch(() => {});
      if (page === 'settings') window.QCUGoogleModal?.init();
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
  ["building-modal", "day-modal", "task-modal", "note-modal"].forEach(id => {
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
    keepHomeDayVisible(button);
  });

  document.getElementById('schedule-edit-btn')?.addEventListener('click', event => {
    scheduleEditing = !scheduleEditing;
    const button = event.currentTarget;
    button.setAttribute('aria-pressed', String(scheduleEditing));
    button.querySelector('span').textContent = scheduleEditing ? 'Done editing' : 'Edit schedule';
    renderSchedule();
  });

  // "Today" selects the campus weekday and reveals its date pill.
  document.getElementById("schedule-today-btn")?.addEventListener("click", () => {
    const today = QCU_TIME.weekday();
    const target = [...document.querySelectorAll("[data-schedule-day]")]
      .find(day => normalizeDayName(day.dataset.scheduleDay) === normalizeDayName(today));
    if (!target) return;
    target.click();
    keepHomeDayVisible(target);
  });

  /* ── Schedule Edit button delegation ─────────────── */
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-action='edit-entry']");
    if (!btn) return;
    const entryId = btn.dataset.entryId;
    if (!entryId) return;
    const entry = state.schedule.find(s => s.entryId === entryId);
    if (entry) {
      scheduleSelectedEntry = entryId;
      renderSchedule();
      document.querySelector(`#schedule-rows [data-entry-id="${CSS.escape(entryId)}"][data-action="edit-entry"]`)?.focus();
      openCrudModal(entry);
    }
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

  if (page === "workspace") {
    const workspace = document.querySelector("[data-page=workspace]");
    const buttons = workspace?.querySelectorAll("[data-workspace-view]") || [];
    const panels = workspace?.querySelectorAll("[data-workspace-panel]") || [];
    workspace?.addEventListener('click', event => {
      const category = event.target.closest('[data-study-category]');
      if (!category) return;
      const kind = category.dataset.studyKind;
      workspaceCategory[kind] = category.dataset.studyCategory;
      const subject = document.getElementById(`${kind}-filter-subject`);
      if (subject) subject.value = 'all';
      kind === 'task' ? renderTasks() : renderNotes();
      document.querySelector(`[data-study-kind="${kind}"][data-study-category="${workspaceCategory[kind]}"]`)?.focus({ preventScroll: true });
    });
    const setWorkspaceView = async (view, updateUrl = true) => {
      workspaceView = view;
      const addButton = document.querySelector("#bottom-nav [data-workspace-add]");
      const kind = view === "notes" ? "note" : "task";
      addButton?.setAttribute("aria-label", `Add ${kind}`);
      addButton?.setAttribute("title", `Add ${kind}`);
      addButton?.setAttribute("aria-controls", `${kind}-modal`);
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
    if (document.querySelector(".qcu-dialog[open]")) return;
    if (e.key === "Escape") { closeModal(); closeTaskModal(); closeNoteModal(); closeCrudModal(); }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:" && location.hostname !== "127.0.0.1" && location.hostname !== "localhost") {
    // Remember whether a worker was already in control BEFORE we register.
    // On a first-ever visit there is no controller, so the controllerchange
    // that clients.claim() fires is expected and must NOT trigger a reload.
    var hadController = !!navigator.serviceWorker.controller;

    // Registration already checks for an updated script. Avoid a second
    // overlapping update job; always bypass HTTP cache for the worker itself.
    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).catch(function () {});

    // Offer the new release without interrupting a task/note or class edit.
    var swReloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (swReloaded || !hadController) return;
      swReloaded = true;
      loadNotice('update', 'An update is ready. Refresh when you have finished editing.', () => window.location.reload(), 'Refresh');
    });
  }

  iconify();
  if (!window.__QCU_TICK_TIMER) window.__QCU_TICK_TIMER = setInterval(tick, 1000);
}

init();
