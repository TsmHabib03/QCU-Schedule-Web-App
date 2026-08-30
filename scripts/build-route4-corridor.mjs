/**
 * Generates an indicative road corridor for QCity Bus Route 4
 * (Quezon City Hall <-> General Luis) by snapping the published
 * endpoints to the OpenStreetMap road network via the public OSRM
 * demo router, then simplifying the polyline.
 *
 * The output is NOT an official QC Government GPS trace. It is a road
 * path between officially published endpoints, and every surface that
 * renders it must say so. Run manually; the app ships the static result.
 *
 *   node scripts/build-route4-corridor.mjs
 */
import { writeFileSync } from "node:fs";

const WAYPOINTS = [
  [121.0500, 14.6464], // Quezon City Hall
  [121.0327, 14.7004], // QCU San Bartolome, Quirino Highway
  [121.0356, 14.7219], // Quirino Highway / General Luis St junction
  [121.0198, 14.7202]  // General Luis Street, Nagkaisang Nayon
];

const TOLERANCE_DEG = 0.00007; // ~7.7 m

function perpDistance(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance)
  ];
}

const url =
  "https://router.project-osrm.org/route/v1/driving/" +
  WAYPOINTS.map((w) => w.join(",")).join(";") +
  "?overview=full&geometries=geojson&steps=true";

const res = await fetch(url);
if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
const data = await res.json();
const route = data.routes?.[0];
if (!route) throw new Error("OSRM returned no route");

const roads = [];
for (const leg of route.legs) {
  for (const step of leg.steps) {
    if (step.name && roads[roads.length - 1] !== step.name) roads.push(step.name);
  }
}

const coords = simplify(route.geometry.coordinates, TOLERANCE_DEG).map(([lng, lat]) => [
  Number(lng.toFixed(5)),
  Number(lat.toFixed(5))
]);

writeFileSync(
  "data/route4-corridor.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      generatedBy: "scripts/build-route4-corridor.mjs",
      source: "OpenStreetMap road network via OSRM demo router",
      disclaimer:
        "Indicative road corridor between officially published Route 4 endpoints. Not an official QC Government GPS trace.",
      roads,
      lengthKm: Number((route.distance / 1000).toFixed(1)),
      coordinates: coords
    },
    null,
    2
  ) + "\n"
);

console.log(`points ${route.geometry.coordinates.length} -> ${coords.length}`);
console.log(`length ${(route.distance / 1000).toFixed(1)} km`);
console.log(`roads  ${roads.join(" > ")}`);
