// Round-trip check for the Google Sheets field mapping.
//
//   node scripts/test-sheets-mapping.mjs
//
// Every repository object must survive toRow() -> fromRow() unchanged. The
// mapping renames some fields and packs the rest into extraJson, so a silent
// drop here would surface much later as a missing value on the dashboard.
// Runs offline: no Apps Script deployment or network access required.

import { ENTITIES, SNAPSHOT_KINDS, fromRow, toRow } from "../functions/api/repo/sheets-adapter.js";

const ts = "2026-09-03T04:15:00.000Z";
const USER_ID = "user_1234567890";

const samples = {
  users: {
    userId: USER_ID,
    googleSub: "1234567890",
    email: "student@qcu.edu.ph",
    name: "Juan Dela Cruz",
    picture: "https://example.test/avatar.png",
    state: "ACTIVE",
    role: "student",
    profile: { studentNumber: "21-0001" },
    corRecordId: "cor_abc",
    createdAt: ts,
    updatedAt: ts,
    lastLoginAt: ts,
  },
  profiles: {
    profileId: "prf_1", userId: USER_ID, studentNumber: "21-0001",
    firstName: "Juan", middleName: "Santos", lastName: "Dela Cruz", suffix: null,
    preferredName: null, verificationStatus: "COR_REVIEWED", sourceCorRecordId: "cor_abc",
    status: "ACTIVE", createdAt: ts, updatedAt: ts,
  },
  corRecords: {
    id: "cor_abc", ownerUserId: USER_ID, filename: "cor.pdf", originalFilename: "cor.pdf",
    mimeType: "application/pdf", sizeBytes: 51200, contentHash: "abc123", status: "REVIEW_REQUIRED",
    pipelineVersion: "gemini-1", extractionSchemaVersion: "1", attemptNumber: 1, draftVersion: 1,
    failureCode: null, failureStage: null, createdAt: ts, updatedAt: ts,
  },
  corDrafts: {
    corRecordId: "cor_abc", ownerUserId: USER_ID, draftVersion: 1, status: "ACTIVE",
    draft: { studentNumber: "21-0001", subjects: [{ code: "CS101", units: 3 }] },
  },
  enrollments: {
    enrollmentId: "enr_1", userId: USER_ID, profileId: "prf_1", termId: "trm_1",
    programId: "prg_bsit", campusId: "cam_sb", offeringId: null, sectionId: null,
    sectionLabelSnapshot: "BSIT 3-A", yearLevel: 3, studentStatus: "REGULAR",
    dateEnrolled: "2026-08-01", adviserName: "Prof. Reyes", sourceType: "COR_IMPORT",
    sourceCorRecordId: "cor_abc", status: "ACTIVE", createdAt: ts, updatedAt: ts,
  },
  enrollmentSubjects: {
    ensId: "ens_1", enrollmentId: "enr_1", userId: USER_ID, subjectId: "sub_cs101",
    subjectCodeSnapshot: "CS101", subjectTitleSnapshot: "Intro to Computing", units: 3,
    classSection: "BSIT 3-A", instructorName: "Prof. Cruz", matchedSubjectId: "sub_cs101",
    matchedRoomId: "rm_1", matchedBuildingId: "bld_1", roomSnapshot: "Room 301",
    sourceType: "COR_IMPORT", sourceCorDraftSubjectId: "cds_1", scheduleStatus: "ACTIVE",
    status: "ACTIVE", createdAt: ts, updatedAt: ts,
  },
  schedules: {
    scheduleId: "sch_1", enrollmentId: "enr_1", userId: USER_ID, revisionNumber: 1,
    name: "Official Schedule", isActive: true, sourceType: "COR_IMPORT",
    sourceCorRecordId: "cor_abc", revisionReason: null, scheduleStatus: "ACTIVE",
    status: "ACTIVE", activatedAt: ts, archivedAt: null, createdAt: ts, updatedAt: ts,
  },
  scheduleEntries: {
    smeId: "sme_1", scheduleId: "sch_1", enrollmentId: "enr_1", userId: USER_ID,
    enrollmentSubjectId: "ens_1", dayOfWeek: 1, dayLabel: "Monday", startTime: "09:00",
    endTime: "10:30", modality: "ONSITE", buildingId: "bld_1", roomId: "rm_1",
    locationText: "Room 301", effectiveFrom: null, effectiveTo: null, sortOrder: 0,
    sourceCorDraftMeetingId: "cdm_1", originType: "COR_IMPORT", status: "ACTIVE",
    createdAt: ts, updatedAt: ts,
  },
  tasks: {
    taskId: "tsk_1", userId: USER_ID, title: "Read chapter 3", description: "Pages 40-70",
    priority: "HIGH", status: "OPEN", subjectId: "sub_cs101", enrollmentSubjectId: "ens_1",
    scheduleEntryId: "sme_1", dueDate: "2026-09-10", completedAt: null, deletedAt: null,
    createdAt: ts, updatedAt: ts,
  },
  notes: {
    noteId: "nt_1", userId: USER_ID, title: "Lecture notes", body: "Big-O basics",
    subjectId: "sub_cs101", enrollmentSubjectId: "ens_1", scheduleEntryId: "sme_1",
    status: "ACTIVE", deletedAt: null, createdAt: ts, updatedAt: ts,
  },
};

let failures = 0;

// Columns the sheet adapter rewrites on read, with the test's own sample value
// proving the rewrite happened (a numeric day becomes its canonical name).
const NORMALISED_COLUMNS = new Set(["dayOfWeek", "startTime", "endTime"]);

function fail(message) {
  failures++;
  console.error(`  FAIL ${message}`);
}

for (const kind of SNAPSHOT_KINDS) {
  const original = samples[kind];
  if (!original) {
    fail(`${kind}: no sample defined in this test`);
    continue;
  }

  const row = toRow(kind, original);
  // Apps Script hands back null for an empty cell; emulate that so the test
  // exercises the same values production will see.
  const emulated = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v === undefined ? null : v])
  );
  const restored = fromRow(kind, emulated);

  const lost = [];
  const changed = [];
  for (const [key, value] of Object.entries(original)) {
    if (!(key in restored)) {
      lost.push(key);
    } else if (JSON.stringify(restored[key]) !== JSON.stringify(value)) {
      // Schedule entries are canonicalised on read on purpose: the COR import
      // wrote numeric days (0 = Sunday) and Sheets can return a real datetime
      // for a "08:00" cell, while every consumer compares "MONDAY"/"HH:mm".
      // Any other column changing shape is still a bug.
      if (kind === "scheduleEntries" && NORMALISED_COLUMNS.has(key)) continue;
      changed.push(`${key}: ${JSON.stringify(value)} -> ${JSON.stringify(restored[key])}`);
    }
  }

  if (lost.length) fail(`${kind}: dropped ${lost.join(", ")}`);
  if (changed.length) fail(`${kind}: altered ${changed.join("; ")}`);

  // The canonicalisation those skips allow must actually be happening — a
  // numeric COR day has to come back as a name, or conflict checks and the day
  // picker silently compare the wrong things again.
  if (kind === "scheduleEntries") {
    if (restored.dayOfWeek !== "MONDAY") {
      fail(`scheduleEntries: numeric day was not canonicalised (got ${JSON.stringify(restored.dayOfWeek)})`);
    }
    if (restored.startTime !== "09:00" || restored.endTime !== "10:30") {
      fail(`scheduleEntries: times were not canonicalised (${restored.startTime}–${restored.endTime})`);
    }
  }

  // The sheet's primary key column must be populated, or the row cannot be
  // located again and every write would append a duplicate.
  const spec = ENTITIES[kind];
  const pkColumn = spec ? spec.sheetId : "corRecordId";
  if (!row[pkColumn]) fail(`${kind}: primary key column ${pkColumn} is empty`);

  if (!lost.length && !changed.length && row[pkColumn]) {
    const extras = row.extraJson ? Object.keys(JSON.parse(row.extraJson)).length : 0;
    console.log(`  ok   ${kind.padEnd(19)} ${Object.keys(row).length} columns, ${extras} field(s) in extraJson`);
  }
}

// The live sheet hands time-of-day cells back as ISO instants on the 1899 epoch.
// Verified against production with a throwaway row: writing startTime "13:00"
// reads back "1899-12-30T05:00:00.000Z". The adapter must return the CAMPUS clock
// for that instant (13:00), not the string's own UTC clock (05:00) — keeping the
// clock part is what showed students a 1:00 PM class as 5:00 AM.
const coerced = fromRow("scheduleEntries", {
  scheduleEntryId: "sme_coerced", scheduleId: "sch_1", ownerUserId: USER_ID,
  dayOfWeek: "MONDAY", startTime: "1899-12-30T05:00:00.000Z", endTime: "1899-12-30T06:30:00.000Z",
  status: "ACTIVE", createdAt: ts, updatedAt: ts,
});
if (coerced.startTime !== "13:00" || coerced.endTime !== "14:30") {
  fail(`a Sheets time cell was not read as the campus clock (${coerced.startTime}–${coerced.endTime})`);
} else {
  console.log("  ok   a coerced time cell reads back as the campus clock (13:00–14:30)");
}

console.log(failures ? `\n${failures} mapping problem(s) found.` : "\nAll entity mappings round-trip cleanly.");
process.exit(failures ? 1 : 0);
