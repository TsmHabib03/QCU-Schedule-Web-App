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
  parsePrintedTime,
  readTimeRange,
  splitTimeRangeText,
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
check("Sheets time-of-day datetimes are read as the CAMPUS clock", () => {
  // A time-of-day cell is an instant on the 1899 epoch in the spreadsheet's
  // timezone and the Apps Script serialises it with toISOString(), so the string's
  // clock part is campus wall time MINUS the offset. Keeping that clock part (the
  // old behaviour) turned a 1:00 PM class into "05:00" and the student saw 5:00 AM
  // — the exact shape of "the class time is AM, not what my COR says". Verified
  // against the live sheet: writing "13:00" reads back "1899-12-30T05:00:00.000Z".
  assert.equal(normalizeTime("1899-12-30T05:00:00.000Z"), "13:00");
  assert.equal(normalizeTime("1899-12-30T06:30:00.000Z"), "14:30");
  assert.equal(normalizeTime("1899-12-29T23:30:00.000Z"), "07:30");
  assert.equal(normalizeTime("1899-12-30T00:00:00.000Z"), "08:00");
  assert.equal(minutesOfDay("1899-12-30T05:00:00.000Z"), 13 * 60);
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

console.log("\n=== Printed class times (the COR's own notation) ===\n");
// A COR prints a window like "1:00-2:30 PM": the marker belongs to the RANGE, not
// to the second time. Reading each value on its own stored afternoon classes as
// 01:00-14:30 — a 13.5-hour class that also tripped every overlap check — and a
// bare "1:00-2:30" was silently assumed to be morning. Neither is allowed: the
// pipeline spec forbids inferring AM/PM, so a window with no marker anywhere is
// reported instead.

check("a marker on both times is trusted", () => {
  assert.deepEqual(readTimeRange("7:30AM", "9:00AM"), { start: "07:30", end: "09:00", sourceText: "7:30AM - 9:00AM", unresolved: false });
  assert.deepEqual(readTimeRange("1:00 PM", "2:30 PM").start, "13:00");
});

check("a marker printed once for the window applies to both times", () => {
  assert.deepEqual(readTimeRange("1:00", "2:30 PM"), { start: "13:00", end: "14:30", sourceText: "1:00 - 2:30 PM", unresolved: false });
  assert.deepEqual(readTimeRange("2:00", "3:30 PM").start, "14:00");
  assert.deepEqual(readTimeRange("9:00", "10:30 AM").start, "09:00");
  assert.deepEqual(readTimeRange("7:30", "9:00AM").end, "09:00");
});

check("a shared marker never pushes a window backwards", () => {
  assert.equal(readTimeRange("11:00", "1:00 PM").start, "11:00"); // not 23:00
  assert.equal(readTimeRange("11:00", "1:00 PM").end, "13:00");
  assert.equal(readTimeRange("11:45", "12:30 PM").start, "11:45");
});

check("the noon boundary reads correctly", () => {
  assert.deepEqual(readTimeRange("12:00", "1:30 PM"), { start: "12:00", end: "13:30", sourceText: "12:00 - 1:30 PM", unresolved: false });
  assert.equal(readTimeRange("12:30", "2:00 PM").start, "12:30");
});

check("24-hour and 4-digit printed times carry their own period", () => {
  assert.equal(readTimeRange("13:00", "14:30").start, "13:00");
  assert.deepEqual(readTimeRange("0900", "1030"), { start: "09:00", end: "10:30", sourceText: "0900 - 1030", unresolved: false });
  assert.equal(readTimeRange("13:00", "2:30").end, "14:30"); // the 24-hour side lends its period
});

check("a window with no marker anywhere is reported, never guessed", () => {
  for (const [from, to] of [["1:00", "2:30"], ["8:00", "10:00"], ["12:30", "2:00"]]) {
    const read = readTimeRange(from, to);
    assert.equal(read.unresolved, true, `${from}-${to} must not resolve`);
    assert.equal(read.start, null, `${from}-${to} must not invent a start`);
    assert.equal(read.end, null, `${from}-${to} must not invent an end`);
  }
});

check("a window that cannot run forward is reported", () => {
  assert.equal(readTimeRange("2:30 PM", "1:00 PM").unresolved, true);
  assert.equal(readTimeRange("10:00 AM", "10:00 AM").unresolved, true);
});

check("unreadable text stays unreadable", () => {
  assert.equal(readTimeRange("nonsense", "more nonsense").unresolved, true);
  assert.equal(readTimeRange(null, null).start, null);
  assert.equal(parsePrintedTime("nope"), null);
});

check("printed time text is split on the separator only", () => {
  assert.deepEqual(splitTimeRangeText("1:00-2:30 PM"), ["1:00", "2:30 PM"]);
  assert.deepEqual(splitTimeRangeText("7:30AM-9:00AM"), ["7:30AM", "9:00AM"]);
  assert.deepEqual(splitTimeRangeText("1:00 PM - 2:30 PM"), ["1:00 PM", "2:30 PM"]);
  assert.deepEqual(splitTimeRangeText("1:00 PM to 2:30 PM"), ["1:00 PM", "2:30 PM"]);
  assert.deepEqual(splitTimeRangeText("0900-1030"), ["0900", "1030"]);
  assert.deepEqual(splitTimeRangeText(""), [null, null]);
});

check("the first two clock times are the window, whatever else the cell holds", () => {
  // A COR cell carries the days, a second window, or a stray note; splitting on "-"
  // alone read "M/W 09:00" as a time and gave up on the rest of the line.
  assert.deepEqual(splitTimeRangeText("M/W 09:00-10:30"), ["09:00", "10:30"]);
  assert.deepEqual(splitTimeRangeText("7:30-9:00AM / 10:00-11:30AM"), ["7:30", "9:00AM"]);
  assert.deepEqual(splitTimeRangeText("8.00 AM - 9.30 AM"), ["8.00 AM", "9.30 AM"]);
  // A year or a room number is not a clock time.
  assert.deepEqual(splitTimeRangeText("1899-12-30T08:30:00.000Z - 1899-12-30T09:30:00.000Z"), ["08:30", "09:30"]);
  assert.equal(readTimeRange(...splitTimeRangeText("room 502")).unresolved, true, "a room number is not a window");
});

check("a printed time knows whether it settled AM/PM", () => {
  assert.equal(parsePrintedTime("1:00").unambiguous, false);
  assert.equal(parsePrintedTime("1:00 PM").unambiguous, true);
  assert.equal(parsePrintedTime("13:00").unambiguous, true);
  assert.equal(parsePrintedTime("0900").unambiguous, true);
  assert.equal(parsePrintedTime("1:00").printedHour, 1);
  assert.equal(parsePrintedTime(0.3541666666666667).unambiguous, true); // a Sheets time cell
});

check("4-digit blocks are readable clock times", () => {
  assert.equal(normalizeTime("0900"), "09:00");
  assert.equal(normalizeTime("1330"), "13:30");
  assert.equal(normalizeTime("2460"), null);
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
