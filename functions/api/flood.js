/**
 * Cloudflare Pages Function — GET /api/flood
 *
 * Server-side proxy for the Google Flood Forecasting API
 * (floodforecasting.googleapis.com). Returns the official PH flood status for
 * the gauge nearest QCU (14.7001, 121.0343) as a normalized envelope:
 *
 *   { status:"OK", provider:"google", severity, trend, issuedAt, gaugeId,
 *     source, sourceUrl, gaugeLat, gaugeLon, km, checkedAt }
 *
 * The API key is read from the GOOGLE_FLOOD_KEY environment variable (set in
 * the Pages dashboard). Until the key is configured we answer HTTP 503 with
 * status:"UNCONFIGURED" so the client's fetchFlood throws on !ok and falls back
 * to the rainfall-derived estimate — never a fabricated "no flood risk".
 *
 * FAILURE MODES ARE DELIBERATE: this endpoint must not leak an unauthenticated
 * path that pretends to be authoritative. 503/404/502 = "we don't know", which
 * the UI renders as the calm Monitoring state rather than a false all-clear.
 */

const SOURCE_NAME = "Google Flood Forecasting";
const SOURCE_URL = "https://sites.research.google/floods/";
const API_BASE = "https://floodforecasting.googleapis.com/v1";
// QCU main campus — 673 Quirino Highway, Barangay San Bartolome, Novaliches.
// Matches assets/js/status.js (lat/lon) and assets/js/eta.js (lon-first).
const QCU = { lat: 14.7001, lon: 121.0343 };
// Report Google's severity only for gauges plausibly "the nearest river" to
// campus. A Marikina flood warning 40+ km away is NOT a QCU warning.
const MAX_GAUGE_KM = 40;

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      // Fresh every read — flood status is live, safety-critical info. (The
      // repo's _headers file does NOT apply to Pages Functions responses.)
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }, extraHeaders || {})
  });
}

function toRad(deg) { return (deg * Math.PI) / 180; }

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Google's severity/trend enums → our internal levels (mirrors the FLOOD_META
   levels + FLOOD_TREND keys in assets/js/status.js). Unknown values never
   fabricate a reading: they map to UNKNOWN, which the UI renders as the calm
   Monitoring state. */
const SEV = {
  EXTREME: "EXTREME", SEVERE: "SEVERE", ABOVE_NORMAL: "ELEVATED",
  NO_FLOODING: "NONE", UNKNOWN: "UNKNOWN", SEVERITY_UNSPECIFIED: "UNKNOWN"
};
const TREND = { RISE: "RISING", FALL: "FALLING", NO_CHANGE: "STABLE" };

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  // Accept both names used by the Pages deployment and scheduled updater.
  const key = (context.env && context.env.GOOGLE_FLOOD_KEY) ||
    (context.env && context.env.GOOGLE_FLOOD_API_KEY);
  const nowIso = new Date().toISOString();

  if (!key) {
    /* No key configured → honest 503. The client's fetchJson throws on !ok and
       falls back to the keyless Open-Meteo signal. */
    return jsonResponse({
      status: "UNCONFIGURED",
      checkedAt: nowIso,
      source: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      error: "GOOGLE_FLOOD_KEY (or GOOGLE_FLOOD_API_KEY) is not set"
    }, 503);
  }

  try {
    const statuses = await fetchLatestStatuses(key);
    const best = pickNearest(statuses);
    if (!best) {
      return jsonResponse({
        status: "EMPTY",
        checkedAt: nowIso,
        source: SOURCE_NAME,
        sourceUrl: SOURCE_URL,
        error: "no flood gauge within " + MAX_GAUGE_KM + " km of QCU"
      }, 404);
    }
    return jsonResponse({
      status: "OK",
      provider: "google",
      severity: best.severity,
      trend: best.trend,
      issuedAt: best.issuedAt,
      gaugeId: best.gaugeId,
      source: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      gaugeLat: best.lat,
      gaugeLon: best.lon,
      km: best.km,
      checkedAt: nowIso
    }, 200);
  } catch (err) {
    return jsonResponse({
      status: "ERROR",
      checkedAt: nowIso,
      source: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      error: String((err && err.message) || err).slice(0, 160)
    }, 502);
  }
}

// Page through searchLatestFloodStatusByArea (regionCode "PH", quality-verified
// only) and collect FloodStatus rows with a gauge location. Caps upstream work
// at 3 pages.
async function fetchLatestStatuses(key) {
  const out = [];
  let pageToken = "";
  for (let p = 0; p < 3; p++) {
    const url = API_BASE + "/floodStatus:searchLatestFloodStatusByArea?key=" + encodeURIComponent(key);
    const body = { regionCode: "PH", includeNonQualityVerified: false, pageSize: 100 };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Edge-cache the UPSTREAM read only. Our own response stays no-store.
      cf: { cacheTtl: 120, cacheEverything: true }
    });
    if (!res.ok) throw new Error("google flood HTTP " + res.status);
    const j = await res.json();
    const rows = Array.isArray(j.floodStatuses) ? j.floodStatuses : [];
    for (const s of rows) {
      const gl = s && s.gaugeLocation;
      if (!gl || typeof gl.latitude !== "number" || typeof gl.longitude !== "number") continue;
      out.push({
        gaugeId: s.gaugeId || null,
        lat: gl.latitude,
        lon: gl.longitude,
        severity: SEV[String(s.severity || "").toUpperCase()] || "UNKNOWN",
        trend: TREND[String(s.forecastTrend || "").toUpperCase()] || null,
        issuedAt: s.issuedTime || null,
        source: s.source || null
      });
    }
    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

// Closest gauge to QCU within MAX_GAUGE_KM; ties broken by issuedAt recency.
function pickNearest(statuses) {
  if (!statuses || !statuses.length) return null;
  let best = null;
  for (const s of statuses) {
    s.km = haversineKm(QCU, { lat: s.lat, lon: s.lon });
    if (s.km > MAX_GAUGE_KM) continue;
    if (!best || s.km < best.km - 1e-9 ||
        (Math.abs(s.km - best.km) < 1e-9 && String(s.issuedAt || "") > String(best.issuedAt || ""))) {
      best = s;
    }
  }
  return best;
}
