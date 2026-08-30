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
  const day = now.getDay();
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return "weekdays";
}

function dayOf(key) {
  return busData?.service?.[key] ?? null;
}

/* ── Boot ────────────────────────────────────────────────── */

async function initETA() {
  wireScheduleTabs();

  const [dataResult, corridorResult] = await Promise.allSettled([
    fetch(BUS_DATA_URL, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    fetch(CORRIDOR_URL, { cache: "no-cache" }).then((r) => {
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
  wrapper.appendChild(panel);
  refreshIcons();
}

function pinMarker({ coords, label, variant }) {
  const element = document.createElement("div");
  element.className = variant === "campus" ? "qcu-marker-container" : "terminus-marker-container";
  const pinClass = variant === "campus" ? "qcu-marker-pin" : "terminus-marker-pin";
  const labelClass = variant === "campus" ? "qcu-marker-label" : "terminus-marker-label";
  element.innerHTML = `
    <div class="${pinClass}" title="${esc(label)}"></div>
    <span class="${labelClass}">${esc(label)}</span>`;
  // Offset by the label block so the pin's tip — not the label's baseline —
  // lands on the coordinate.
  return new maplibregl.Marker({ element, anchor: "bottom", offset: [0, 20] }).setLngLat(coords);
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
    showMapUnavailable("The map could not start in this browser. The schedule below is unaffected.");
    return;
  }

  map.addControl(new maplibregl.AttributionControl({ compact: true }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.on("error", (event) => console.warn("Map error:", event?.error?.message || event));

  // Markers are DOM overlays and the camera is available immediately, so
  // the campus and termini are placed without waiting on tiles. Sources and
  // layers need the style, which lands well before the first full render —
  // "style.load" rather than "load" keeps the route visible on slow links.
  drawTermini();
  annotateCorridorOverlay();

  map.on("style.load", () => {
    try {
      if (coordinates.length > 1) drawCorridor(coordinates);
      drawStops();
    } catch (error) {
      console.warn("Route layers could not be drawn:", error);
    }
    // Framing waits for the style so the container has been measured;
    // fitBounds against an unmeasured viewport overshoots badly.
    fitToCorridor(coordinates);
  });
}

/** Casing beneath the line keeps it legible over a light basemap. */
function drawCorridor(coordinates) {
  map.addSource("route4", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }
  });

  map.addLayer({
    id: "route4-casing",
    type: "line",
    source: "route4",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#FFFFFF", "line-width": 8, "line-opacity": 0.9 }
  });

  map.addLayer({
    id: "route4-line",
    type: "line",
    source: "route4",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#005BAC", "line-width": 4, "line-opacity": 0.95 }
  });
}

/**
 * Stops come from the data file only. Nothing is inferred from the
 * drawn line, so an unverified stop list simply renders no dots.
 */
function drawStops() {
  const stops = Array.isArray(busData?.route?.stops) ? busData.route.stops : [];
  if (!stops.length) return;

  map.addSource("route4-stops", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: stops
        .filter((stop) => Array.isArray(stop.coords) && stop.coords.length === 2)
        .map((stop) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: stop.coords },
          properties: { name: stop.name, kind: stop.kind || "Bus stop" }
        }))
    }
  });

  map.addLayer({
    id: "route4-stops-layer",
    type: "circle",
    source: "route4-stops",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 14, 5.5, 16, 7],
      "circle-color": "#FFFFFF",
      "circle-stroke-color": "#005BAC",
      "circle-stroke-width": 2
    }
  });

  map.addLayer({
    id: "route4-stops-labels",
    type: "symbol",
    source: "route4-stops",
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-allow-overlap": false
    },
    paint: {
      "text-color": "#0A3D6E",
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.6
    }
  });

  const popup = new maplibregl.Popup({ closeButton: true, offset: 10, maxWidth: "220px" });

  map.on("click", "route4-stops-layer", (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    popup
      .setLngLat(feature.geometry.coordinates)
      .setHTML(
        `<p class="map-stop-popup-name">${esc(feature.properties.name)}</p>
         <p class="map-stop-popup-kind">${esc(feature.properties.kind)}</p>`
      )
      .addTo(map);
  });

  map.on("mouseenter", "route4-stops-layer", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "route4-stops-layer", () => { map.getCanvas().style.cursor = ""; });
}

function drawTermini() {
  pinMarker({ coords: QCU_COORDS, label: "QCU Campus", variant: "campus" }).addTo(map);

  (busData?.route?.termini || []).forEach((terminus) => {
    if (!Array.isArray(terminus.coords) || terminus.coords.length !== 2) return;
    pinMarker({ coords: terminus.coords, label: terminus.label, variant: "terminus" }).addTo(map);
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
  // The route plate sits top-left and the legend bottom-left. On a phone the
  // container is portrait and the corridor is a narrow vertical ribbon, so the
  // padding is biased right to keep the line clear of both overlays. Desktop has
  // horizontal slack already and only needs to clear the chrome.
  const isNarrow = window.matchMedia("(max-width: 480px)").matches;
  map.fitBounds(bounds, {
    padding: isNarrow
      ? { top: 152, right: 20, bottom: 84, left: 20 }
      : { top: 96, right: 48, bottom: 104, left: 48 },
    duration: 0
  });
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
