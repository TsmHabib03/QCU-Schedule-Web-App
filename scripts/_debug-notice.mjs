/* Focused debug: why did the PARTIAL fixture not register as an active notice?
   Loads status.js, then drives the exposed engine directly (no fetch layer). */
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync("assets/js/status.js", "utf8");
const root = { innerHTML: "", addEventListener() {} };
const ctx = {
  console, Intl, Date, Promise, JSON, Math, String, Number, Array, Object, RegExp, isNaN, parseInt, setTimeout,
  localStorage: { getItem: () => null, setItem() {} },
  navigator: {},
  document: { getElementById: (id) => (id === "home-status" ? root : null), addEventListener() {}, hidden: false },
  fetch: () => Promise.reject(new Error("offline")),
};
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
new vm.Script(SRC).runInContext(ctx);

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long" }).format(new Date());
// Correct "tomorrow": step the ISO parts, never via toISOString (which shifts to UTC).
const tomorrow = (() => {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
})();

console.log("today   =", today, "(" + weekday + ")");
console.log("tomorrow=", tomorrow);

const PARTIAL = {
  title: "Suspension of Afternoon Face-to-Face Classes",
  body: "Afternoon face-to-face classes in all levels including college are suspended.",
  effectiveDate: today, publishedAt: today, reason: "Heavy afternoon rain",
};
const SCHED_PM = [{ day: weekday, start: "13:00", end: "16:00", subject: "Networks", room: "IL301", building: "NAB" }];

const partial = ctx.window.getQcuSuspensionStatus([PARTIAL], SCHED_PM, "MODERATE");
console.log("\nPARTIAL →", partial.status, "|", partial.headline, "| modality:", partial.modality,
            "| period:", partial.period, "| coversQcu:", partial.coversQcu);
console.log("  classes:", JSON.stringify(partial.classes));

const PENDING = {
  title: "Walang Pasok: Classes Suspended, All Levels",
  body: "Classes at all levels are suspended.",
  effectiveDate: tomorrow, publishedAt: today, reason: "Typhoon signal no. 2",
};
const pending = ctx.window.getQcuSuspensionStatus([PENDING], SCHED_PM, "HIGH");
console.log("\nPENDING →", pending.status, "| effective:", pending.effectiveDate, "| title:", pending.title);
