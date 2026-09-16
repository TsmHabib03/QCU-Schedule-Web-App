// Time-cell regression guard.
//
//   node scripts/test-time-cells.mjs
//
// Google Sheets stores a typed value, not the string you hand it: writing
// "08:00" into a general-format cell turns it into a time value on the 1899
// epoch, and the Apps Script's rowToObject used to serialise that with
// toISOString() — so the API handed the client "1899-12-30T00:00:00.000Z"
// (Manila is UTC+8). No parser could turn that back into 08:00, which is why
// every class rendered without a time and the weekly total showed "Hours 0".
//
// This suite runs the real setup-database.gs in the emulator and pins both
// halves of the fix: the columns must be locked to plain text, and any value
// that still arrives as a Date must be repaired into "HH:mm" on read.

import { loadAppsScript } from "./_apps-script-emulator.mjs";
import { repoRoot } from "./_sheets-client.mjs";

const SECRET = "time-cell-test-secret";
const TIME_RE = /^\d{2}:\d{2}$/;

let failures = 0;
let checks = 0;
function check(label, condition, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

const gs = await loadAppsScript({ repoRoot, secret: SECRET });
gs.setupDatabase();

section("The emulator models Sheets coercion");
const probe = gs.spreadsheet.insertSheet("TimeProbe");
probe.getRange(1, 1, 1, 1).setValues([["08:00"]]);
check(
  "a general-format column coerces \"08:00\" into a date",
  probe.getRange(1, 1, 1, 1).getValues()[0][0] instanceof Date,
  String(probe.getRange(1, 1, 1, 1).getValues()[0][0])
);
probe.getRange(1, 2, 1, 1).setNumberFormat("@");
probe.getRange(1, 2, 1, 1).setValues([["08:00"]]);
check(
  "a text-formatted column keeps the string",
  probe.getRange(1, 2, 1, 1).getValues()[0][0] === "08:00",
  JSON.stringify(probe.getRange(1, 2, 1, 1).getValues()[0][0])
);

section("setupDatabase locks the time columns to text");
const entries = gs.spreadsheet.getSheetByName("Schedule_Entries");
const header = entries.getRange(1, 1, 1, entries.getLastColumn()).getValues()[0].map(String);
for (const column of ["startTime", "endTime"]) {
  const format = entries._colFormats[header.indexOf(column)];
  check(`${column} is formatted as plain text`, format === "@", String(format));
}
const drafts = gs.spreadsheet.getSheetByName("COR_Draft_Meetings");
const draftHeader = drafts.getRange(1, 1, 1, drafts.getLastColumn()).getValues()[0].map(String);
check(
  "sourceStartTime is formatted as plain text",
  drafts._colFormats[draftHeader.indexOf("sourceStartTime")] === "@",
  String(drafts._colFormats[draftHeader.indexOf("sourceStartTime")])
);

section("Values already stored as times are repaired on read");
const row = header.map(() => "");
row[header.indexOf("scheduleEntryId")] = "sme_time_probe";
row[header.indexOf("startTime")] = new Date(1899, 11, 30, 8, 0, 0);
row[header.indexOf("endTime")] = new Date(1899, 11, 30, 9, 30, 0);
row[header.indexOf("createdAt")] = new Date("2026-09-03T04:15:00.000Z");
const [object] = [gs.rowToObject(header, row)];
check("startTime reads as HH:mm", object.startTime === "08:00", JSON.stringify(object.startTime));
check("endTime reads as HH:mm", object.endTime === "09:30", JSON.stringify(object.endTime));
check(
  "instant columns still serialise as ISO",
  object.createdAt === "2026-09-03T04:15:00.000Z",
  JSON.stringify(object.createdAt)
);
check(
  "confidenceTime (a number, not a clock) is left alone",
  gs.rowToObject(["confidenceTime"], [0.85]).confidenceTime === 0.85
);

section("Repair pass rewrites stored dates");
entries.getRange(2, header.indexOf("startTime") + 1, 1, 1).setValues([[new Date(1899, 11, 30, 13, 45, 0)]]);
const repaired = gs.ensureTimeCellsAreText(gs.spreadsheet);
check("ensureTimeCellsAreText repaired the cell", repaired === 1, String(repaired));
check(
  "the stored value is now the string \"13:45\"",
  entries.getRange(2, header.indexOf("startTime") + 1, 1, 1).getValues()[0][0] === "13:45",
  JSON.stringify(entries.getRange(2, header.indexOf("startTime") + 1, 1, 1).getValues()[0][0])
);

console.log(
  failures
    ? `\n${failures} of ${checks} checks failed.`
    : `\nAll ${checks} time-cell checks passed.`
);
process.exit(failures ? 1 : 0);
