// Regression tests for the class editor (Add / Edit / Update class).
//
// The bug these cover: saving an edit failed for reasons the student could not
// see or act on —
//   * the form always re-sent the subject, so a day-only edit ("move my PATHFIT
//     to Monday") died with 422 "Enrollment subject not found" whenever that
//     subject row could not be re-resolved;
//   * a `required` subject select with no options blocked the submit silently;
//   * the day picker never preselected the entry's real day and defaulted to
//     Monday, so classes moved to the wrong day;
//   * conflict detection compared "MONDAY" to a COR numeric day (1) and never
//     matched, so moving a class onto a busy slot was never caught.
//
// Run against a local dev server:  node scripts/dev-server.mjs  (port 8788)
// Override with BASE=http://127.0.0.1:8790

let BASE = process.env.BASE || "";
const SESSION_SECRET = process.env.TEST_SESSION_SECRET || "local-admin-regression-test-secret";

// ── Server bootstrap ────────────────────────────────────────────────────
// Needs the dev server (scripts/dev-server.mjs). Start one automatically when
// an isolated free port, so an existing development server's credentials and
// database cannot affect the fixtures; BASE explicitly opts into another server.

async function serverIsUp() {
  try {
    const res = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let spawned = null;

async function ensureServer() {
  if (process.env.BASE) {
    if (await serverIsUp()) return;
    console.error(`\nNo dev server responding at ${BASE} (BASE is set, so nothing was started).\n`);
    process.exit(1);
  }

  const { createServer } = await import("node:http");
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  BASE = `http://127.0.0.1:${port}`;
  const { spawn } = await import("node:child_process");
  spawned = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      APPS_SCRIPT_URL: "",
      APPS_SCRIPT_SECRET: "",
      GOOGLE_SESSION_SECRET: SESSION_SECRET,
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (await serverIsUp()) return;
  }

  spawned.kill();
  console.error("\nThe dev server did not come up within 25s.\n");
  process.exit(1);
}

await ensureServer();

// ── Session sealing (mirrors functions/api/auth/_lib.js) ────────────────

function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function seal(value, secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return encodeBytes(iv) + "." + encodeBytes(new Uint8Array(encrypted));
}

const STUDENT = { googleSub: "synthetic_student_a" };

async function api(method, path, cookie, body) {
  const opts = { method, headers: { Origin: BASE, Cookie: `qcu_platform_session=${cookie}` } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}${detail ? `\n      ${JSON.stringify(detail)}` : ""}`);
  }
}

const cookie = await seal(
  { googleSub: STUDENT.googleSub, issuedAt: Date.now(), sessionExpiresAt: Date.now() + 3_600_000 },
  SESSION_SECRET
);

const created = [];

async function createEntry(body) {
  const res = await api("POST", "/api/v1/schedule/entries", cookie, body);
  if (res.data?.data?.entryId) created.push(res.data.data.entryId);
  return res;
}

function cleanup() {
  return Promise.all(created.map((id) => api("DELETE", `/api/v1/schedule/entries/${id}`, cookie)));
}

// ── Fixtures ────────────────────────────────────────────────────────────

const dash = await api("GET", "/api/v1/dashboard", cookie);
const subjects = dash.data?.academic?.enrollmentSubjects || [];
const subjectId = subjects[0]?.enrollmentSubjectId;
const subjectCode = subjects[0]?.subjectCode;

console.log("\n=== Class editor: create ===\n");

assert("dashboard exposes enrollment subjects to the picker", subjects.length > 0, {
  count: subjects.length,
});

const fresh = await createEntry({
  enrollmentSubjectId: subjectId,
  dayOfWeek: "SATURDAY",
  startTime: "14:00",
  endTime: "15:30",
  instructorName: "  Prof. Maria Reyes  ",
  modality: "ONSITE",
});

assert("a class can be created", fresh.status === 201 && fresh.data?.ok === true, fresh);
assert("the created class reports its subject code", Boolean(fresh.data?.data?.code), fresh.data?.data);
assert("professor is trimmed and returned", fresh.data?.data?.instructor === "Prof. Maria Reyes", fresh.data?.data);
const professorPath = `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`;
const renamedProfessor = await api("PATCH", professorPath, cookie, { instructorName: "Prof. <Cruz>" });
assert("professor can be edited", renamedProfessor.data?.data?.instructor === "Prof. <Cruz>", renamedProfessor);
const professorDash = await api("GET", "/api/v1/dashboard", cookie);
assert("dashboard returns the saved professor", professorDash.data?.entries?.find(e => e.entryId === fresh.data?.data?.entryId)?.instructor === "Prof. <Cruz>", professorDash.data);
const professorList = await api("GET", "/api/v1/schedule", cookie);
const listedEntry = professorList.data?.data?.entries?.find(e => e.entryId === fresh.data?.data?.entryId);
assert("schedule list returns professor and subject snapshot", listedEntry?.instructor === "Prof. <Cruz>" && listedEntry?.code === subjectCode && listedEntry?.title === fresh.data?.data?.title, professorList.data);
const preservedProfessor = await api("PATCH", professorPath, cookie, { locationText: "Room 301" });
assert("other edits preserve the professor", preservedProfessor.data?.data?.instructor === "Prof. <Cruz>", preservedProfessor);
for (const instructorName of ["x".repeat(121), { name: "Prof. Invalid" }]) {
  const invalidProfessor = await api("PATCH", professorPath, cookie, { instructorName });
  assert("invalid professor is rejected", invalidProfessor.status === 422, invalidProfessor);
}
const clearedProfessor = await api("PATCH", professorPath, cookie, { instructorName: "" });
assert("professor can be cleared", clearedProfessor.data?.data?.instructor === "", clearedProfessor);

const numeric = await createEntry({
  enrollmentSubjectId: subjectId,
  dayOfWeek: 6,
  startTime: "4:00 PM",
  endTime: "5:30 PM",
  modality: "ONSITE",
});

assert("numeric days and 12-hour times are accepted", numeric.status === 201, numeric);
assert("a numeric day is stored canonically", numeric.data?.data?.dayOfWeek === "SATURDAY", numeric.data?.data);
assert('"4:00 PM" is stored as 16:00', numeric.data?.data?.startTime === "16:00", numeric.data?.data);

const byCode = await createEntry({
  enrollmentSubjectId: subjectCode,
  dayOfWeek: "SUNDAY",
  startTime: "07:00",
  endTime: "08:00",
  modality: "ONLINE",
});

assert("a subject code resolves to the enrollment subject", byCode.status === 201 && byCode.data?.ok, byCode);
assert("the code resolves to the real enrollment subject id", byCode.data?.data?.enrollmentSubjectId === subjectId, byCode.data?.data);

console.log("\n=== Class editor: update ===\n");

const moved = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  cookie,
  { dayOfWeek: "MONDAY", startTime: "18:00", endTime: "19:30" }
);

assert("a day-only edit succeeds when the subject is not sent", moved.status === 200 && moved.data?.ok === true, moved);
assert("the class actually moved to Monday", moved.data?.data?.dayOfWeek === "MONDAY", moved.data?.data);
assert("the time change is stored", moved.data?.data?.startTime === "18:00" && moved.data?.data?.endTime === "19:30", moved.data?.data);
assert("the subject is preserved by a day-only edit", moved.data?.data?.enrollmentSubjectId === subjectId, moved.data?.data);

const staleSubject = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  cookie,
  { enrollmentSubjectId: "ens_that_does_not_exist", dayOfWeek: "TUESDAY", startTime: "20:00", endTime: "21:00" }
);

assert(
  "an unresolvable subject is rejected while the class's own subject is known",
  staleSubject.status === 422,
  staleSubject
);

const unchangedSubject = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  cookie,
  { enrollmentSubjectId: subjectId, dayOfWeek: "TUESDAY", startTime: "20:00", endTime: "21:00" }
);

assert("re-sending the class's own subject is fine", unchangedSubject.status === 200 && unchangedSubject.data?.ok, unchangedSubject);
assert("the class kept its real subject", unchangedSubject.data?.data?.enrollmentSubjectId === subjectId, unchangedSubject.data?.data);

const subjectSwap = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  cookie,
  { enrollmentSubjectId: subjects[1]?.enrollmentSubjectId }
);

assert(
  "changing the subject on purpose still works",
  subjectSwap.status === 200 && subjectSwap.data?.data?.enrollmentSubjectId === subjects[1]?.enrollmentSubjectId,
  subjectSwap
);

console.log("\n=== Conflict detection ===\n");

const overlap = await createEntry({
  enrollmentSubjectId: subjectId,
  dayOfWeek: "Saturday",
  startTime: "16:00",
  endTime: "17:00",
  modality: "ONSITE",
});

assert("creating an overlapping class is rejected", overlap.status === 409, overlap);
assert("the conflict names the clashing class", Boolean(overlap.data?.error?.conflicts?.length), overlap.data?.error);
assert("the conflicting slot is normalised", overlap.data?.error?.conflicts?.[0]?.dayOfWeek === "SATURDAY", overlap.data?.error);

const overlapPatch = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  cookie,
  { dayOfWeek: "SATURDAY", startTime: "16:15", endTime: "16:45" }
);

assert("moving a class onto a busy slot is rejected", overlapPatch.status === 409, overlapPatch);
assert(
  "the overlap is detected on the right day",
  overlapPatch.data?.error?.conflicts?.[0]?.dayOfWeek === "SATURDAY",
  overlapPatch.data?.error
);

const touching = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  cookie,
  { dayOfWeek: "SATURDAY", startTime: "15:30", endTime: "16:00" }
);

assert("back-to-back classes are allowed", touching.status === 200 && touching.data?.ok === true, touching);

console.log("\n=== Duplicate handling ===\n");

// An exact copy of an existing class must be reported as a duplicate (with the
// row to delete), not as an overlap with a different class — that message sent
// students hunting for a clash with a class they believed was the same one.
const dupSource = await createEntry({
  enrollmentSubjectId: subjectId,
  dayOfWeek: "SUNDAY",
  startTime: "20:00",
  endTime: "21:30",
  modality: "ONSITE",
});

const dupCopy = await createEntry({
  enrollmentSubjectId: subjectId,
  dayOfWeek: "SUNDAY",
  startTime: "20:00",
  endTime: "21:30",
  modality: "ONSITE",
});

assert("an identical class is rejected", dupCopy.status === 409, dupCopy);
assert("it is reported as a duplicate, not an overlap", dupCopy.data?.error?.code === "DUPLICATE", dupCopy.data?.error);
assert("the duplicate names the row to remove", Boolean(dupCopy.data?.error?.duplicateEntryId), dupCopy.data?.error);
assert(
  "the message explains the fix",
  /duplicate/i.test(dupCopy.data?.error?.message || ""),
  dupCopy.data?.error
);

const overlapOther = await createEntry({
  enrollmentSubjectId: subjects[1]?.enrollmentSubjectId,
  dayOfWeek: "SUNDAY",
  startTime: "21:00",
  endTime: "22:00",
  modality: "ONSITE",
});

assert("a real clash with another class is still an overlap", overlapOther.data?.error?.code === "SCHEDULE_CONFLICT", overlapOther.data?.error);
assert(
  "the overlap message names the day and time",
  /SUNDAY 20:00-21:30/.test(overlapOther.data?.error?.message || ""),
  overlapOther.data?.error
);

console.log("\n=== Ownership ===\n");

const otherCookie = await seal(
  { googleSub: "synthetic_student_b", issuedAt: Date.now(), sessionExpiresAt: Date.now() + 3_600_000 },
  SESSION_SECRET
);

const foreign = await api(
  "PATCH",
  `/api/v1/schedule/entries/${fresh.data?.data?.entryId}`,
  otherCookie,
  { dayOfWeek: "MONDAY" }
);

assert("another student cannot edit this class", foreign.status === 404, foreign);

await cleanup();

if (spawned) spawned.kill();

console.log(`\n=== schedule-crud: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
