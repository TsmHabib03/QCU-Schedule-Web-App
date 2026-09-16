// Unit tests for the shared day/time normalisers.
//
// These exist because the same value used to mean two different things: COR
// import wrote numeric days (0 = Sunday) and Sheets sometimes returned a real
// datetime for a "08:00" cell, while the class editor wrote "MONDAY"/"08:00".
// Everything that compared the two failed silently — conflict detection never
// fired and the edit form's day picker never preselected the class's real day.

import assert from "node:assert/strict";
import {
  normalizeDayOfWeek,
  normalizeTime,
  isClockTime,
  minutesOfDay,
} from "../functions/api/_lib/day-time.js";

let passed = 0, failed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${label}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${label}\n      ${err.message}`);
  }
}

console.log("\n=== Day of week ===\n");

check("canonical name is returned unchanged", () => {
  assert.equal(normalizeDayOfWeek("MONDAY"), "MONDAY");
});
check("title case and mixed case normalise", () => {
  assert.equal(normalizeDayOfWeek("Monday"), "MONDAY");
  assert.equal(normalizeDayOfWeek("wednesday"), "WEDNESDAY");
});
check("abbreviations normalise", () => {
  assert.equal(normalizeDayOfWeek("Mon"), "MONDAY");
  assert.equal(normalizeDayOfWeek("Tue"), "TUESDAY");
  assert.equal(normalizeDayOfWeek("Thurs"), "THURSDAY");
});
check("the editor's 'Mon (MONDAY)' label normalises", () => {
  assert.equal(normalizeDayOfWeek("Mon (MONDAY)"), "MONDAY");
});
check("numeric days use the COR convention (0 = Sunday)", () => {
  assert.equal(normalizeDayOfWeek(0), "SUNDAY");
  assert.equal(normalizeDayOfWeek(1), "MONDAY");
  assert.equal(normalizeDayOfWeek(6), "SATURDAY");
  assert.equal(normalizeDayOfWeek("6"), "SATURDAY");
});
check("7 is accepted as Sunday", () => {
  assert.equal(normalizeDayOfWeek(7), "SUNDAY");
});
check("garbage is rejected", () => {
  assert.equal(normalizeDayOfWeek("noday"), null);
  assert.equal(normalizeDayOfWeek(""), null);
  assert.equal(normalizeDayOfWeek(null), null);
  assert.equal(normalizeDayOfWeek(9), null);
});

console.log("\n=== Clock time ===\n");

check("HH:mm stays as-is", () => {
  assert.equal(normalizeTime("08:00"), "08:00");
  assert.equal(normalizeTime("23:59"), "23:59");
});
check("single-digit hours are padded", () => {
  assert.equal(normalizeTime("8:00"), "08:00");
  assert.equal(normalizeTime("8:5"), null); // minute must be two digits
});
check("seconds are dropped", () => {
  assert.equal(normalizeTime("08:00:00"), "08:00");
});
check("12-hour input converts", () => {
  assert.equal(normalizeTime("1:00 PM"), "13:00");
  assert.equal(normalizeTime("12:30 AM"), "00:30");
  assert.equal(normalizeTime("12:00 PM"), "12:00");
});
check("Sheets time-of-day datetimes keep their clock part", () => {
  assert.equal(normalizeTime("1899-12-30T00:00:00.000Z"), "00:00");
  assert.equal(normalizeTime("1899-12-30T08:30:00.000Z"), "08:30");
});
check("Sheets day fractions convert", () => {
  assert.equal(normalizeTime(0.3541666666666667), "08:30");
});
check("out-of-range values are rejected", () => {
  assert.equal(normalizeTime("25:00"), null);
  assert.equal(normalizeTime("08:75"), null);
  assert.equal(normalizeTime("later"), null);
});
check("isClockTime only accepts canonical HH:mm", () => {
  assert.equal(isClockTime("08:00"), true);
  assert.equal(isClockTime("8:00"), false);
  assert.equal(isClockTime("24:00"), false);
});
check("minutesOfDay supports overlap maths", () => {
  assert.equal(minutesOfDay("08:30"), 510);
  assert.equal(minutesOfDay("1:00 PM"), 780);
  assert.equal(minutesOfDay("nope"), null);
});

console.log("\n=== Overlap maths (what hasConflict now uses) ===\n");

check("overlapping windows are detected", () => {
  const overlap = (a1, a2, b1, b2) => minutesOfDay(a1) < minutesOfDay(b2) && minutesOfDay(b1) < minutesOfDay(a2);
  assert.equal(overlap("15:30", "16:30", "15:45", "16:45"), true);
  assert.equal(overlap("15:30", "16:30", "16:30", "17:30"), false); // touching is not overlapping
  assert.equal(overlap("08:00", "09:30", "09:00", "10:30"), true);
  assert.equal(overlap("08:00", "09:30", "10:00", "11:30"), false);
});

console.log(`\n=== day-time: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
