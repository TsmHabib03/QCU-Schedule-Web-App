/* ============================================================
   QCU Student Portal — app.js
   All UI templates and rendering logic.
   Light mode only. No dark mode.
   ============================================================ */

const QCU_DEFAULTS = {
  schedule: [
    { day: "Monday",    start: "11:00", end: "14:00", subject: "Mathematics in the Modern World",       course: "MATH 1", building: "New Academic Building",                       code: "IL", room: "IL502A",    floor: "5th Floor",    units: 3 },
    { day: "Monday",    start: "15:00", end: "17:00", subject: "Fundamentals of Programming (Lecture)", course: "CC102",  building: "New Academic Building",                       code: "IL", room: "IL601A",    floor: "6th Floor",    units: 3 },
    { day: "Monday",    start: "18:00", end: "21:00", subject: "Fundamentals of Programming (Laboratory)", course: "CC102", building: "Bautista Building",                     code: "IK", room: "IK603 F1", floor: "6th Floor",    units: 0 },
    { day: "Tuesday",   noClasses: true },
    { day: "Wednesday", start: "10:00", end: "13:00", subject: "National Service Training Program 1",   course: "NSTP 1", building: "Belmonte Hall",                               code: "SB", room: "SB OG",     floor: "Ground Floor", units: 3 },
    { day: "Wednesday", start: "14:30", end: "17:30", subject: "Introduction to Computing (Laboratory)",course: "CC101",  building: "Bautista Building",                     code: "IK", room: "IK603 F1",  floor: "6th Floor",    units: 0 },
    { day: "Wednesday", start: "19:00", end: "21:00", subject: "Introduction to Computing (Lecture)",   course: "CC101",  building: "New Academic Building",                       code: "IL", room: "IL601A",    floor: "6th Floor",    units: 3 },
    { day: "Thursday",  start: "08:00", end: "11:00", subject: "People and the Earth's Ecosystems",     course: "GEE 2",  building: "New Academic Building",                       code: "IL", room: "IL606A",    floor: "6th Floor",    units: 3 },
    { day: "Thursday",  start: "14:30", end: "17:30", subject: "Gender and Society",                    course: "GEE 1",  building: "New Academic Building",                       code: "IL", room: "IL606A",    floor: "6th Floor",    units: 3 },
    { day: "Friday",    start: "07:00", end: "10:00", subject: "College Algebra",                        course: "MATH 2", building: "New Academic Building",                       code: "IL", room: "IL502A",    floor: "5th Floor",    units: 3 },
    { day: "Friday",    start: "11:30", end: "13:30", subject: "Physical Fitness and Wellness",          course: "PE 1",   building: "Belmonte Hall",                               code: "SB", room: "SB OG",     floor: "Ground Floor", units: 2 }
  ],
  buildings: [
    { code: "IL", name: "New Academic Building",                    image: "New Academic building(1).jpg",   description: "Lecture rooms used for mathematics, programming lectures, computing, and general education courses.", rooms: ["IL502A","IL601A","IL606A"], floors: "5th–6th Floor" },
    { code: "IK", name: "Bautista Building",                      image: "QCU-BUILDING-1024x683-1.jpg",    description: "Laboratory building used for hands-on programming and computing classes.",                             rooms: ["IK603 F1"],              floors: "6th Floor" },
    { code: "SB", name: "Belmonte Hall",                            image: "Belmonte Building 2.jpg",        description: "Campus hall used for NSTP and physical wellness classes at the open ground area.",                     rooms: ["SB OG"],                   floors: "Ground Floor" },
  ]
};

const state = {
  schedule: [...QCU_DEFAULTS.schedule],
  buildings: [...QCU_DEFAULTS.buildings],
  settings: {
    notifications: localStorage.getItem("qcu-notifications") === "true"
  }
};

const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const page = document.body.dataset.page || "home";
const navPage = ["tasks", "notes"].includes(page) ? "workspace" : page;

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
  if (!v) return Number.POSITIVE_INFINITY;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

function minutesNow(date = new Date()) {
  return QCU_TIME.minutes(date);
}

function formatTime(v) {
  if (!v) return "—";
  const [h, m] = v.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDuration(totalSeconds) {
  if (totalSeconds <= 0) return "now";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

function countdownFor(item, now = new Date()) {
  if (!item) return "No class scheduled";
  const startDate = new Date(now);
  const endDate   = new Date(now);
  const [sh, sm] = item.start.split(":").map(Number);
  const [eh, em] = item.end.split(":").map(Number);
  startDate.setHours(sh, sm, 0, 0);
  endDate.setHours(eh, em, 0, 0);
  const status = getStatus(item, now);
  if (status === "current")  return `Ends in ${formatDuration((endDate - now) / 1000)}`;
  if (status === "finished") return "Finished";
  return `Starts in ${formatDuration((startDate - now) / 1000)}`;
}

function statusLabel(s) {
  return { current: "Current", next: "Next", finished: "Finished",
           upcoming: "Upcoming", inactive: "Inactive", "today-off": "No Classes" }[s] || "Upcoming";
}

function statusClass(s) {
  return { current: "status-current", next: "status-next",
           finished: "status-finished", "today-off": "status-off" }[s] || "";
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
  const b = buildingByCode(item.code);
  return b ? b.name : item.building;
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
  const navItems = [
    ["home",      "index.html",     "layout-dashboard", "Home"],
    ["campus-eta", "campus-eta.html", "bus",             "Bus"],

    ["workspace", "workspace.html", "clipboard-list",   "Tasks & Notes"],
    ["google",    "google.html",    "graduation-cap",   "Google"],
    ["settings",  "settings.html",  "settings",         "Settings"]
  ];

  const header = document.getElementById("app-header");
  if (header) {
    header.innerHTML = `
      <div class="header-inner">
        <a href="index.html" class="header-brand">
           <img class="brand-logo" src="assets/images/QCU college of computer studies logo.jpg" alt="QCU Logo">
          <div class="brand-text">
            <p id="greeting" class="brand-name">QCU Student Portal</p>
            <p class="brand-sub">BS Computer Science · San Bartolome</p>
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
        ${navItems.map(([key, href, icon, label]) => `
          <a class="nav-item ${navPage === key ? "active" : ""}"
             href="${href}" aria-label="${label}">
            <i data-lucide="${icon}"></i>
            <span>${label}</span>
          </a>`).join("")}
      </div>`;
  }
}

/* ── Class Card Template ─────────────────────────────── */
function cardTemplate(item) {
  if (item.noClasses) return emptyTemplate("No Classes Scheduled");
  const now    = new Date();
  const status = getStatus(item, now);
  const cd     = countdownFor(item, now);
  const bname  = buildingLabel(item);

  return `
    <article class="portal-card class-card ${status}-card">
      <div class="class-card-top">
        <span class="status-pill ${statusClass(status)}">${statusLabel(status)}</span>
        <span class="class-card-time">${formatTime(item.start)} – ${formatTime(item.end)}</span>
      </div>
      <div>
        <h3 class="class-card-subject">${item.subject}</h3>
        <p style="margin-top:4px; font-size:13px; font-weight:600; color:var(--muted);">${item.course} · ${bname}</p>
        <div style="display:flex; gap:16px; margin-top:12px; padding-top:12px; border-top:1px solid var(--divider);">
          <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Room</p><p style="font-size:13px; font-weight:700;">${item.room}</p></div>
          <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Floor</p><p style="font-size:13px; font-weight:700;">${item.floor}</p></div>
          <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Units</p><p style="font-size:13px; font-weight:700;">${item.units > 0 ? item.units : "Lab"}</p></div>
        </div>
        <p style="margin-top:12px; font-size:13px; font-weight:700; color:var(--blue);"><i data-lucide="timer" style="display:inline-block;width:14px;height:14px;vertical-align:-2px;margin-right:4px;stroke-width:2.2;"></i>${cd}</p>
      </div>
    </article>`;
}

/* ── Empty State ─────────────────────────────────────── */
function emptyTemplate(msg) {
  return `
    <div class="empty-state">
      <i data-lucide="calendar-x-2" class="empty-icon"></i>
      <p class="empty-text">${msg}</p>
    </div>`;
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
  const max = Math.max(1, ...days.map(d => counts[d] || 0));

  const headRow = days.map(d => `
    <div class="home-week-th">${d.slice(0, 3)}</div>`).join("");

  const bodyRow = days.map(d => {
    const count = counts[d] || 0;
    const pct = Math.round((count / max) * 100);
    const isToday = d === today;
    const isOff = count === 0;
    return `
      <button type="button" class="home-week-td${isToday ? " is-today" : ""}${isOff ? " is-off" : ""}"
        data-day="${d}" aria-label="View ${d}'s schedule">
        <span class="home-week-count">${count || "—"}</span>
        <span class="home-week-track"><span class="home-week-fill" style="width:${pct}%"></span></span>
        <span class="home-week-label">${isToday ? "Today" : count ? `${count} class${count > 1 ? "es" : ""}` : "Off"}</span>
      </button>`;
  }).join("");

  return `
    <div class="home-week-table">
      <div class="home-week-row home-week-head-row">${headRow}</div>
      <div class="home-week-row home-week-body-row">${bodyRow}</div>
    </div>`;
}

function todaySummaryTemplate(todaysClasses, now) {
  const remaining = todaysClasses.filter(x => getStatus(x, now) !== "finished").length;
  const statusText = !todaysClasses.length
    ? "No classes today"
    : remaining === 0
      ? "All finished for the day"
      : remaining === todaysClasses.length
        ? "Full day ahead"
        : `${remaining} still to go`;

  const totalBreak = todaysClasses.reduce((sum, x, i) => {
    const next = todaysClasses[i + 1];
    if (!next) return sum;
    const gap = parseMinutes(next.start) - parseMinutes(x.end);
    return sum + (gap >= BREAK_MIN ? gap : 0);
  }, 0);

  const breakText = totalBreak > 0
    ? `${formatGap(totalBreak)} of break time scheduled`
    : "No scheduled breaks";

  return `
    <article class="home-today-card home-today-summary">
      <span class="home-today-summary-label">Classes today</span>
      <p class="home-today-summary-count">${todaysClasses.length}</p>
      <p class="home-today-summary-sub">${statusText}</p>
      <p class="home-today-summary-break">${breakText}</p>
    </article>`;
}

function todayTileTemplate(item, opts) {
  const status = getStatus(item, new Date());
  const statusWord = { current: "In session", next: "Up next", finished: "Done", upcoming: "Scheduled" }[status] || statusLabel(status);
  const bname = buildingLabel(item);
  const feature = opts.feature ? " home-today-card--feature" : "";
  const stagger = opts.i !== undefined ? ` style="--i:${opts.i}"` : "";

  return `
    <article class="home-today-card ${status}-tile${feature}"${stagger}>
      <div class="home-today-rail">
        <span class="home-today-rail-time">${formatTime(item.start)}</span>
        <span class="home-today-rail-end">${formatTime(item.end)}</span>
        <span class="home-today-rail-rule"></span>
      </div>
      <div class="home-today-body">
        <div class="home-today-head">
          <span class="home-today-status">${statusWord}</span>
          <span class="home-today-course">${item.course}</span>
        </div>
        <h3 class="home-today-subject">${item.subject}</h3>
        <p class="home-today-building">${bname}</p>
        <div class="home-today-meta">
          <span><i data-lucide="map-pin"></i>${item.room}</span>
          <span><i data-lucide="layers"></i>${item.floor}</span>
        </div>
      </div>
    </article>`;
}

function breakTileTemplate(start, end, minutes, i) {
  return `
    <article class="home-break-tile" style="--i:${i || 0}">
      <div class="home-break-rail">
        <span>${formatTime(start)}</span>
        <span>${formatTime(end)}</span>
      </div>
      <div class="home-break-body">
        <span class="home-break-label"><i data-lucide="utensils"></i>Break time</span>
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

  if (status === "current") {
    const end = new Date(now);
    const [eh, em] = item.end.split(":").map(Number);
    end.setHours(eh, em, 0, 0);
    const remaining = Math.max(0, Math.floor((end - now) / 1000));
    const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
    const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");

    const [sh, sm] = item.start.split(":").map(Number);
    const totalMin = Math.max(1, (eh * 60 + em) - (sh * 60 + sm));
    const elapsedMin = Math.max(0, minutesNow(now) - (sh * 60 + sm));
    const pct = Math.min(100, (elapsedMin / totalMin) * 100);

    return `
      <div class="home-countdown-value">${hh}:${mm}:${ss}</div>
      <p class="home-countdown-label">until ${item.subject} ends</p>
      <div class="home-countdown-track"><span class="home-countdown-fill" style="width:${pct}%"></span></div>`;
  }

  if (status === "finished") {
    return `<div class="home-countdown-empty">Class finished</div>`;
  }

  const start = new Date(now);
  const [sh, sm] = item.start.split(":").map(Number);
  start.setHours(sh, sm, 0, 0);
  const remaining = Math.max(0, Math.floor((start - now) / 1000));
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
function renderHome() {
  const now = new Date();
  const today = QCU_TIME.weekday(now);
  const hour = Math.floor(QCU_TIME.minutes(now) / 60);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todaysClasses = state.schedule.filter(x => x.day === today && !x.noClasses);
  const { current, next } = getCurrentAndNext(now);
  const currentLabel = current ? "In session" : "No class right now";
  const nextLabel = next ? "Coming up next" : (todaysClasses.length ? "No more classes today" : "No classes today");

  setText("home-greeting", `${greeting}, Habib`);
  setText("hero-class-count", `${todaysClasses.length}`);
  setText("hero-today-date", QCU_TIME.dateLabel(now));

  const weekEl = document.getElementById("home-week-strip");
  if (weekEl) setInnerHTML(weekEl, weekStripTemplate(now));

  const grid = document.getElementById("today-grid");
  if (grid) {
    const feature = current || next;
    // Build today's timeline with break slots between classes
    const timeline = dayWithBreaks(today);
    let classIndex = 0;
    let breakIndex = 0;
    const tiles = timeline.map(entry => {
      if (entry.kind === "class") {
        const item = entry.item;
        const tile = todayTileTemplate(item, { feature: item === feature, i: classIndex });
        classIndex++;
        return tile;
      } else {
        const tile = breakTileTemplate(entry.start, entry.end, entry.minutes, breakIndex);
        breakIndex++;
        return tile;
      }
    });
    setInnerHTML(grid, [
      todaySummaryTemplate(todaysClasses, now),
      ...tiles
    ].join(""));
  }

  const countdownTarget = current || next;
  const countdownLabel = current ? "Ongoing class" : next ? "Next class starts in" : "No upcoming classes today";
  const activeNow = (current ? 1 : 0) + (next ? 1 : 0);
  setText("countdown-state-label", current ? "In session" : next ? "Upcoming" : "No classes left");

const trackerRoot = document.getElementById("home-tracker");
  const nowEl = document.getElementById("tracker-now");
  const nextEl = document.getElementById("tracker-next");

  // No classes at all today OR all classes finished → collapse into a single full-width empty state.
  if (!current && !next) {
    if (trackerRoot) {
      trackerRoot.classList.add("home-tracker--empty");
      const allDone = todaysClasses.length > 0;
      setInnerHTML(trackerRoot, `
        <div class="home-tracker-empty-panel">
          <div class="home-tracker-empty-icon-wrap">
            <span class="home-tracker-empty-icon"><i data-lucide="${allDone ? "check-circle-2" : "coffee"}"></i></span>
          </div>
          <div class="home-tracker-empty-text">
            <p class="home-tracker-empty-title">${allDone ? "No classes left" : "No classes today"}</p>
            <p class="home-tracker-empty-sub">${allDone ? "All classes are done for the day — enjoy your free time." : "You're all caught up — enjoy your free day."}</p>
          </div>
          <a class="home-tracker-empty-link" href="schedule.html">
            View full schedule
            <i data-lucide="arrow-right"></i>
          </a>
        </div>`);
    }
  } else {
    if (trackerRoot) trackerRoot.classList.remove("home-tracker--empty");
    if (nowEl) setInnerHTML(nowEl, trackerCellTemplate(current, "Now", "No class right now", "clock"));
    if (nextEl) setInnerHTML(nextEl, trackerCellTemplate(next, "Up next",
      todaysClasses.length ? "No more classes today" : "No classes today", "coffee"));
  }

  const countdownEl = document.getElementById("countdown-slot");
  if (countdownEl) countdownEl.innerHTML = countdownTemplate(countdownTarget, countdownLabel);

  const nowNext = document.getElementById("now-next-list");
  if (nowNext) {
    setInnerHTML(nowNext, `
      ${current ? spotlightTemplate(current, "") : ""}
      ${next && next !== current ? spotlightTemplate(next, "") : ""}
    `);
  }
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
  const hours = classes.reduce((sum, x) => sum + (parseMinutes(x.end) - parseMinutes(x.start)) / 60, 0);

  const rows = classes.length
    ? classes.map(x => {
        const bname = buildingLabel(x);
        return `
          <div class="day-modal-row">
            <div class="day-modal-time">
              <span class="day-modal-start">${formatTime(x.start)}</span>
              <span class="day-modal-to">→</span>
              <span class="day-modal-end">${formatTime(x.end)}</span>
            </div>
            <div class="day-modal-main">
              <span class="day-modal-subject">${x.subject}</span>
              <span class="day-modal-meta">${bname} · ${x.room} · ${x.floor}</span>
            </div>
            <span class="day-modal-course">${x.course}</span>
          </div>`;
      }).join("")
    : `<div class="day-modal-state">No classes scheduled on ${day}.</div>`;

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
          <span class="day-modal-stat-value">${Math.round(hours * 10) / 10}</span>
        </div>
      </div>

      <div class="day-modal-rows">${rows}</div>
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
  const b = buildingByCode(item.code);
  if (!b) return item.building;
  const name = b.name;
  if (name.includes("New Academic")) return "New Acad Bldg";
  if (name.includes("Bautista"))     return "Bautista Bldg";
  if (name.includes("Belmonte"))     return "Belmonte Hall";
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
  const now   = new Date();
  const today = QCU_TIME.weekday(now);

  // Build rows with break/free periods between classes on the same day
  const html = [];
  let lastDay = null;
  let lastEnd = null;

  orderedSchedule(now).forEach(item => {
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
      html.push(`
        <tr class="${rowClass}">
          <td data-label="Time" class="time-cell">
            <span class="day-abbr">${dayShort(item.day)}</span>
            <span class="time-range">${formatTime(item.start)} – ${formatTime(item.end)}</span>
          </td>
          <td data-label="Subject" class="subject-cell">${item.subject}</td>
          <td data-label="Code"><span class="code-cell">${item.course || "—"}</span></td>
          <td data-label="Location" class="location-cell">${loc}</td>
          <td data-label="Units"><span class="units-chip">${item.units > 0 ? item.units : "Lab"}</span></td>
          <td data-label="Status"><span class="status-dot status-dot-${status}" title="${statusLabel(status)}"></span></td>
        </tr>`);
      lastDay = item.day;
      lastEnd = parseMinutes(item.end);
    }
  });

  rows.innerHTML = html.join("");
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

/* ── Today Page ──────────────────────────────────────── */
function renderToday() {
  const list = document.getElementById("today-cards");
  if (!list) return;
  const today = QCU_TIME.weekday();
  const todaysClasses = state.schedule.filter(x => x.day === today);
  list.innerHTML = todaysClasses.length
    ? todaysClasses.map(cardTemplate).join("")
    : emptyTemplate("No classes scheduled today");
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
          <img src="assets/images/${item.image}" alt="${item.name}" loading="lazy">
          <span class="building-code-badge">${item.code}</span>
        </div>
        <div class="building-card-body">
          <p class="building-name">${item.name}</p>
          <p class="building-desc">${item.description}</p>
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
function renderSettings() {
  const notifToggle = document.getElementById("notifications-toggle");
  if (notifToggle) {
    notifToggle.checked = state.settings.notifications;
    notifToggle.addEventListener("change", async () => {
      if (notifToggle.checked && "Notification" in window) {
        const perm = await Notification.requestPermission();
        state.settings.notifications = perm === "granted";
        notifToggle.checked = state.settings.notifications;
      } else {
        state.settings.notifications = false;
      }
      localStorage.setItem("qcu-notifications", String(state.settings.notifications));
    });
  }

  document.getElementById("reset-data")?.addEventListener("click", () => {
    localStorage.removeItem("qcu-notifications");
    window.QCUGoogleIntegration?.clearLocalCache();
    location.reload();
  });
}

/* ── Clock ───────────────────────────────────────────── */
function updateClock() {
  const now  = new Date();
  const hour = Math.floor(QCU_TIME.minutes(now) / 60);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  setText("live-time", new Intl.DateTimeFormat([], { timeZone: QCU_TIME.zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(now));
  setText("live-day",  QCU_TIME.weekday());
  setText("live-date", QCU_TIME.dateLabel(now));
  setText("greeting",  `${greeting}, Habib`);
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
  const full = SUBJECT_NAMES[code];
  return full ? `${full} (${code})` : code;
}

function subjectColor(code) {
  return SUBJECT_COLORS[code] || { bg: "#EEF1F5", fg: "#5F6368", border: "#E5E7EB" };
}

function allSubjects() {
  const seen = new Set();
  QCU_DEFAULTS.schedule.forEach(x => {
    if (!x.noClasses && x.course) seen.add(x.course);
  });
  return [...seen].sort();
}

/* ── Task Manager ───────────────────────────────────── */
const TASKS_KEY = "qcu-tasks";

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t && typeof t === "object").map(t => ({
      id: String(t.id || newTaskId()),
      title: String(t.title || "").slice(0, 300),
      description: String(t.description || "").slice(0, 4000),
      subject: String(t.subject || ""),
      priority: ["high", "medium", "low"].includes(t.priority) ? t.priority : "medium",
      deadline: /^\\d{4}-\\d{2}-\\d{2}$/.test(String(t.deadline || "")) ? String(t.deadline) : "",
      done: Boolean(t.done),
      createdAt: Number.isFinite(Number(t.createdAt)) ? Number(t.createdAt) : Date.now()
    }));
  } catch { return []; }
}

function saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function newTaskId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addTask(data) {
  const tasks = loadTasks();
  tasks.unshift({ id: newTaskId(), ...data, done: false, createdAt: Date.now() });
  saveTasks(tasks);
}

function updateTask(id, data) {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx !== -1) { Object.assign(tasks[idx], data); saveTasks(tasks); }
}

function deleteTask(id) {
  saveTasks(loadTasks().filter(t => t.id !== id));
}

function toggleTask(id) {
  const tasks = loadTasks();
  const t = tasks.find(x => x.id === id);
  if (t) { t.done = !t.done; saveTasks(tasks); }
}

const PRIORITY_META = {
  high:   { label: "High",   color: "#DC2626", bg: "#FEE2E2", border: "#FECACA", icon: "arrow-up" },
  medium: { label: "Medium", color: "#D97706", bg: "#FEF3C7", border: "#FDE68A", icon: "minus" },
  low:    { label: "Low",    color: "#059669", bg: "#D1FAE5", border: "#A7F3D0", icon: "arrow-down" }
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

  let tasks = loadTasks();

  if (search) {
    tasks = tasks.filter(t =>
      (t.title || "").toLowerCase().includes(search) ||
      (t.description || "").toLowerCase().includes(search)
    );
  }
  if (status === "pending") tasks = tasks.filter(t => !t.done);
  if (status === "done") tasks = tasks.filter(t => t.done);
  if (subject !== "all") tasks = tasks.filter(t => t.subject === subject);

  if (sort === "newest") tasks.sort((a, b) => b.createdAt - a.createdAt);
  if (sort === "oldest") tasks.sort((a, b) => a.createdAt - b.createdAt);
  if (sort === "deadline") tasks.sort((a, b) => (a.deadline || "zzz").localeCompare(b.deadline || "zzz"));
  if (sort === "priority") tasks.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    const aVal = a.priority != null ? (order[a.priority] ?? 3) : 3;
    const bVal = b.priority != null ? (order[b.priority] ?? 3) : 3;
    return aVal - bVal;
  });
  if (sort === "alpha") tasks.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return tasks;
}

function taskCardTemplate(t) {
  const doneClass = t.done ? " completed" : "";
  const priorityClass = t.priority ? ` task-card--priority-${t.priority}` : "";
  const sc = subjectColor(t.subject);
  const deadline = t.deadline ? `<span class="task-meta"><i data-lucide="calendar"></i>${t.deadline}</span>` : "";
  const subject = t.subject
    ? `<span class="subject-chip" style="background:${sc.bg};color:${sc.fg};border-color:${sc.border};">${subjectDisplayName(t.subject)}</span>`
    : "";
  const priority = t.priority ? priorityBadge(t.priority) : "";

  return `
    <article class="task-card${doneClass}${priorityClass}" data-task-id="${esc(t.id)}">
      <button class="task-check-btn${t.done ? " checked" : ""}" data-action="toggle" data-id="${esc(t.id)}" aria-label="Toggle done"></button>
      <div class="task-card-content">
        <div class="task-card-header">
          <h3 class="task-card-title${t.done ? " done" : ""}">${esc(t.title || "Untitled task")}</h3>
          <div class="task-card-actions">
            <button class="icon-btn" data-action="edit" data-id="${esc(t.id)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button class="icon-btn icon-btn--danger" data-action="delete" data-id="${esc(t.id)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
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

  const subjectSelect = document.getElementById("task-filter-subject");
  if (subjectSelect && subjectSelect.children.length <= 1) {
    allSubjects().forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = `${subjectFullName(s)} (${s})`;
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
  const subjectOptions = subjects.map(s =>
    `<option value="${s}" ${task && task.subject === s ? "selected" : ""}>${subjectDisplayName(s)}</option>`
  ).join("");
  const curPriority = (task && task.priority) || "medium";
  const priorityOptions = Object.entries(PRIORITY_META).map(([k, v]) =>
    `<option value="${k}" ${k === curPriority ? "selected" : ""}>${v.label}</option>`
  ).join("");

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
          <input type="date" id="tf-deadline" value="${isEdit && task.deadline ? task.deadline : ""}">
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

  document.getElementById("task-form").addEventListener("submit", e => {
    e.preventDefault();
    const data = {
      title: document.getElementById("tf-title").value.trim(),
      description: document.getElementById("tf-desc").value.trim(),
      subject: document.getElementById("tf-subject").value,
      priority: document.getElementById("tf-priority").value,
      deadline: document.getElementById("tf-deadline").value
    };
    if (!data.title) return;
    if (isEdit) updateTask(task.id, data);
    else addTask(data);
    closeTaskModal();
    renderTasks();
  });
}

function closeTaskModal() {
  const modal = document.getElementById("task-modal");
  if (modal) modal.classList.remove("open");
  document.body.classList.remove("modal-open");
}

/* ── Notes ──────────────────────────────────────────── */
const NOTES_KEY = "qcu-notes";

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(n => n && typeof n === "object").map(n => ({
      id: String(n.id || newNoteId()),
      title: String(n.title || "").slice(0, 300),
      subject: String(n.subject || ""),
      body: String(n.body || "").slice(0, 12000),
      createdAt: Number.isFinite(Number(n.createdAt)) ? Number(n.createdAt) : Date.now()
    }));
  } catch { return []; }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function newNoteId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addNote(data) {
  const notes = loadNotes();
  notes.unshift({ id: newNoteId(), ...data, createdAt: Date.now() });
  saveNotes(notes);
}

function updateNote(id, data) {
  const notes = loadNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx !== -1) { Object.assign(notes[idx], data); saveNotes(notes); }
}

function deleteNote(id) {
  saveNotes(loadNotes().filter(n => n.id !== id));
}

function filteredNotes() {
  const search = (document.getElementById("note-search")?.value || "").toLowerCase();
  const subject = document.getElementById("note-filter-subject")?.value || "all";
  const sort = document.getElementById("note-sort")?.value || "newest";

  let notes = loadNotes();

  if (search) {
    notes = notes.filter(n =>
      (n.title || "").toLowerCase().includes(search) ||
      (n.body || "").toLowerCase().includes(search)
    );
  }
  if (subject !== "all") notes = notes.filter(n => n.subject === subject);

  if (sort === "newest") notes.sort((a, b) => b.createdAt - a.createdAt);
  if (sort === "oldest") notes.sort((a, b) => a.createdAt - b.createdAt);
  if (sort === "alpha") notes.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return notes;
}

function noteCardTemplate(n) {
  const sc = subjectColor(n.subject);
  const subject = n.subject
    ? `<span class="subject-chip" style="background:${sc.bg};color:${sc.fg};border-color:${sc.border};">${subjectDisplayName(n.subject)}</span>`
    : "";
  const date = n.createdAt ? `<span class="task-meta"><i data-lucide="clock"></i>${QCU_TIME.dateLabel(new Date(n.createdAt), { month: "short", day: "numeric" })}</span>` : "";
  const bodyPreview = (n.body || "").length > 140 ? (n.body || "").slice(0, 140) + "…" : (n.body || "");

  return `
    <article class="note-card" data-note-id="${esc(n.id)}" style="border-left:3px solid ${sc.border || 'var(--blue)'};">
      <div class="note-card-inner">
        <div class="note-card-header">
          <h3 class="note-card-title">${esc(n.title || "Untitled note")}</h3>
          <div class="task-card-actions">
            <button class="icon-btn" data-action="edit-note" data-id="${esc(n.id)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button class="icon-btn icon-btn--danger" data-action="delete-note" data-id="${esc(n.id)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
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

  const subjectSelect = document.getElementById("note-filter-subject");
  if (subjectSelect && subjectSelect.children.length <= 1) {
    allSubjects().forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = `${subjectFullName(s)} (${s})`;
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
  const subjectOptions = subjects.map(s =>
    `<option value="${s}" ${note && note.subject === s ? "selected" : ""}>${subjectDisplayName(s)}</option>`
  ).join("");

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

  document.getElementById("note-form").addEventListener("submit", e => {
    e.preventDefault();
    const data = {
      title: document.getElementById("nf-title").value.trim(),
      subject: document.getElementById("nf-subject").value,
      body: document.getElementById("nf-body").value.trim()
    };
    if (!data.title) return;
    if (isEdit) updateNote(note.id, data);
    else addNote(data);
    closeNoteModal();
    renderNotes();
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
  if (page === "today")    renderToday();
  if (page === "tasks")    renderTasks();
  if (page === "notes")    renderNotes();
  if (page === "workspace") { renderTasks(); renderNotes(); }
  // campus-eta page uses its own loop in eta.js
}

/* ── Init ────────────────────────────────────────────── */
async function init() {
  if (window.__QCU_INIT_STARTED) return;
  window.__QCU_INIT_STARTED = true;
  state.schedule  = await loadJson("data/schedule.json",  QCU_DEFAULTS.schedule);
  state.buildings = await loadJson("data/buildings.json", QCU_DEFAULTS.buildings);

  renderShell();
  tick();

  if (page === "buildings") renderBuildings();
  if (page === "settings")  renderSettings();
  if (page === "google")    window.QCUGoogleIntegration?.init();

  /* ── Modal close handlers ─────────────────────────── */
  ["building-modal", "day-modal", "task-modal", "note-modal"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", e => {
        if (e.target.id === id || e.target.closest("[data-close-modal]") ||
            e.target.closest("[data-close-task-modal]") || e.target.closest("[data-close-note-modal]")) {
          closeModal();
          closeTaskModal();
          closeNoteModal();
        }
      });
    }
  });

  document.getElementById("home-week-strip")?.addEventListener("click", e => {
    const cell = e.target.closest("[data-day]");
    if (cell) openDayModal(cell.dataset.day);
  });

  /* ── Task page event listeners ────────────────────── */
  const taskList = document.getElementById("task-list");
  if (taskList) {
    taskList.addEventListener("click", e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "toggle") toggleTask(id);
      if (action === "edit") {
        const task = loadTasks().find(t => t.id === id);
        if (task) openTaskModal(task);
      }
      if (action === "delete") { deleteTask(id); }
      renderTasks();
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
    noteList.addEventListener("click", e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "edit-note") {
        const note = loadNotes().find(n => n.id === id);
        if (note) openNoteModal(note);
      }
      if (action === "delete-note") { deleteNote(id); renderNotes(); }
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
    const setWorkspaceView = (view, updateUrl = true) => {
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
    if (e.key === "Escape") { closeModal(); closeTaskModal(); closeNoteModal(); }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
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
