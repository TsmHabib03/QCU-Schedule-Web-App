// Account-state and schedule-resolution regression tests.
//
//   npm run test:accounts
//
// Two failures this guards against, both reported from production:
//
//  1. "I deleted the user but they can still sign in and their data is still
//     there." The database refuses CLOSED/SUSPENDED identities, and the Worker
//     now refuses them independently as well; this proves a purged account
//     cannot resolve a session, keeps no data, and that the tombstone survives.
//
//  2. "My schedule is wrong / it shows the altered one, not my COR." A sheet can
//     hold several active schedules after repeated COR imports; the current one
//     must be the newest revision, not whichever row happens to come first.

import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { loadAppsScript } from "./_apps-script-emulator.mjs";
import { repoRoot } from "./_sheets-client.mjs";
import { Repo, Users, Enrollments, Schedules, ScheduleEntries, EnrollmentSubjects } from "../functions/api/repo/index.js";
import { resolveUser } from "../functions/api/auth/_lib.js";
import { onRequestGet as bootstrapGet } from "../functions/api/v1/bootstrap.js";
import { onRequestGet as dashboardGet } from "../functions/api/v1/dashboard.js";
import { onRequestGet as onboardingStatusGet } from "../functions/api/v1/onboarding/status.js";

const SECRET = "account-gate-test-secret";
const SESSION_SECRET = "account-gate-session-secret";
const STUDENT = { googleSub: "gate_student_001", email: "student@qcu.edu.ph" };
const ADMIN_GOOGLE_SUB = "gate_admin_001";

let checks = 0, failures = 0;
function check(label, condition, detail = "") {
  checks++;
  if (condition) console.log(`  ok    ${label}`);
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function section(title) { console.log(`\n=== ${title} ===`); }

async function startBridge(gs) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let content;
      try { content = gs.doPost({ postData: { contents: body } }).getContent(); }
      catch (error) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end(`Apps Script threw: ${error.message}`); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/exec` };
}

// Mirrors functions/api/auth/_lib.js sealing so resolveUser() can read it.
async function sealSession(identity) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SESSION_SECRET));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(identity));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
  return `${b64(iv)}.${b64(cipher)}`;
}

async function callEndpoint(handler, env, cookie, path) {
  const response = await handler(contextFor(env, cookie, path));
  return { status: response.status, body: await response.json().catch(() => null) };
}

function contextFor(env, cookie, path = "/api/v1/dashboard") {
  const request = new Request(`https://portal.test${path}`, { headers: cookie ? { Cookie: `qcu_platform_session=${cookie}` } : {} });
  return { request, env, data: {} };
}

const gs = await loadAppsScript({ repoRoot, secret: SECRET, properties: { ADMIN_GOOGLE_SUB } });
gs.setupDatabase();
gs.seedCatalogData();
const { server, url } = await startBridge(gs);
const env = { APPS_SCRIPT_URL: url, APPS_SCRIPT_SECRET: SECRET, GOOGLE_SESSION_SECRET: SESSION_SECRET };

try {
  section("Sign-in baseline");
  Repo.reset();
  await Repo.hydrate(env, STUDENT);
  const user = Users.upsert(STUDENT.googleSub, { email: STUDENT.email, name: "Gate Student" });
  // Legacy shape: the account is ACTIVE (this is exactly what the old flow left
  // behind) but it owns no schedule, so the dashboard has nothing to show.
  user.state = "ACTIVE";
  Users.upsert(STUDENT.googleSub, { email: STUDENT.email, name: "Gate Student" });
  const enrollment = Enrollments.create({ userId: user.userId, status: "ACTIVE" });
  const ens = EnrollmentSubjects.create({ enrollmentId: enrollment.enrollmentId, userId: user.userId, subjectCode: "CS101", subjectName: "Intro", units: 3, status: "ACTIVE" });
  // Persist the account before anything is checked: the endpoints under test read
  // it back through hydrate, exactly as production does.
  await Repo.flush(env, STUDENT);

  section("Active account with no classes is sent back to onboarding");
  const cookieEarly = await sealSession({ googleSub: STUDENT.googleSub, email: STUDENT.email, emailVerified: true, issuedAt: Date.now(), sessionExpiresAt: Date.now() + 3_600_000 });
  Repo.reset();
  await Repo.hydrate(env, STUDENT);

  const routingBefore = await callEndpoint(bootstrapGet, env, cookieEarly, "/api/v1/bootstrap");
  check("bootstrap routes to onboarding", routingBefore.body?.routing === "onboarding", JSON.stringify(routingBefore.body?.routing));

  const dashBefore = await callEndpoint(dashboardGet, env, cookieEarly, "/api/v1/dashboard");
  check("dashboard refuses to render an empty week", dashBefore.status === 409 && dashBefore.body?.status === "ONBOARDING_REQUIRED", `${dashBefore.status} ${JSON.stringify(dashBefore.body)}`);
  check("the refusal tells the client where to go", dashBefore.body?.routing === "onboarding");

  const statusBefore = await callEndpoint(onboardingStatusGet, env, cookieEarly, "/api/v1/onboarding/status");
  check("onboarding reports the import step, not COMPLETE", statusBefore.body?.stage === "UPLOAD", JSON.stringify(statusBefore.body?.stage));

  // Two active schedules: the legacy shape left behind by earlier imports.
  const older = Schedules.create({ scheduleId: "sch_older", enrollmentId: enrollment.enrollmentId, userId: user.userId, revisionNumber: 1, isActive: true, status: "ACTIVE" });
  const newer = Schedules.create({ scheduleId: "sch_newer", enrollmentId: enrollment.enrollmentId, userId: user.userId, revisionNumber: 2, isActive: true, status: "ACTIVE" });
  ScheduleEntries.create({ scheduleId: newer.scheduleId, enrollmentId: enrollment.enrollmentId, userId: user.userId, enrollmentSubjectId: ens.ensId, dayOfWeek: "MONDAY", startTime: "08:00", endTime: "09:30", status: "ACTIVE" });
  await Repo.flush(env, STUDENT);

  section("Schedule resolution with two active schedules");
  const active = Schedules.getActiveByUserId(user.userId);
  check("the newest revision wins", active?.scheduleId === "sch_newer", String(active?.scheduleId));
  const all = Schedules.getActiveAllByUserId(user.userId);
  check("both active schedules are visible", all.length === 2, String(all.length));
  check("the list is ordered newest first", all[0]?.scheduleId === "sch_newer" && all[1]?.scheduleId === "sch_older");

  // What the confirm path now does: archive every other active schedule.
  for (const stale of all) {
    if (stale.scheduleId !== "sch_newer") Schedules.update(stale, { isActive: false, status: "ARCHIVED" });
  }
  check("archiving the others leaves exactly one active", Schedules.getActiveAllByUserId(user.userId).length === 1);
  check("and it is still the newest", Schedules.getActiveByUserId(user.userId)?.scheduleId === "sch_newer");
  await Repo.flush(env, STUDENT);

  section("With classes on the schedule the dashboard is available again");
  const cookieReady = await sealSession({ googleSub: STUDENT.googleSub, email: STUDENT.email, emailVerified: true, issuedAt: Date.now(), sessionExpiresAt: Date.now() + 3_600_000 });
  Repo.reset();
  await Repo.hydrate(env, STUDENT);
  const routingAfter = await callEndpoint(bootstrapGet, env, cookieReady, "/api/v1/bootstrap");
  check("bootstrap routes to the dashboard", routingAfter.body?.routing === "dashboard", JSON.stringify(routingAfter.body?.routing));
  const statusAfter = await callEndpoint(onboardingStatusGet, env, cookieReady, "/api/v1/onboarding/status");
  check("onboarding reports COMPLETE", statusAfter.body?.stage === "COMPLETE", JSON.stringify(statusAfter.body?.stage));

  section("Session resolves for an active account");
  const cookie = await sealSession({ googleSub: STUDENT.googleSub, email: STUDENT.email, emailVerified: true, issuedAt: Date.now(), sessionExpiresAt: Date.now() + 3_600_000 });
  Repo.reset();
  const resolved = await resolveUser(contextFor(env, cookie));
  check("an active student gets a session", Boolean(resolved), "resolveUser returned null");

  section("Admin purge blocks the same identity");
  // The administrator must exist as a row: resolveActor marks an unknown googleSub
  // as new, and requireAdministrator refuses a new identity.
  Users.upsert(ADMIN_GOOGLE_SUB, { email: "myscheduleqcu@gmail.com", name: "Portal Admin" });
  await Repo.flush(env, { googleSub: ADMIN_GOOGLE_SUB, email: "myscheduleqcu@gmail.com" });
  const adminActor = { googleSub: ADMIN_GOOGLE_SUB, email: "myscheduleqcu@gmail.com", emailVerified: true, issuedAt: Date.now() };
  const canonical = JSON.stringify({
    action: "admin.user.update",
    payload: { operation: "purge", userId: user.userId, version: user.version ?? 1, reason: "Regression test", mutationId: randomUUID(), confirm: user.userId },
    actor: adminActor,
    nonce: randomUUID(),
    timestamp: new Date().toISOString(),
  });
  const signature = createHmac("sha256", SECRET).update(canonical).digest("hex");
  const purgeResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ canonical, signature }),
  });
  const purgeBody = await purgeResponse.json();
  check("the purge call is accepted", purgeBody.ok === true, JSON.stringify(purgeBody.error || purgeBody).slice(0, 200));

  Repo.reset();
  let blocked = false;
  try {
    const after = await resolveUser(contextFor(env, cookie));
    blocked = after === null;
  } catch (error) {
    // The database refusing the identity mid-hydration is also a block.
    blocked = true;
  }
  check("a purged account cannot resolve a session", blocked, "resolveUser still returned a session");

  section("The purge removed the data and kept the tombstone");
  const usersAfter = gs.spreadsheet.getSheetByName("Users").getDataRange().getValues();
  const header = usersAfter[0].map(String);
  const rows = usersAfter.slice(1).map((row) => Object.fromEntries(header.map((key, i) => [key, row[i]])));
  const tombstone = rows.find((row) => String(row.googleSub) === STUDENT.googleSub);
  check("a tombstone row remains", Boolean(tombstone));
  check("the tombstone is CLOSED", String(tombstone?.accountStatus) === "CLOSED", String(tombstone?.accountStatus));
  check("the tombstone carries purgedAt", Boolean(tombstone?.purgedAt));
  const ownedRows = ["Enrollments", "Enrollment_Subjects", "Schedules", "Schedule_Entries"].flatMap((sheet) => {
    const data = gs.spreadsheet.getSheetByName(sheet).getDataRange().getValues();
    const keys = data[0].map(String);
    return data.slice(1).filter((row) => {
      const obj = Object.fromEntries(keys.map((key, i) => [key, row[i]]));
      return [obj.userId, obj.ownerUserId].includes(user.userId);
    });
  });
  check("no owned rows survive the purge", ownedRows.length === 0, `${ownedRows.length} row(s) left`);
} finally {
  server.closeAllConnections?.();
  server.close();
}

console.log(`\n=== account gates: ${checks - failures}/${checks} checks passed ===\n`);
process.exit(failures === 0 ? 0 : 1);
