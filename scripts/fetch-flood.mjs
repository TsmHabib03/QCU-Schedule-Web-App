#!/usr/bin/env node
/* =============================================================
   scripts/fetch-flood.mjs
   Out-of-band updater for data/flood.json.

   Runs in GitHub Actions (Node 20+, global fetch). Calls the Google
   Flood Forecasting API (Flood Hub) server-side and writes a NORMALIZED
   advisory the static frontend consumes. The API key lives ONLY as a
   GitHub Actions secret (process.env.GOOGLE_FLOOD_API_KEY) — it is never
   shipped to the browser.

   Nothing is fabricated: risk level / trend / outlook come straight from
   the API for the gauge nearest Quezon City. On any failure, empty result,
   or missing key we PRESERVE the existing file — a fetch failure must
   never become a false "no flood risk". Values the API does not provide
   (e.g. a numeric inundation probability) stay null; the UI treats null
   as "not available", never as zero risk.
   ============================================================= */
import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.GOOGLE_FLOOD_API_KEY || "";
const OUT = new URL("../data/flood.json", import.meta.url);
const BASE = "https://floodforecasting.googleapis.com/v1";

// Quezon City reference point (same as the weather widget's CFG.lat/lon).
const QC = { lat: 14.7001, lon: 121.0343 };
// Only trust a gauge as "local" if it is within this radius of QC.
const MAX_KM = 60;

// Google Flood Hub severity enum → our normalized risk level + label.
const RISK = {
  EXTREME:      { level: "EXTREME",  label: "Extreme flood risk" },
  SEVERE:       { level: "SEVERE",   label: "Severe flood risk" },
  ABOVE_NORMAL: { level: "ELEVATED", label: "Above-normal water level" },
  NO_FLOODING:  { level: "NONE",     label: "No flooding expected" }
};

function nowIso() { return new Date().toISOString(); }

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}/${path}?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " on " + path);
  return res.json();
}

async function getJson(path) {
  const res = await fetch(`${BASE}/${path}?key=${encodeURIComponent(KEY)}`);
  if (!res.ok) throw new Error("HTTP " + res.status + " on " + path);
  return res.json();
}

// Pull latitude/longitude out of the various shapes the API may return.
function coordsOf(obj) {
  if (!obj) return null;
  const loc = obj.location || obj.gaugeLocation || obj;
  const lat = loc.latitude != null ? +loc.latitude : (loc.lat != null ? +loc.lat : null);
  const lon = loc.longitude != null ? +loc.longitude : (loc.lng != null ? +loc.lng : (loc.lon != null ? +loc.lon : null));
  return (lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon)) ? { lat, lon } : null;
}

function normalizeTrend(t) {
  const s = String(t || "").toUpperCase();
  if (/RIS/.test(s)) return "RISING";
  if (/FALL|RECED/.test(s)) return "FALLING";
  if (/NO_CHANGE|STABLE|STEADY/.test(s)) return "STABLE";
  return null;
}

async function main() {
  if (!KEY) {
    console.error("GOOGLE_FLOOD_API_KEY not set — PRESERVING existing advisory (never fake 'no risk').");
    process.exit(0);
  }

  let statuses;
  try {
    // Latest flood status for the whole country; we filter to the QC-nearest gauge.
    const data = await postJson("floodStatus:searchLatestFloodStatusByArea", { regionCode: "PH" });
    statuses = data.floodStatuses || data.floodStatus || [];
  } catch (e) {
    console.error("Flood status fetch failed — PRESERVING existing advisory:", e.message);
    process.exit(0);
  }

  if (!Array.isArray(statuses) || statuses.length === 0) {
    console.error("No flood statuses returned — PRESERVING existing advisory.");
    process.exit(0);
  }

  // Find the status whose gauge is closest to Quezon City.
  let best = null;
  for (const s of statuses) {
    let c = coordsOf(s);
    if (!c && s.gaugeId) {
      try { c = coordsOf(await getJson("gauges/" + encodeURIComponent(s.gaugeId))); } catch { /* ignore */ }
    }
    if (!c) continue;
    const km = haversineKm(QC.lat, QC.lon, c.lat, c.lon);
    if (!best || km < best.km) best = { status: s, coords: c, km };
  }

  if (!best || best.km > MAX_KM) {
    console.error("No gauge within " + MAX_KM + "km of QC — PRESERVING existing advisory.");
    process.exit(0);
  }

  const s = best.status;
  const sev = String(s.severity || s.floodStatusSeverity || "").toUpperCase();
  const risk = RISK[sev] || { level: "UNKNOWN", label: "Advisory unavailable" };

  // Optional gauge metadata (river / site name) — best-effort, never required.
  let gaugeName = s.siteName || s.gaugeName || "";
  let river = s.riverName || s.river || "";
  if ((!gaugeName || !river) && s.gaugeId) {
    try {
      const g = await getJson("gauges/" + encodeURIComponent(s.gaugeId));
      gaugeName = gaugeName || g.siteName || g.name || "";
      river = river || g.river || g.riverName || "";
    } catch { /* ignore */ }
  }

  // 24h outlook: severity the API forecasts for the coming window (if any),
  // NOT a fabricated percentage. A numeric probability is only emitted when
  // the API actually supplies one.
  const outlookSev = String((s.forecast && s.forecast.severity) || s.forecastSeverity || "").toUpperCase();
  const outlook = RISK[outlookSev] ? RISK[outlookSev].level : null;
  const prob = (typeof s.inundationProbability === "number") ? Math.round(s.inundationProbability * 100)
    : (typeof s.floodProbability === "number") ? Math.round(s.floodProbability * 100)
    : null;

  const out = {
    status: risk.level === "UNKNOWN" ? "UNKNOWN" : "OK",
    riskLevel: risk.level,                 // EXTREME | SEVERE | ELEVATED | NONE | UNKNOWN
    riskLabel: risk.label,
    gauge: {
      id: s.gaugeId || null,
      name: gaugeName || null,
      river: river || null,
      distanceKm: Math.round(best.km * 10) / 10
    },
    waterLevel: { trend: normalizeTrend(s.forecastTrend || s.trend), unit: "m", value: null },
    inundationProbability24h: prob,        // 0-100 or null (null = not provided by API)
    outlook24h: outlook,                   // forecast severity level or null
    source: "Google Flood Hub",
    sourceUrl: "https://sites.research.google/floods/",
    publishedAt: s.issuedTime || s.forecastIssuedTime || nowIso(),
    checkedAt: nowIso()
  };

  let prev = "";
  try { prev = await readFile(OUT, "utf8"); } catch { /* first run */ }
  const next = JSON.stringify(out, null, 2) + "\n";

  // Compare ignoring the volatile checkedAt so we don't churn commits every run.
  const strip = (t) => t.replace(/"checkedAt":\s*"[^"]*"/, "");
  if (strip(prev.trim()) === strip(next.trim())) {
    console.log("No change (advisory unchanged).");
    process.exit(0);
  }
  await writeFile(OUT, next, "utf8");
  console.log(`Wrote flood advisory: ${out.riskLevel} @ ${out.gauge.name || "nearest gauge"} (${out.gauge.distanceKm}km).`);
}

main().catch((e) => { console.error("Unexpected error — not modifying advisory:", e); process.exit(0); });
