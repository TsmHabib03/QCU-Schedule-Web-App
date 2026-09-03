// Full-stack persistence test: repository -> adapter -> HTTP -> Apps Script.
//
//   npm run sheets:e2e
//
// Runs the real setup-database.gs inside an emulator (scripts/_apps-script-emulator.mjs)
// behind a real HTTP server, then drives the real repository layer against it.
// Nothing is stubbed on the path under test: dirty tracking, field mapping, HMAC
// signing, envelope verification, snapshot.read and batch.write are all the code
// that ships.
//
// The key thing it proves is that data survives a cold isolate. Repo.reset()
// simulates Cloudflare handing the next request to a fresh isolate with empty
// maps — which is exactly the failure this migration exists to fix.

import { createServer } from "node:http";
import { loadAppsScript } from "./_apps-script-emulator.mjs";
import { loadCatalog, repoRoot } from "./_sheets-client.mjs";
import { Repo, Users, Tasks, Notes, Profiles, Enrollments, EnrollmentSubjects, Schedules, ScheduleEntries, CorRecords, CorDrafts } from "../functions/api/repo/index.js";
import { syncCatalog } from "../functions/api/repo/sheets-adapter.js";

const SECRET = "e2e-test-secret-do-not-use-in-production";
const ACTOR = { googleSub: "e2e_student_001", email: "e2e@qcu.edu.ph" };

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

async function startBridge(gs) {
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const output = gs.doGet({ parameter: Object.fromEntries(url.searchParams) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(output.getContent());
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let content;
      try {
        content = gs.doPost({ postData: { contents: body } }).getContent();
      } catch (error) {
        // A throw that escapes doPost would be a 500 from Google too.
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Apps Script threw: ${error.message}`);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    });
  });

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/exec` };
}

async function main() {
  const gs = await loadAppsScript({ repoRoot, secret: SECRET });
  gs.setupDatabase();
  gs.seedCatalogData();

  const { server, url } = await startBridge(gs);
  const env = { APPS_SCRIPT_URL: url, APPS_SCRIPT_SECRET: SECRET };

  try {
    section("Setup");
    check("34 sheets created", gs.spreadsheet.getSheets().length === 34, String(gs.spreadsheet.getSheets().length));
    check("persistence reports as enabled", Repo.enabled(env) === true);
    check("disabled without a secret", Repo.enabled({ APPS_SCRIPT_URL: url }) === false);

    section("First sign-in");
    Repo.reset();
    const first = await Repo.hydrate(env, ACTOR);
    check("hydrate succeeds", first.hydrated === true, JSON.stringify(first));
    check("new account reported as new", first.isNew === true);

    Users.upsert(ACTOR.googleSub, { email: ACTOR.email, name: "Juan Dela Cruz", picture: "https://x.test/a.png" });
    check("upsert marked one row dirty", Repo.pending() === 1, String(Repo.pending()));
    const login = await Repo.flush(env, ACTOR);
    check("login persisted", login.inserted === 1, JSON.stringify(login));
    check("nothing left pending after flush", Repo.pending() === 0);

    section("Cold isolate: the user comes back");
    Repo.reset();
    const second = await Repo.hydrate(env, ACTOR);
    check("returning account not reported as new", second.isNew === false);
    const restored = Users.getByGoogleSub(ACTOR.googleSub);
    check("user row restored", Boolean(restored), "hydrate returned no Users row");
    check("display name survived", restored?.name === "Juan Dela Cruz", String(restored?.name));
    check("avatar survived", restored?.picture === "https://x.test/a.png", String(restored?.picture));
    check("email survived", restored?.email === ACTOR.email, String(restored?.email));

    section("COR pipeline");
    const corRecord = CorRecords.create({
      ownerUserId: restored.userId, filename: "cor.pdf", originalFilename: "COR 2026.pdf",
      mimeType: "application/pdf", sizeBytes: 84213, contentHash: "deadbeef", status: "ACCEPTED",
    });
    CorDrafts.set(corRecord.id, {
      studentInfo: { firstName: { value: "Juan" }, lastName: { value: "Dela Cruz" } },
      subjects: [{ code: "CS101", title: "Intro to Computing", units: 3 }],
      totalUnits: 3,
    });
    CorRecords.update(corRecord, { status: "REVIEW_REQUIRED", draftVersion: 1 });
    await Repo.flush(env, ACTOR);

    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    const corBack = CorRecords.getById(corRecord.id);
    const draftBack = CorDrafts.get(corRecord.id);
    check("COR record survived", Boolean(corBack));
    check("COR status survived", corBack?.status === "REVIEW_REQUIRED", String(corBack?.status));
    check("original filename survived via extraJson", corBack?.originalFilename === "COR 2026.pdf", String(corBack?.originalFilename));
    check("draft survived", Boolean(draftBack));
    check("draft subject survived", draftBack?.subjects?.[0]?.code === "CS101", JSON.stringify(draftBack?.subjects?.[0]));

    section("Confirm: the whole enrollment graph");
    // Re-read the user after the hydrate above: that call replaced the maps, so
    // the earlier object is now an orphan. Endpoints get this for free because
    // resolveUser() hydrates and then reads the user in the same breath.
    const currentUser = Users.getByGoogleSub(ACTOR.googleSub);
    const userId = currentUser.userId;
    const profile = Profiles.create({
      userId, studentNumber: "21-00123", firstName: "Juan", middleName: "Santos",
      lastName: "Dela Cruz", sourceCorRecordId: corRecord.id,
    });
    const enrollment = Enrollments.create({
      userId, profileId: profile.profileId, termId: "trm_2026_1", programId: "prg_bsit",
      campusId: "cam_sb", sectionLabelSnapshot: "BSIT 3-A", yearLevel: 3,
      studentStatus: "REGULAR", adviserName: "Prof. Reyes", sourceCorRecordId: corRecord.id,
    });
    const ens = EnrollmentSubjects.create({
      enrollmentId: enrollment.enrollmentId, userId, subjectCodeSnapshot: "CS101",
      subjectTitleSnapshot: "Intro to Computing", units: 3, classSection: "BSIT 3-A",
      instructorName: "Prof. Cruz", roomSnapshot: "Room 301",
    });
    const schedule = Schedules.create({ enrollmentId: enrollment.enrollmentId, userId, sourceCorRecordId: corRecord.id });
    const entry = ScheduleEntries.create({
      scheduleId: schedule.scheduleId, enrollmentId: enrollment.enrollmentId, userId,
      enrollmentSubjectId: ens.ensId, dayOfWeek: 1, dayLabel: "Monday",
      startTime: "09:00", endTime: "10:30", locationText: "Room 301", sortOrder: 1,
    });
    Users.update(currentUser, { state: "ACTIVE", corRecordId: corRecord.id });
    CorRecords.update(corRecord, { status: "COMPLETE" });

    check("commit queued as one batch", Repo.pending() === 7, String(Repo.pending()));
    const commit = await Repo.flush(env, ACTOR);
    check("commit applied in a single write", commit.flushed === true && commit.applied === 7, JSON.stringify(commit));

    section("Cold isolate: dashboard data");
    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    const activeEnrollment = Enrollments.getByUserId(userId)[0];
    const activeSchedule = Schedules.getActiveByUserId(userId);
    const entries = ScheduleEntries.getByScheduleId(schedule.scheduleId);
    const subjects = EnrollmentSubjects.getByEnrollmentId(enrollment.enrollmentId);

    check("profile survived", Profiles.getByUserId(userId)?.studentNumber === "21-00123");
    check("enrollment survived", Boolean(activeEnrollment));
    check("enrollment programId survived via extraJson", activeEnrollment?.programId === "prg_bsit", String(activeEnrollment?.programId));
    check("year level kept its type", activeEnrollment?.yearLevel === 3, JSON.stringify(activeEnrollment?.yearLevel));
    check("active schedule found via isActive in extraJson", Boolean(activeSchedule), "getActiveByUserId returned null");
    check("schedule entry survived", entries.length === 1, String(entries.length));
    check("entry time survived", entries[0]?.startTime === "09:00", String(entries[0]?.startTime));
    check("entry dayLabel survived via extraJson", entries[0]?.dayLabel === "Monday", String(entries[0]?.dayLabel));
    check("enrollment subject survived", subjects.length === 1, String(subjects.length));
    check("roomSnapshot survived via extraJson", subjects[0]?.roomSnapshot === "Room 301", String(subjects[0]?.roomSnapshot));
    check("user is ACTIVE after restart", Users.getByGoogleSub(ACTOR.googleSub)?.state === "ACTIVE");

    section("Tasks and notes");
    const task = Tasks.create({ userId, title: "Read chapter 3", priority: "HIGH", enrollmentSubjectId: ens.ensId, dueDate: "2026-09-10" });
    const note = Notes.create({ userId, title: "Lecture notes", body: "Big-O basics", enrollmentSubjectId: ens.ensId });
    await Repo.flush(env, ACTOR);

    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    check("task survived", Tasks.getByUserId(userId).length === 1);
    check("task priority survived", Tasks.getById(task.taskId)?.priority === "HIGH");
    check("task dueDate survived rename to dueAt", Tasks.getById(task.taskId)?.dueDate === "2026-09-10", String(Tasks.getById(task.taskId)?.dueDate));
    check("note survived", Notes.getByUserId(userId).length === 1);
    check("note body survived", Notes.getById(note.noteId)?.body === "Big-O basics");

    section("Update and soft delete");
    Tasks.update(Tasks.getById(task.taskId), { status: "COMPLETED", completedAt: new Date().toISOString() });
    Notes.delete(note.noteId);
    await Repo.flush(env, ACTOR);

    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    check("task update persisted", Tasks.getById(task.taskId)?.status === "COMPLETED");
    check("soft-deleted note hidden from list", Notes.getByUserId(userId).length === 0);
    check("soft-deleted note row still present", Notes.getById(note.noteId)?.status === "DELETED");

    section("Hard delete");
    ScheduleEntries.delete(entry.smeId);
    const removal = await Repo.flush(env, ACTOR);
    check("row removed from the sheet", removal.removed === 1, JSON.stringify(removal));
    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    check("removed entry does not come back", ScheduleEntries.getById(entry.smeId) === null);

    section("Security");
    try {
      await Repo.hydrate({ ...env, APPS_SCRIPT_SECRET: "wrong-secret" }, { googleSub: "attacker" });
      check("a bad signature is rejected", false, "the request was accepted");
    } catch (error) {
      check(`a bad signature is rejected (${error.code})`, error.code === "UNAUTHENTICATED", error.message);
    }

    Repo.reset();
    await Repo.hydrate(env, { googleSub: "e2e_other_002", email: "other@qcu.edu.ph" });
    check("another user sees none of this data", Tasks.getByUserId(userId).length === 0);
    check("and no schedule", Schedules.getActiveByUserId(userId) === null);

    section("Catalog sync");
    const catalog = await loadCatalog();
    const synced = await syncCatalog(env, ACTOR, {
      version: catalog.version,
      campuses: catalog.campuses, departments: catalog.departments, programs: catalog.programs,
      terms: catalog.terms, subjects: catalog.subjects, buildings: catalog.buildings, rooms: catalog.rooms,
    });
    check("subjects written to the catalog sheet", synced.synced?.subjects?.inserted === catalog.subjects.length,
      JSON.stringify(synced.synced?.subjects));
    check("rooms written to the catalog sheet", synced.synced?.rooms?.inserted === catalog.rooms.length,
      JSON.stringify(synced.synced?.rooms));

    const listed = await (async () => {
      const { callAction } = await import("../functions/api/repo/sheets-adapter.js");
      return callAction(env, "catalog.list", ACTOR, { entity: "programs" });
    })();
    check("catalog.list reads them back", listed.total === catalog.programs.length, `${listed.total} vs ${catalog.programs.length}`);

    section("Idempotency");
    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    const t = Tasks.getById(task.taskId);
    Tasks.update(t, { title: "Read chapter 4" });
    await Repo.flush(env, ACTOR);
    Repo.reset();
    await Repo.hydrate(env, ACTOR);
    check("update did not duplicate the row", Tasks.getByUserId(userId).filter((x) => x.taskId === task.taskId).length <= 1);
    check("new title persisted", Tasks.getById(task.taskId)?.title === "Read chapter 4", String(Tasks.getById(task.taskId)?.title));
    check("version incremented by Apps Script", Number(Tasks.getById(task.taskId)?.version) >= 2, String(Tasks.getById(task.taskId)?.version));
  } finally {
    server.close();
  }

  console.log(
    failures
      ? `\n${failures} of ${checks} checks failed.`
      : `\nAll ${checks} checks passed. The persistence path works end to end.`
  );
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nUnexpected failure: ${error.code ? `[${error.code}] ` : ""}${error.message}`);
  console.error(error.stack);
  process.exit(1);
});

