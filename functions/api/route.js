const QCU = { lat: 14.7001, lon: 121.0343 };
const BASE = "https://api.tomtom.com/routing/1/calculateRoute";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
  }});
}
export function onRequestOptions() { return json(null, 204); }
function coord(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function url(lat, lon, key, traffic) {
  const coords = lon + "," + lat + ":" + QCU.lon + "," + QCU.lat;
  return BASE + "/" + coords + "/json?key=" + encodeURIComponent(key) +
    "&routeType=fastest&traffic=" + (traffic ? "true" : "false") +
    "&travelMode=car&vehicleCommercial=false&avoid=unpavedRoads&computeTravelTimeFor=all&instructionsType=none&report=effectiveSettings";
}
async function readRoute(res) {
  if (!res.ok) throw new Error("TomTom HTTP " + res.status);
  const data = await res.json();
  const route = data && Array.isArray(data.routes) ? data.routes[0] : null;
  if (!route || !route.summary || !route.legs || !route.legs[0]) throw new Error("No route found");
  return route;
}
export async function onRequestGet(context) {
  const request = context.request;
  const u = new URL(request.url);
  const lat = coord(u.searchParams.get("lat"));
  const lon = coord(u.searchParams.get("lon"));
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return json({ status: "INVALID_REQUEST", error: "Valid lat and lon are required" }, 400);
  const key = context.env && context.env.TOMTOM_API_KEY;
  if (!key) return json({ status: "UNCONFIGURED", error: "TOMTOM_API_KEY is not configured" }, 503);
  try {
    const [normal, traffic] = await Promise.all([
      fetch(url(lat, lon, key, false)).then(readRoute),
      fetch(url(lat, lon, key, true)).then(readRoute)
    ]);
    const points = traffic.legs[0].points || [];
    return json({ status: "OK", provider: "tomtom",
      normalMins: Math.max(1, Math.ceil(normal.summary.travelTimeInSeconds / 60)),
      currentMins: Math.max(1, Math.ceil(traffic.summary.travelTimeInSeconds / 60)),
      distanceKm: (traffic.summary.lengthInMeters / 1000).toFixed(1),
      geometry: points.map(p => [p.longitude, p.latitude]), checkedAt: new Date().toISOString() });
  } catch (err) {
    return json({ status: "ERROR", error: String(err && err.message || err).slice(0, 160) }, 502);
  }
}
