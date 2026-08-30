/* Throwaway smoke test: loads the real assets/js/status.js in a stubbed DOM and
   renders every suspension state end-to-end. Verifies the new notice card
   markup, and that the truthfulness rules still hold (a feed failure must never
   render as an all-clear). Run: node scripts/_smoke-notice.mjs   */
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync("assets/js/status.js", "utf8");

function render(feed, schedule, label) {
  let html = "";
  const root = {
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    addEventListener() {},
  };
  const store = {};
  const ctx = {
    console,
    Intl,
    Date,
    Promise,
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    RegExp,
    isNaN,
    parseInt,
    setTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    navigator: {},
    document: {
      getElementById: (id) => (id === "home-status" ? root : null),
      addEventListener() {},
      hidden: false,
    },
    fetch: (url) => {
      const u = String(url);
      if (u.includes("open-meteo.com")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            current: { temperature_2m: 29, apparent_temperature: 33, relative_humidity_2m: 78, weather_code: 61, precipitation: 1.2 },
            hourly: { time: [], precipitation_probability: [] },
          }),
        });
      }
      if (u.includes("suspensions")) {
        if (feed === undefined) return Promise.reject(new Error("feed down"));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: feed }) });
      }
      if (u.includes("schedule")) return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule || []) });
      return Promise.reject(new Error("no flood key"));
    },
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  new vm.Script(SRC).runInContext(ctx);

  // Let the promise chain in refresh() settle.
  return new Promise((res) => setImmediate(() => setImmediate(() => setImmediate(() => res({ label, html })))));
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
// Step the ISO parts via UTC — new Date(iso).toISOString() would shift the day
// back for any timezone east of UTC (Manila is +8), which silently made the
// PENDING fixture land on today.
const tomorrow = (() => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
})();
const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long" }).format(new Date());

const SCHED = [
  { day: "Monday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
  { day: "Tuesday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
  { day: "Wednesday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
  { day: "Thursday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
  { day: "Friday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
  { day: "Saturday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
  { day: "Sunday", start: "08:00", end: "10:00", subject: "Data Structures", room: "IL502A", building: "NAB" },
];

const CASES = [
  ["CLEAR (no suspension)", [], SCHED],
  ["SUSPENDED (all levels, whole day)", [{
    title: "Walang Pasok: Suspension of Classes at All Levels – Whole Day",
    body: "All levels, public and private schools. Whole day suspension due to continued heavy rain.",
    effectiveDate: today, publishedAt: today, reason: "Continued heavy rainfall and flooding",
    source: "Quezon City Government", sourceUrl: "https://quezoncity.gov.ph/news-and-media/announcements/",
  }], SCHED],
  ["PARTIAL (face-to-face only)", [{
    title: "Suspension of Afternoon Face-to-Face Classes",
    body: "Afternoon face-to-face classes in all levels including college are suspended.",
    effectiveDate: today, publishedAt: today, reason: "Heavy afternoon rain",
  }], [{ day: WEEKDAY, start: "13:00", end: "16:00", subject: "Networks", room: "IL301", building: "NAB" }]],
  ["PENDING (announced for tomorrow)", [{
    title: "Walang Pasok: Classes Suspended Tomorrow, All Levels",
    body: "Classes at all levels are suspended.",
    effectiveDate: tomorrow, publishedAt: today, reason: "Typhoon signal no. 2",
  }], SCHED],
  ["NOT_SUSPENDED (K-12 only, misses QCU)", [{
    title: "Walang Pasok: Suspension of Classes in Elementary and Junior High",
    body: "Elementary and junior high school classes in public and private schools are suspended.",
    effectiveDate: today, publishedAt: today,
  }], SCHED],
  ["UNKNOWN (feed unreachable)", undefined, SCHED],
];

const results = [];
for (const [label, feed, sched] of CASES) results.push(await render(feed, sched, label));

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log("   ✗ " + msg); fail++; } };

for (const { label, html } of results) {
  const hasNotice = html.includes('class="notice ');
  const cls = (html.match(/class="notice (is-[a-z]+)"/) || [])[1] || "?";
  const chip = (html.match(/notice-status"><i[^>]*><\/i>([^<]*)</) || [])[1] || "?";
  const title = (html.match(/notice-verdict-title">([^<]*)</) || [])[1] || "?";
  const sub = (html.match(/notice-verdict-sub">([^<]*)</) || [])[1] || "?";
  console.log("\n=== " + label + "  [" + cls + "]");
  console.log("   chip    : " + chip);
  console.log("   verdict : " + title);
  console.log("   sub     : " + sub);
  console.log("   doc     : " + (html.includes("notice-doc") ? "yes" : "no") +
              "  attest: " + (html.includes("notice-attest") ? "yes" : "no") +
              "  cta: " + (html.includes("feed-cta") ? "yes" : "no"));
  check(html.includes("weather-switch"), "weather location switch missing");
  check(html.includes('data-weather-view="user"') && html.includes('data-weather-view="campus"'), "weather location options missing");

  // A verified quiet day intentionally has no notice markup at all.
  if (label.startsWith("CLEAR")) {
    check(!hasNotice, "clear day rendered a suspension notice");
    continue;
  }

  check(html.includes("notice-verdict-title"), "missing verdict title");
  check(title !== "?" && title.length > 3, "verdict title empty");
  check(!html.includes("notice-headline"), "retired .notice-headline still emitted");
  check(!html.includes("feed-empty"), "retired .feed-empty still emitted");
  check(!/undefined|NaN|null/.test(html), "leaked undefined/NaN/null into markup");
  // Truthfulness: an unreachable feed must never read as clear.
  if (label.startsWith("UNKNOWN")) {
    check(cls === "is-unknown", "feed failure did not render is-unknown");
    check(!html.includes("notice-attest"), "feed failure showed the clear-day attestation");
    check(!/in session/i.test(html), "feed failure implied classes are on");
  }
  if (label.startsWith("SUSPENDED")) {
    check(cls === "is-suspended", "suspended not is-suspended (got " + cls + ")");
    check(html.includes("notice-doc"), "suspended missing quoted announcement");
    check(html.includes("feed-cta"), "suspended missing official-announcement link");
  }
  if (label.startsWith("PARTIAL")) {
    check(cls === "is-partial", "face-to-face-only suspension not is-partial (got " + cls + ")");
    check(html.includes("notice-doc"), "partial missing quoted announcement");
    check(!/Classes are in session/.test(html), "partial rendered the all-clear verdict");
  }
  if (label.startsWith("PENDING")) {
    check(cls === "is-pending", "future suspension not is-pending (got " + cls + ")");
    check(/Takes effect/.test(html), "pending missing its effective date");
    check(!/Classes are in session/.test(html), "pending rendered the all-clear verdict");
  }
  if (label.startsWith("NOT_SUSPENDED")) {
    check(cls === "is-clear", "K-12-only notice not is-clear");
    check(html.includes("notice-doc"), "K-12-only notice hid the announcement it is explaining");
  }
  // Every state keeps the verify footer.
  check(html.includes("notice-foot") && html.includes("notice-link"), "missing verify footer");
}

console.log("\n" + (fail === 0 ? "ALL CHECKS PASSED" : fail + " CHECK(S) FAILED"));
process.exit(fail === 0 ? 0 : 1);
