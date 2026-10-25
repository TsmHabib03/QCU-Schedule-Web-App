/* ============================================================
   QCU Student Portal — eta.js
   QCity Bus · Libreng Sakay (Route 4) information panel + map

   This page is deliberately SCHEDULE-BASED. There is no public
   real-time feed for QCity Bus, so nothing here estimates, predicts,
   or counts down to an arrival. Every value comes from
   data/qcity-bus.json, and any field the data marks unverified renders
   as an explicit "unavailable" state rather than a plausible guess.
   ============================================================ */

const QCU_COORDS = [121.0343, 14.7001]; // 673 Quirino Highway, San Bartolome, Novaliches
const BUS_DATA_URL = "data/qcity-bus.json";
const CORRIDOR_URL = "data/route4-corridor.json";

const DAY_KEYS = ["weekdays", "saturday", "sunday"];
const DAY_LABELS = { weekdays: "Weekdays", saturday: "Saturday", sunday: "Sunday" };

let map = null;
let busData = null;
let corridor = null;
let activeDay = "weekdays";
const routeMarkers = [];
let markerFrame = 0;
let mapLoadTimer;
let tripExpanded = false;
let activeStopIndex = -1;

/* ── Helpers ─────────────────────────────────────────────── */

function refreshIcons() {
  if (window.iconify) window.iconify();
  else if (window.lucide) window.lucide.createIcons();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/** "05:30" → "5:30 AM". Returns null for anything unparseable. */
function formatClock(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const suffix = hours < 12 ? "AM" : "PM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${match[2]} ${suffix}`;
}

/** Headway may be a single number or a [min, max] range. */
function formatHeadway(headway) {
  if (Array.isArray(headway) && headway.length === 2) {
    return `Every ${headway[0]}–${headway[1]} min`;
  }
  if (Number.isFinite(headway)) return `Every ${headway} min`;
  return null;
}

/** Maps the real weekday onto one of the three schedule tabs. */
function todayDayKey(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short" }).format(now);
  if (day === "Sun") return "sunday";
  if (day === "Sat") return "saturday";
  return "weekdays";
}

function dayOf(key) {
  return busData?.service?.[key] ?? null;
}

/* ── Boot ────────────────────────────────────────────────── */

async function initETA() {
  wireScheduleTabs();
  wireRouteDetails();

  const [dataResult, corridorResult] = await Promise.allSettled([
    fetch(BUS_DATA_URL, { cache: "no-cache", signal: AbortSignal.timeout(35000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    fetch(CORRIDOR_URL, { cache: "no-cache", signal: AbortSignal.timeout(35000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
  ]);

  if (dataResult.status === "fulfilled") {
    busData = dataResult.value;
  } else {
    console.warn("QCity Bus data unavailable:", dataResult.reason);
  }

  if (corridorResult.status === "fulfilled") {
    corridor = corridorResult.value;
  } else {
    console.warn("Route 4 corridor geometry unavailable:", corridorResult.reason);
  }

  activeDay = todayDayKey();
  renderRouteFacts();
  renderScheduleTabs();
  selectDay(activeDay, { animate: false, focus: false });
  renderAbout();
  renderSourceFooter();
  renderTripDetails();
  initMap();
  refreshIcons();
}

/* ── Route facts ─────────────────────────────────────────── */

/** Formats a weekday peak/off-peak pair, a flat headway, or nothing. */
function headwayText(entry) {
  if (!entry) return null;
  const peak = entry.headwayPeakMins;
  const offPeak = entry.headwayOffPeakMins;
  if (Number.isFinite(peak) && Number.isFinite(offPeak)) {
    return `Every ${peak} min peak · ${offPeak} min off-peak`;
  }
  return formatHeadway(entry.headwayMins ?? peak ?? offPeak);
}

/**
 * The only route fact that varies with the data file is frequency,
 * because it is the one QC does not always publish. When it is missing
 * the row says so rather than borrowing a number.
 */
function renderRouteFacts() {
  const cell = document.getElementById("bus-fact-frequency");
  if (!cell) return;

  const text = headwayText(dayOf("weekdays")?.directions?.[0]);
  if (text) {
    cell.textContent = text;
    cell.className = "bus-fact-v";
    return;
  }

  cell.textContent = "Not published";
  cell.className = "bus-fact-v bus-fact-v--unknown";
  cell.title = "Quezon City publishes operating hours for this route rather than a fixed interval.";
}

/* ── Schedule tabs ───────────────────────────────────────── */

function wireScheduleTabs() {
  const tabs = [...document.querySelectorAll(".bus-sched-tab")];

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectDay(tab.dataset.day, { focus: false }));
  });

  // Roving tabindex + arrow-key navigation, per the ARIA tabs pattern.
  document.querySelector(".bus-sched-tabs")?.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = tabs.findIndex((t) => t.dataset.day === activeDay);
    let next;
    if (step === "first") next = 0;
    else if (step === "last") next = tabs.length - 1;
    else next = (current + step + tabs.length) % tabs.length;
    selectDay(tabs[next].dataset.day, { focus: true });
  });
}

/** Tab sub-labels summarise each day before it is opened. */
function renderScheduleTabs() {
  DAY_KEYS.forEach((key) => {
    const meta = document.querySelector(`[data-day-meta="${key}"]`);
    if (!meta) return;
    const day = dayOf(key);

    if (!day) {
      meta.textContent = "No data";
      return;
    }
    if (day.operates === false) {
      meta.textContent = "No service";
      return;
    }
    if (Array.isArray(day.departures) && day.departures.length) {
      meta.textContent = `${day.departures.length} trips`;
      return;
    }

    // Widest service window across both directions.
    const times = (day.directions || []).flatMap((d) => [d.firstTrip, d.lastTrip]).filter(Boolean).sort();
    const first = formatClock(times[0]);
    const last = formatClock(times[times.length - 1]);
    meta.textContent = first && last ? `${first} – ${last}` : "Hours only";
  });
}

function selectDay(key, { animate = true, focus = true } = {}) {
  if (!DAY_KEYS.includes(key)) key = "weekdays";
  activeDay = key;

  document.querySelectorAll(".bus-sched-tab").forEach((tab) => {
    const isActive = tab.dataset.day === key;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive && focus) tab.focus();
  });

  const body = document.getElementById("bus-sched-body");
  if (!body) return;
  body.setAttribute("aria-labelledby", `bus-tab-${key}`);
  body.innerHTML = scheduleBodyHTML(key);
  renderTimelineStatus();

  // Restart the entrance animation on every day change.
  body.removeAttribute("data-enter");
  if (animate) {
    void body.offsetWidth;
    body.setAttribute("data-enter", "");
  }
  refreshIcons();
}

/* ── Schedule body ───────────────────────────────────────── */

function emptyStateHTML(icon, title, description) {
  return `
    <div class="bus-sched-empty">
      <i data-lucide="${esc(icon)}" aria-hidden="true"></i>
      <p class="bus-sched-empty-title">${esc(title)}</p>
      <p class="bus-sched-empty-desc">${esc(description)}</p>
    </div>`;
}

function setScheduleBadge(label, isKnown) {
  const badge = document.getElementById("bus-sched-badge");
  if (!badge) return;
  badge.textContent = label;
  badge.classList.toggle("bus-free-badge--muted", !isKnown);
}

const UNAVAILABLE = [
  "calendar-x",
  "Schedule unavailable",
  "Check the latest QCity Bus advisory for today's operating schedule."
];

/**
 * Three honest shapes, chosen by what the data actually contains:
 *   departures[] → a real per-trip timetable, if QC ever publishes one
 *   directions[] → operating window + interval per direction, which is
 *                  what the Route 4 Terms of Reference actually states
 *   neither      → unavailable
 */
function scheduleBodyHTML(key) {
  const day = dayOf(key);

  if (!day) {
    setScheduleBadge("Unavailable", false);
    return emptyStateHTML(...UNAVAILABLE);
  }

  if (day.operates === false) {
    setScheduleBadge("No service", false);
    return emptyStateHTML(
      "calendar-off",
      `No Route 4 service on ${DAY_LABELS[key]}`,
      day.note || "Quezon City lists no QCity Bus operations for this day."
    );
  }

  if (Array.isArray(day.departures) && day.departures.length) {
    setScheduleBadge("Timetable", true);
    return departureListHTML(day);
  }

  const directions = (day.directions || []).filter((d) => formatClock(d.firstTrip) && formatClock(d.lastTrip));
  if (directions.length) {
    setScheduleBadge("Service hours", true);
    return directionListHTML(directions);
  }

  setScheduleBadge("Unavailable", false);
  return emptyStateHTML(...UNAVAILABLE);
}

/**
 * Quezon City publishes a service window and an interval per direction
 * for Route 4, not clock times. Each direction gets one row: when the
 * first bus leaves, when the last one does, and how often between.
 * Interpolating departures inside that window would be invention.
 */
function directionListHTML(directions) {
  const rows = directions
    .map((direction, index) => {
      const headway = headwayText(direction);
      return `
        <li class="bus-sched-dirrow" style="--i:${index}">
          <p class="bus-sched-dirrow-label">${esc(direction.label)}</p>
          <div class="bus-sched-dirrow-times">
            <span class="bus-sched-dirrow-slot">
              <span class="bus-sched-dirrow-k">First</span>
              <span class="bus-sched-dirrow-v">${esc(formatClock(direction.firstTrip))}</span>
            </span>
            <span class="bus-sched-dirrow-rule" aria-hidden="true"></span>
            <span class="bus-sched-dirrow-slot">
              <span class="bus-sched-dirrow-k">Last</span>
              <span class="bus-sched-dirrow-v">${esc(formatClock(direction.lastTrip))}</span>
            </span>
          </div>
          ${headway ? `<p class="bus-sched-dirrow-headway">${esc(headway)}</p>` : ""}
          ${direction.note ? `<p class="bus-sched-dirrow-note">${esc(direction.note)}</p>` : ""}
        </li>`;
    })
    .join("");

  return `
    <p class="bus-sched-list-label">
      <span>Scheduled departure</span>
      <span class="bus-sched-list-count">${directions.length} directions</span>
    </p>
    <div class="bus-sched-scroll" tabindex="0" role="group" aria-label="Scheduled service hours by direction">
      <ul class="bus-sched-rows">${rows}</ul>
    </div>
    <p class="bus-sched-foot" style="margin-top:8px;">
      Quezon City publishes service hours and intervals for Route 4, not a per-trip timetable.
    </p>`;
}

/** Renders a real per-trip timetable if the data file ever carries one. */
function departureListHTML(day) {
  const rows = day.departures
    .map((entry, index) => {
      const time = formatClock(typeof entry === "string" ? entry : entry.time);
      if (!time) return "";
      const direction = typeof entry === "object" ? entry.direction : day.direction;
      return `
        <li class="bus-sched-row" style="--i:${index}">
          <span class="bus-sched-seq">${index + 1}</span>
          <span class="bus-sched-time">${esc(time)}</span>
          ${direction ? `<span class="bus-sched-dir">${esc(direction)}</span>` : ""}
        </li>`;
    })
    .join("");

  return `
    <p class="bus-sched-list-label">
      <span>Scheduled departure</span>
      <span class="bus-sched-list-count">${day.departures.length} trips</span>
    </p>
    <div class="bus-sched-scroll" tabindex="0" role="group" aria-label="Scheduled departure times">
      <ol class="bus-sched-rows">${rows}</ol>
    </div>`;
}

/* ── About card + source footer ──────────────────────────── */

function renderAbout() {
  const routeCount = document.getElementById("bus-about-routes");
  if (routeCount) {
    const total = busData?.program?.routeCount;
    routeCount.textContent = Number.isFinite(total)
      ? `${total} QCity Bus routes`
      : "Multiple QCity Bus routes";
  }

  // The free fare is not a promotion — it is written into a city ordinance.
  const fareNote = document.getElementById("bus-about-fare-note");
  const ordinance = busData?.program?.ordinance;
  if (fareNote && ordinance) {
    fareNote.textContent = `No fare, no beep card. Institutionalized by ${ordinance}.`;
  }

  // Wi-Fi is only claimed when the route's own requirements list it.
  const wifiItem = document.getElementById("bus-about-wifi");
  if (wifiItem && busData && busData.program?.amenities?.wifi !== true) {
    wifiItem.remove();
  }

  const link = document.getElementById("bus-official-link");
  const url = busData?.program?.officialUrl;
  if (link && url) link.href = url;
}

function renderSourceFooter() {
  const stamp = document.getElementById("bus-source-date");
  if (!stamp) return;
  const verified = busData?.meta?.lastVerified;
  if (!verified) {
    stamp.textContent = "date unknown";
    return;
  }
  stamp.dateTime = verified;
  const parsed = new Date(`${verified}T00:00:00`);
  stamp.textContent = Number.isNaN(parsed.getTime())
    ? verified
    : parsed.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

/* ── Map ─────────────────────────────────────────────────── */

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch (error) {
    return false;
  }
}

function showMapUnavailable(reason) {
  const wrapper = document.querySelector(".eta-map-wrapper");
  if (!wrapper || wrapper.querySelector(".map-unavailable")) return;
  const panel = document.createElement("div");
  panel.className = "map-unavailable";
  panel.innerHTML = `
    <i data-lucide="map-off" aria-hidden="true"></i>
    <p class="map-unavailable-title">Map unavailable</p>
    <p class="map-unavailable-desc">${esc(reason)}</p>`;
  if (wrapper.querySelector(".map-unavailable")) return;
  document.getElementById("bus-map-loading")?.remove();
  wrapper.appendChild(panel);
  refreshIcons();
}

/** The marker's blue dot is its anchor; the pill sits above it. */
function pinMarker({ coords, label, variant = "stop", number = "" }) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `route-marker route-marker--${variant}`;
  element.setAttribute("aria-label", `${number ? "Stop " + number + ": " : ""}${label}. Center on this stop.`);
  element.innerHTML = `<span class="route-marker-pill"><span class="route-marker-icon">${variant === "campus" ? '<i data-lucide="school" aria-hidden="true"></i>' : esc(number || "B")}</span><span class="route-marker-name">${esc(label)}</span></span><span class="route-marker-pointer" aria-hidden="true"></span><span class="route-marker-dot" aria-hidden="true"></span>`;
  element.addEventListener("click", () => {
    setActiveStop((busData?.route?.stops || []).findIndex(stop => stop.seq === number));
    map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 14), duration: motionDuration() });
  });
  const marker = new maplibregl.Marker({ element, anchor: "center", offset: [0, 0] }).setLngLat(coords);
  element.setAttribute("role", "button");
  // addTo() supplies MapLibre's generic label; restore the stop name afterward.
  const addTo = marker.addTo.bind(marker);
  marker.addTo = target => {
    addTo(target);
    element.setAttribute("aria-label", `${number ? "Stop " + number + ": " : ""}${label}. Center on this stop.`);
    return marker;
  };
  routeMarkers.push({ marker, element, coords, priority: variant === "stop" ? 1 : variant === "campus" ? 3 : 2 });
  return marker;
}

function motionDuration() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 550;
}

/** Colliding labels collapse to blue dots; focus/hover still reveals each stop. */
function arrangeMarkerLabels() {
  markerFrame = 0;
  if (!map) return;
  const occupied = [];
  const size = map.getContainer().getBoundingClientRect();
  const overlays = [...document.querySelectorAll("#app-header, .bus-map-heading, .bus-trip-card, #bottom-nav, .bus-map-controls button, .maplibregl-ctrl-group")].map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left - size.left, right: r.right - size.left, top: r.top - size.top, bottom: r.bottom - size.top };
  });
  for (const item of [...routeMarkers].sort((a, b) => b.priority - a.priority)) {
    const p = map.project(item.coords);
    const width = item.element.querySelector(".route-marker-pill").offsetWidth;
    const rect = { left: p.x - width / 2, right: p.x + width / 2, top: p.y - 62, bottom: p.y - 15 };
    const outside = rect.left < 8 || rect.right > size.width - 8 || rect.top < 0 || rect.bottom > size.height;
    const collision = occupied.some(r => rect.left < r.right + 12 && rect.right > r.left - 12 && rect.top < r.bottom + 10 && rect.bottom > r.top - 10)
      || overlays.some(r => rect.left < r.right + 4 && rect.right > r.left - 4 && rect.top < r.bottom + 4 && rect.bottom > r.top - 4);
    item.element.classList.toggle("is-compact", outside || collision);
    item.element.classList.toggle("is-overview", map.getZoom() < 12.8);
    item.element.style.zIndex = outside || collision ? "1" : String(item.priority + 3);
    if (!outside && !collision) occupied.push(rect);
  }
}

function scheduleMarkerLabels() {
  if (!markerFrame) markerFrame = requestAnimationFrame(arrangeMarkerLabels);
}

function wireRouteDetails() {
  const dialog = document.getElementById("bus-details");
  const opener = document.getElementById("bus-open-details");
  const compact = window.matchMedia("(max-width: 899px), (max-height: 540px)");
  const setExpanded = expanded => {
    tripExpanded = expanded;
    document.querySelector(".bus-trip-card")?.setAttribute("data-expanded", String(expanded));
    document.getElementById("bus-toggle-trip")?.setAttribute("aria-expanded", String(expanded));
    const content = document.getElementById("bus-trip-content");
    if (content) content.hidden = !expanded;
    const label = document.getElementById("bus-trip-toggle-label");
    if (label) label.textContent = `${expanded ? "Collapse" : "Expand"} route details`;
    scheduleMarkerLabels();
  };
  setExpanded(!compact.matches);
  compact.addEventListener("change", event => setExpanded(!event.matches));
  document.getElementById("bus-toggle-trip")?.addEventListener("click", () => setExpanded(!tripExpanded));
  opener?.addEventListener("click", () => {
    if (!dialog || dialog.open) return;
    dialog.showModal();
    const scroll = dialog.querySelector(".bus-details-scroll");
    if (scroll) scroll.scrollTop = 0;
  });
  document.getElementById("bus-close-details")?.addEventListener("click", () => dialog?.close());
  document.getElementById("bus-return-map")?.addEventListener("click", () => dialog?.close());
  dialog?.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog?.addEventListener("close", () => opener?.focus());
  dialog?.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
      .filter(element => element.getClientRects().length);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  document.getElementById("bus-fit-route")?.addEventListener("click", () => { if (map) fitToCorridor(corridor?.coordinates || []); });
  document.getElementById("bus-find-campus")?.addEventListener("click", () => {
    setActiveStop((busData?.route?.stops || []).findIndex(stop => stop.kind === "QCU campus stop"));
    map?.easeTo({ center: QCU_COORDS, zoom: 15, duration: motionDuration() });
  });
  document.getElementById("bus-zoom-in")?.addEventListener("click", () => map?.zoomIn({ duration: motionDuration() }));
  document.getElementById("bus-zoom-out")?.addEventListener("click", () => map?.zoomOut({ duration: motionDuration() }));
  document.getElementById("bus-stop-list")?.addEventListener("click", event => {
    const button = event.target.closest("[data-stop-index]");
    const stop = busData?.route?.stops?.[Number(button?.dataset.stopIndex)];
    if (!button || !map || !validCoordinates(stop?.coords)) return;
    setActiveStop(Number(button.dataset.stopIndex));
    dialog.close();
    map.easeTo({ center: stop.coords, zoom: 15, duration: motionDuration() });
  });
}

/** Active means selected on the map; it does not imply a GPS location. */
function setActiveStop(index) {
  if (!busData?.route?.stops?.[index]) return;
  activeStopIndex = index;
  document.querySelectorAll(".bus-stop-timeline [data-timeline-index]").forEach(item => {
    const active = Number(item.dataset.timelineIndex) === index;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  });
  const label = document.getElementById("bus-active-stop-label");
  if (label) label.textContent = `Selected stop ${busData.route.stops[index].seq} · Tap a stop to view it on the map`;
}

function renderTimelineStatus() {
  const status = document.getElementById("bus-timeline-status");
  if (!status) return;
  const day = dayOf(activeDay);
  const known = typeof day?.operates === "boolean";
  status.textContent = known
    ? `${DAY_LABELS[activeDay]} · ${day.operates ? "Published schedule" : "No service"}`
    : "Schedule unavailable";
  status.parentElement.classList.toggle("is-unavailable", !known);
}

function validCoordinates(coords) {
  return Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite)
    && Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
}

function renderTripDetails() {
  const target = document.getElementById("bus-trip-content");
  const route = busData?.route;
  const km = route?.distanceKm;
  const termini = route?.termini || [];
  const summaryDistance = document.getElementById("bus-trip-summary-distance");
  if (summaryDistance) summaryDistance.textContent = Number.isFinite(km) ? `${km} km` : "Distance unavailable";
  const summaryRoute = document.getElementById("bus-trip-summary-route");
  const routeLabel = termini.length >= 2 ? `${termini[0].label} to ${termini[1].label}` : "Route endpoints unavailable";
  if (summaryRoute) summaryRoute.textContent = routeLabel;
  const subtitle = document.getElementById("bus-timeline-subtitle");
  if (subtitle) subtitle.textContent = routeLabel;
  if (target) {
    target.innerHTML = `<dl class="bus-trip-stats"><div><dt>Distance</dt><dd id="bus-trip-distance">${Number.isFinite(km) ? esc(km) + ' <small>km</small>' : '<span class="bus-stat-unavailable">Unavailable</span>'}</dd><p>Published route</p></div><div><dt>Travel time</dt><dd class="bus-stat-unavailable">Not published</dd><p>Allow for traffic &amp; stops</p></div></dl>
      <div class="bus-trip-endpoints"><div><span class="bus-endpoint-dot bus-endpoint-dot--origin" aria-hidden="true"></span><span><small>From</small><strong>${esc(termini[0]?.label || "Origin unavailable")}</strong></span></div><div><span class="bus-endpoint-dot bus-endpoint-dot--destination" aria-hidden="true"></span><span><small>To</small><strong>${esc(termini[1]?.label || "Destination unavailable")}</strong></span></div></div>`;
    target.removeAttribute("aria-busy");
  }
  const list = document.getElementById("bus-stop-list");
  if (list) {
    list.innerHTML = route?.stops?.length ? route.stops.map((stop, index) => {
      const detail = `${stop.kind || "Bus stop"}${validCoordinates(stop.coords) ? "" : " · Map location unverified"}`;
      const content = `<strong>${esc(stop.name)}</strong><small>${esc(detail)}</small>`;
      return `<li data-timeline-index="${index}"><span class="bus-stop-number" aria-hidden="true">${esc(stop.seq)}</span><span class="bus-stop-node" aria-hidden="true"></span>${validCoordinates(stop.coords) ? `<button type="button" class="bus-stop-content" data-stop-index="${index}" aria-label="Stop ${esc(stop.seq)}: Show ${esc(stop.name)} on the map" disabled>${content}</button>` : `<div class="bus-stop-content">${content}<span class="loading-sr">Stop ${esc(stop.seq)}</span></div>`}</li>`;
    }).join("") : '<li class="bus-timeline-empty">Stop information is unavailable. Check official QC advisories.</li>';
    if (route?.stops?.length) setActiveStop(activeStopIndex >= 0 ? activeStopIndex : 0);
    else {
      const label = document.getElementById("bus-active-stop-label");
      if (label) label.textContent = "Stop locations unavailable";
    }
  }
}

function initMap() {
  if (map) return;

  if (typeof maplibregl === "undefined") {
    showMapUnavailable("The map library could not be loaded. Check your connection and reload.");
    return;
  }
  // MapLibre 4 dropped maplibregl.supported(), so probe WebGL directly.
  if (!hasWebGL()) {
    showMapUnavailable("This browser does not support WebGL, which the map needs to draw.");
    return;
  }

  const coordinates = Array.isArray(corridor?.coordinates) ? corridor.coordinates : [];

  try {
    map = new maplibregl.Map({
      container: "eta-map",
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: coordinates.length ? coordinates[Math.floor(coordinates.length / 2)] : QCU_COORDS,
      zoom: 11.6,
      attributionControl: false
    });
  } catch (error) {
    console.warn("Map could not start:", error);
    showMapUnavailable("The map could not start in this browser. Published schedules remain available in route details.");
    return;
  }

  map.addControl(new maplibregl.AttributionControl({ compact: true }));
  map.on("move", scheduleMarkerLabels);
  map.on("resize", scheduleMarkerLabels);
  mapLoadTimer = setTimeout(() => showMapUnavailable("Map tiles are taking too long to load. Published schedules are still available."), 20000);
  map.on("error", (event) => console.warn("Map error:", event?.error?.message || event));

  // Markers are DOM overlays and the camera is available immediately, so
  // the campus and termini are placed without waiting on tiles. Sources and
  // layers need the style, which lands well before the first full render —
  // "style.load" rather than "load" keeps the route visible on slow links.
  drawTermini();
  drawStops();
  refreshIcons();
  annotateCorridorOverlay();
  const sceneObserver = new ResizeObserver(() => { map.resize(); fitToCorridor(coordinates); });
  sceneObserver.observe(document.querySelector(".bus-map-scene"));
  const overlayObserver = new ResizeObserver(() => {
    scheduleMarkerLabels();
    if (map.getZoom() < 14) fitToCorridor(coordinates);
  });
  [".bus-trip-card", ".bus-map-heading", "#app-header", "#bottom-nav"].forEach(selector => {
    const element = document.querySelector(selector);
    if (element) overlayObserver.observe(element);
  });

  map.on("style.load", () => {
    try {
      styleRouteBasemap();
      if (coordinates.length > 1) drawCorridor(coordinates);
      clearTimeout(mapLoadTimer);
      document.getElementById("bus-map-loading")?.remove();
      document.querySelector(".map-unavailable")?.remove();
      document.querySelectorAll(".bus-map-controls button, [data-stop-index]").forEach(button => { button.disabled = false; });
    } catch (error) {
      console.warn("Route layers could not be drawn:", error);
    }
    // Framing waits for the style so the container has been measured;
    // fitBounds against an unmeasured viewport overshoots badly.
    fitToCorridor(coordinates);
  });
}

/** Keep OpenFreeMap geography legible while making the bus route stand out. */
function styleRouteBasemap() {
  for (const layer of map.getStyle().layers) {
    const sourceLayer = layer["source-layer"];
    if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-color", "#F4F6F7");
    } else if (layer.type === "fill") {
      const color = sourceLayer === "water" ? "#DAE4EB"
        : sourceLayer === "building" ? "#E1E6E9"
        : sourceLayer === "park" || sourceLayer === "landcover" ? "#E3EBE5"
        : sourceLayer === "landuse" ? "#EDF0F1" : null;
      if (color) map.setPaintProperty(layer.id, "fill-color", color);
      if (sourceLayer === "park" || sourceLayer === "building") {
        map.setPaintProperty(layer.id, "fill-outline-color", "#DDE4E6");
      }
    } else if (layer.type === "line") {
      if (sourceLayer === "transportation" && /^(road|tunnel|bridge)_/.test(layer.id) && !/rail/.test(layer.id)) {
        map.setPaintProperty(layer.id, "line-color", /casing/.test(layer.id) ? "#DCE2E6" : "#FFFFFF");
      } else if (sourceLayer === "waterway") {
        map.setPaintProperty(layer.id, "line-color", "#CCDCE6");
      } else if (sourceLayer === "boundary") {
        map.setPaintProperty(layer.id, "line-color", "#C4CDD3");
      }
    } else if (layer.type === "symbol") {
      if (/shield/.test(layer.id)) {
        map.setLayoutProperty(layer.id, "visibility", "none");
        continue;
      }
      if (layer.layout?.["text-field"]) {
        map.setPaintProperty(layer.id, "text-color", "#74818C");
        map.setPaintProperty(layer.id, "text-halo-color", "#FFFFFF");
        map.setPaintProperty(layer.id, "text-opacity", ["interpolate", ["linear"], ["zoom"], 10, 0.5, 13, 0.75, 16, 1]);
      }
      // Local landmarks become useful when zoomed in; overview labels stay quiet.
      if (sourceLayer === "poi") {
        map.setLayerZoomRange(layer.id, Math.max(layer.minzoom || 0, 14), layer.maxzoom || 24);
      }
    }
  }
}

/** Casing beneath the line keeps it legible over a light basemap. */
function drawCorridor(coordinates) {
  map.addSource("route4", {
    type: "geojson",
    lineMetrics: true,
    data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }
  });

  map.addLayer({
    id: "route4-casing",
    type: "line",
    source: "route4",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#FFFFFF", "line-width": 11, "line-opacity": 0.92 }
  });

  map.addLayer({
    id: "route4-line",
    type: "line",
    source: "route4",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-width": 6,
      "line-opacity": 1,
      "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#2474E8", 0.32, "#367FE9", 0.5, "#EF655B", 0.68, "#E66A53", 0.84, "#31B88A", 1, "#159C73"]
    }
  });
}

/**
 * Stops come from the data file only. Nothing is inferred from the
 * drawn line, so an unverified stop list simply renders no dots.
 */
function drawStops() {
  (busData?.route?.stops || []).forEach(stop => {
    if (!validCoordinates(stop.coords) || stop.kind === "Terminus" || stop.kind === "QCU campus stop") return;
    pinMarker({ coords: stop.coords, label: stop.name, number: stop.seq }).addTo(map);
  });
}

function drawTermini() {
  const campus = busData?.route?.stops?.find(stop => stop.kind === "QCU campus stop" && validCoordinates(stop.coords));
  pinMarker({ coords: campus?.coords || QCU_COORDS, label: "QCU Main Campus", variant: "campus", number: campus?.seq }).addTo(map);
  (busData?.route?.termini || []).forEach((terminus, index) => {
    if (!validCoordinates(terminus.coords)) return;
    pinMarker({ coords: terminus.coords, label: terminus.label, variant: "terminus", number: index === 0 ? 1 : busData.route.stopCount }).addTo(map);
  });
}

function fitToCorridor(coordinates) {
  const points = coordinates.length ? [...coordinates] : [];
  points.push(QCU_COORDS);
  if (points.length < 2) {
    map.jumpTo({ center: QCU_COORDS, zoom: 14 });
    return;
  }
  const bounds = points.reduce(
    (acc, point) => acc.extend(point),
    new maplibregl.LngLatBounds(points[0], points[0])
  );
  const scene = document.querySelector(".bus-map-scene").getBoundingClientRect();
  const heading = document.querySelector(".bus-map-heading").getBoundingClientRect();
  const card = document.querySelector(".bus-trip-card").getBoundingClientRect();
  const desktop = scene.width >= 900;
  const landscape = scene.width > scene.height && scene.height <= 540;
  const padding = desktop || landscape
    ? { top: heading.bottom + 28, right: 86, bottom: 95, left: card.right + 36 }
    : { top: heading.bottom + 24, right: 86, bottom: scene.height - card.top + 18, left: 36 };
  // Fit into the exposed map area above the card, including on short phones.
  if (!desktop && !landscape) {
    padding.top = heading.bottom + 24;
    padding.bottom = scene.height - card.top + 18;
    padding.right = 86;
    padding.left = 42;
    padding.top = Math.max(100, Math.min(padding.top, scene.height - padding.bottom - 60));
  } else {
    padding.top = Math.min(padding.top, scene.height * .34);
    padding.bottom = Math.min(padding.bottom, scene.height * .28);
  }
  map.fitBounds(bounds, { padding, duration: 0, maxZoom: 14 });
  scheduleMarkerLabels();
}

/** Names the actual roads the drawn corridor follows, from the geometry file. */
function annotateCorridorOverlay() {
  const target = document.getElementById("map-route-overlay-sub");
  if (!target) return;
  const km = corridor?.lengthKm;
  const distance = Number.isFinite(km) ? `≈${km} km` : null;
  target.textContent = distance
    ? `${distance} road path between the published Route 4 endpoints — indicative, not a live bus position.`
    : "Road path between the published Route 4 endpoints — indicative, not a live bus position.";
}

window.initETA = initETA;
