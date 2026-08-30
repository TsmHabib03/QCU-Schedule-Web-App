/**
 * Cloudflare Pages Function — GET /api/weather-alerts
 *
 * Server-side proxy for the Google Weather "publicAlerts" API
 * (weather.googleapis.com/v1/publicAlerts:lookup). Returns the official
 * active FLOOD-related public alerts for QCU (14.7001, 121.0343) as a
 * normalized envelope:
 *
 *   { status:"OK", provider:"google", regionCode, alerts:[ … ], checkedAt,
 *     source, sourceUrl }
 *
 * where each alert is { alertId, eventType, title, areaName, description,
 * severity, certainty, urgency, instruction, safetyRecommendations,
 * startTime, expirationTime, publisher, authorityName, authorityUri }.
 *
 * ONLY flood-class event types are kept (FLOOD / FLASH_FLOOD / RIVER_FLOODING /
 * MUDDY_FLOOD / COASTAL_FLOOD and any other eventType that reads as flood),
 * and only alerts that are CURRENTLY ACTIVE (not expired, and not scheduled
 * for the future). This is the authoritative input for the "Flood Advisory"
 * section of the Home widget — it is never derived from rainfall heuristics.
 *
 * The API key is read from the GOOGLE_WEATHER_KEY environment variable, with
 * GOOGLE_FLOOD_KEY as a fallback so a single configured key keeps every flood
 * source working. Until a key is configured we answer HTTP 503 with
 * status:"UNCONFIGURED" so the client renders the honest "unavailable / stale"
 * state — never a fabricated "no flood alert".
 *
 * FAILURE MODES ARE DELIBERATE: 503/502/404 = "we don't know", which the UI
 * renders as STALE_DATA / API_ERROR rather than a false all-clear. An EMPTY
 * but SUCCESSFUL lookup, however, IS authoritative: "the source was read and
 * has no active flood alert for this location".
 */

const SOURCE_NAME = "Google Weather Alerts";
const SOURCE_URL = "https://developers.google.com/weather/publicalerts";
const API_BASE = "https://weather.googleapis.com/v1/publicAlerts:lookup";
// QCU main campus — 673 Quirino Highway, Barangay San Bartolome, Novaliches.
// Matches assets/js/status.js and functions/api/flood.js.
const QCU = { lat: 14.7001, lon: 121.0343 };
// Matches the event-type vocabulary of the publicAlerts API. Anything whose
// normalized event type contains "FLOOD" qualifies (FLASH_FLOOD, RIVER_FLOOD,
// COASTAL_FLOOD, MUDDY_FLOOD, …).
const FLOOD_RE = /FLOOD/;

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      // Fresh every read — flood alert status is live, safety-critical info.
      // (The repo's _headers file does NOT apply to Pages Functions responses.)
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }, extraHeaders || {})
  });
}

// Normalized flood-class event type. publicAlerts eventType values are
// UPPERCASE and usually underscore-separated; tolerate spaces and casing.
function isFloodEvent(eventType) {
  const t = String(eventType || "").toUpperCase().replace(/\s+/g, "_");
  return FLOOD_RE.test(t);
}

// Tolerant ISO timestamp parse — the API can emit RFC3339 or null.
function parseTime(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

// Is this alert currently active? Active = not scheduled for the future AND
// not expired. Alerts carrying no timestamps at all are kept (ambiguous →
// safer to surface than to silently drop).
function isActiveAlert(alert) {
  const now = Date.now();
  const start = parseTime(alert.onset || alert.startTime);
  const end = parseTime(alert.expires || alert.expirationTime);
  if (start != null && start > now) return false;   // not yet in effect
  if (end != null && end <= now) return false;      // already expired
  return true;
}

// Normalize one raw publicAlerts item into the client envelope shape. Field
// names are read defensively so small schema changes upstream degrade to
// "missing field", never to a thrown error.
function normalizeAlert(a) {
  const start = a.onset || a.startTime || null;
  const end = a.expires || a.expirationTime || null;
  return {
    alertId: a.alertId || a.id || null,
    eventType: a.eventType || null,
    title: a.headline || a.title || null,
    areaName: a.areaName || a.area || null,
    description: a.description || a.body || null,
    severity: a.severity || null,
    certainty: a.certainty || null,
    urgency: a.urgency || null,
    instruction: a.instruction || null,
    safetyRecommendations: Array.isArray(a.safetyRecommendations) ? a.safetyRecommendations : null,
    startTime: start,
    expirationTime: end,
    publisher: a.publisher || null,
    authorityName: a.authorityName || a.senderName || null,
    authorityUri: a.authorityUri || a.senderUri || null
  };
}

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
  const key = (context.env && context.env.GOOGLE_WEATHER_KEY) || (context.env && context.env.GOOGLE_FLOOD_KEY);
  const nowIso = new Date().toISOString();

  if (!key) {
    /* No key configured → honest 503. The client's fetchJson throws on !ok and
       renders the flood section as "unavailable / stale" — never a false
       all-clear. */
    return jsonResponse({
      status: "UNCONFIGURED",
      checkedAt: nowIso,
      source: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      error: "GOOGLE_WEATHER_KEY (or GOOGLE_FLOOD_KEY) is not set"
    }, 503);
  }

  try {
    const url = API_BASE +
      "?location.latitude=" + QCU.lat +
      "&location.longitude=" + QCU.lon +
      "&languageCode=en" +
      "&pageSize=50" +
      "&key=" + encodeURIComponent(key);

    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      // Edge-cache the UPSTREAM read only. Our own response stays no-store.
      cf: { cacheTtl: 120, cacheEverything: true }
    });
    if (!res.ok) throw new Error("google weather alerts HTTP " + res.status);

    const j = await res.json();
    const raw = Array.isArray(j.alerts) ? j.alerts : [];

    const alerts = raw
      .filter(function (a) { return a && typeof a === "object"; })
      .filter(function (a) { return isFloodEvent(a.eventType); })
      .filter(isActiveAlert)
      .map(normalizeAlert)
      // Most recent alert first — the client reads index 0 as the headline.
      .sort(function (a, b) {
        const ta = parseTime(a.startTime) || 0, tb = parseTime(b.startTime) || 0;
        return tb - ta;
      });

    /* An empty alerts array after a SUCCESSFUL lookup is authoritative: the
       source was read and reports no active flood alert at QCU. This is the
       one empty result that may render as a clear "no active flood alert". */
    return jsonResponse({
      status: "OK",
      provider: "google",
      regionCode: j.regionCode || "PH",
      alerts: alerts,
      checkedAt: nowIso,
      source: SOURCE_NAME,
      sourceUrl: SOURCE_URL
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
