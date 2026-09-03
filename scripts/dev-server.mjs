import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestGet as googleCallback } from "../functions/api/google/callback.js";
import { onRequestGet as googleConnect } from "../functions/api/google/connect.js";
import { onRequestPost as googleDisconnect } from "../functions/api/google/disconnect.js";
import { onRequestPost as googlePreferences } from "../functions/api/google/preferences.js";
import { onRequestGet as googleStatus } from "../functions/api/google/status.js";
import { onRequestGet as googleUpdates } from "../functions/api/google/updates.js";

import { onRequestGet as authGoogleStart } from "../functions/api/auth/google/start.js";
import { onRequestGet as authGoogleCallback } from "../functions/api/auth/google/callback.js";
import { onRequestGet as authSession } from "../functions/api/auth/session.js";
import { onRequestPost as authLogout } from "../functions/api/auth/logout.js";
import { onRequestGet as v1Bootstrap } from "../functions/api/v1/bootstrap.js";
import { onRequestGet as v1MeGet } from "../functions/api/v1/me.js";
import { onRequestPatch as v1MePatch } from "../functions/api/v1/me.js";
import { onRequestGet as v1Dashboard } from "../functions/api/v1/dashboard.js";

import { onRequestPost as corUpload } from "../functions/api/v1/cor/upload.js";
import { onRequestGet as corStatus } from "../functions/api/v1/cor/status.js";
import { onRequestPost as corProcess } from "../functions/api/v1/cor/process.js";
import { onRequestGet as corResult } from "../functions/api/v1/cor/result.js";
import { onRequestPost as corReview } from "../functions/api/v1/cor/review.js";
import { onRequestPost as corConfirm } from "../functions/api/v1/cor/confirm.js";
import { onRequestGet as corTestGemini } from "../functions/api/v1/cor/test-gemini.js";

import { onRequestGet as onboardingStatus } from "../functions/api/v1/onboarding/status.js";

import { onRequestGet as scheduleGet } from "../functions/api/v1/schedule/index.js";
import { onRequestPost as scheduleEntriesPost } from "../functions/api/v1/schedule/entries.js";
import { onRequestPatch as scheduleEntryPatch } from "../functions/api/v1/schedule/entries/[id].js";
import { onRequestDelete as scheduleEntryDelete } from "../functions/api/v1/schedule/entries/[id].js";

import { onRequestGet as tasksGet } from "../functions/api/v1/tasks/index.js";
import { onRequestPost as tasksPost } from "../functions/api/v1/tasks/index.js";
import { onRequestPatch as taskPatch } from "../functions/api/v1/tasks/[id].js";
import { onRequestDelete as taskDelete } from "../functions/api/v1/tasks/[id].js";

import { onRequestGet as notesGet } from "../functions/api/v1/notes/index.js";
import { onRequestPost as notesPost } from "../functions/api/v1/notes/index.js";
import { onRequestPatch as notePatch } from "../functions/api/v1/notes/[id].js";
import { onRequestDelete as noteDelete } from "../functions/api/v1/notes/[id].js";

import { onRequestGet as healthGet } from "../functions/api/v1/health.js";

import { onRequestGet as academicCampuses } from "../functions/api/v1/academic/campuses.js";
import { onRequestGet as academicDepartments } from "../functions/api/v1/academic/departments.js";
import { onRequestGet as academicPrograms } from "../functions/api/v1/academic/programs.js";
import { onRequestGet as academicTerms } from "../functions/api/v1/academic/terms.js";
import { onRequestGet as academicSubjects } from "../functions/api/v1/academic/subjects.js";
import { onRequestGet as academicBuildings } from "../functions/api/v1/academic/buildings.js";
import { onRequestGet as academicRooms } from "../functions/api/v1/academic/rooms.js";

import { CatalogSeed, Users, Enrollments, Schedules, ScheduleEntries } from "../functions/api/repo/index.js";
import { readFileSync } from "node:fs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 8788;
const HOST = "127.0.0.1";

const API_ROUTES = new Map([
  ["GET /api/google/callback", googleCallback],
  ["GET /api/google/connect", googleConnect],
  ["POST /api/google/disconnect", googleDisconnect],
  ["POST /api/google/preferences", googlePreferences],
  ["GET /api/google/status", googleStatus],
  ["GET /api/google/updates", googleUpdates],
  ["GET /api/auth/google/start", authGoogleStart],
  ["GET /api/auth/google/callback", authGoogleCallback],
  ["GET /api/auth/session", authSession],
  ["POST /api/auth/logout", authLogout],
  ["GET /api/v1/bootstrap", v1Bootstrap],
  ["GET /api/v1/me", v1MeGet],
  ["PATCH /api/v1/me", v1MePatch],
  ["GET /api/v1/dashboard", v1Dashboard],
  ["POST /api/v1/cor/upload", corUpload],
  ["GET /api/v1/cor/status", corStatus],
  ["POST /api/v1/cor/process", corProcess],
  ["GET /api/v1/cor/result", corResult],
  ["POST /api/v1/cor/review", corReview],
  ["POST /api/v1/cor/confirm", corConfirm],
  ["GET /api/v1/cor/test-gemini", corTestGemini],
  ["GET /api/v1/onboarding/status", onboardingStatus],
  ["GET /api/v1/academic/campuses", academicCampuses],
  ["GET /api/v1/academic/departments", academicDepartments],
  ["GET /api/v1/academic/programs", academicPrograms],
  ["GET /api/v1/academic/terms", academicTerms],
  ["GET /api/v1/academic/subjects", academicSubjects],
  ["GET /api/v1/academic/buildings", academicBuildings],
  ["GET /api/v1/academic/rooms", academicRooms],
  ["GET /api/v1/schedule", scheduleGet],
  ["POST /api/v1/schedule/entries", scheduleEntriesPost],
  ["GET /api/v1/tasks", tasksGet],
  ["POST /api/v1/tasks", tasksPost],
  ["GET /api/v1/notes", notesGet],
  ["POST /api/v1/notes", notesPost],
  ["GET /api/v1/health", healthGet],
]);

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

async function loadDevVars() {
  try {
    const text = await readFile(resolve(ROOT, ".dev.vars"), "utf8");
    const values = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return values;
  } catch (_) {
    return {};
  }
}

// .dev.vars is the baseline; an explicitly exported shell variable overrides it.
// That order lets a one-off run redirect a single setting without editing the
// file, e.g. pointing APPS_SCRIPT_URL at scripts/sheets-emulator.mjs.
const devVars = await loadDevVars();
const env = { ...devVars, ...process.env };

// Seed academic catalog on startup
try {
  const catalogData = JSON.parse(readFileSync(resolve(ROOT, "data/academic-catalog.json"), "utf8"));
  CatalogSeed.load(catalogData);
  console.log(`Academic catalog seeded: ${CatalogSeed.meta().campuses} campuses, ${CatalogSeed.meta().departments} depts, ${CatalogSeed.meta().programs} programs, ${CatalogSeed.meta().subjects} subjects`);
} catch (e) {
  console.warn("Failed to seed academic catalog:", e.message);
}

// ---------------------------------------------------------------------------
// Seed 3 synthetic student fixtures for dashboard testing
// Student A → BSCS, Student B → BSIT, Student C → BSBA
// Each gets: user → enrollment → schedule → entries
// ---------------------------------------------------------------------------
function seedSyntheticStudents() {
  const students = [
    {
      googleSub: "synthetic_student_a",
      name: "Maria Santos",
      email: "maria.santos@example.com",
      programId: "prg_bscs",
      campusId: "cam_sb",
      termId: "trm_2026_1",
      yearLevel: "2ND_YEAR",
      sectionLabel: "BSCS-2A",
      entries: [
        { subjectId: "sub_cc104", dayOfWeek: "MONDAY",    startTime: "08:00", endTime: "09:30", buildingId: "bldg_new_academic", roomId: "rm_il502a", sortOrder: 1 },
        { subjectId: "sub_cc105", dayOfWeek: "MONDAY",    startTime: "10:00", endTime: "11:30", buildingId: "bldg_new_academic", roomId: "rm_il601a", sortOrder: 2 },
        { subjectId: "sub_cc106", dayOfWeek: "TUESDAY",   startTime: "08:00", endTime: "09:30", buildingId: "bldg_bautista",    roomId: "rm_ik603f1", sortOrder: 3 },
        { subjectId: "sub_cc107", dayOfWeek: "TUESDAY",   startTime: "10:00", endTime: "11:30", buildingId: "bldg_new_academic", roomId: "rm_il606a", sortOrder: 4 },
        { subjectId: "sub_cc108", dayOfWeek: "WEDNESDAY", startTime: "08:00", endTime: "09:30", buildingId: "bldg_techboc",     roomId: "rm_tb_201", sortOrder: 5 },
        { subjectId: "sub_cc109", dayOfWeek: "WEDNESDAY", startTime: "10:00", endTime: "11:30", buildingId: "bldg_new_academic", roomId: "rm_il502a", sortOrder: 6 },
        { subjectId: "sub_cc110", dayOfWeek: "THURSDAY",  startTime: "08:00", endTime: "09:30", buildingId: "bldg_new_academic", roomId: "rm_il601a", sortOrder: 7 },
        { subjectId: "sub_math104", dayOfWeek: "FRIDAY",  startTime: "08:00", endTime: "09:30", buildingId: "bldg_belmonte",    roomId: "rm_sbog", sortOrder: 8 },
      ],
    },
    {
      googleSub: "synthetic_student_b",
      name: "Juan Dela Cruz",
      email: "juan.delacruz@example.com",
      programId: "prg_bsit",
      campusId: "cam_sb",
      termId: "trm_2026_1",
      yearLevel: "1ST_YEAR",
      sectionLabel: "BSIT-1B",
      entries: [
        { subjectId: "sub_is101",  dayOfWeek: "MONDAY",    startTime: "09:00", endTime: "10:30", buildingId: "bldg_techboc",     roomId: "rm_tb_301", sortOrder: 1 },
        { subjectId: "sub_is102",  dayOfWeek: "MONDAY",    startTime: "13:00", endTime: "14:30", buildingId: "bldg_techboc",     roomId: "rm_tb_201", sortOrder: 2 },
        { subjectId: "sub_cc101",  dayOfWeek: "TUESDAY",   startTime: "09:00", endTime: "10:30", buildingId: "bldg_new_academic", roomId: "rm_il502a", sortOrder: 3 },
        { subjectId: "sub_math101", dayOfWeek: "TUESDAY",  startTime: "11:00", endTime: "12:30", buildingId: "bldg_belmonte",    roomId: "rm_sbog", sortOrder: 4 },
        { subjectId: "sub_eng101", dayOfWeek: "WEDNESDAY", startTime: "09:00", endTime: "10:30", buildingId: "bldg_bautista",    roomId: "rm_ik603f1", sortOrder: 5 },
        { subjectId: "sub_ged101", dayOfWeek: "THURSDAY",  startTime: "09:00", endTime: "10:30", buildingId: "bldg_new_academic", roomId: "rm_il606a", sortOrder: 6 },
        { subjectId: "sub_pe101",  dayOfWeek: "FRIDAY",    startTime: "09:00", endTime: "10:30", buildingId: "bldg_belmonte",    roomId: "rm_sbog", sortOrder: 7 },
      ],
    },
    {
      googleSub: "synthetic_student_c",
      name: "Ana Reyes",
      email: "ana.reyes@example.com",
      programId: "prg_bsba",
      campusId: "cam_sb",
      termId: "trm_2026_1",
      yearLevel: "3RD_YEAR",
      sectionLabel: "BSBA-3A",
      entries: [
        { subjectId: "sub_ged102", dayOfWeek: "MONDAY",    startTime: "10:00", endTime: "11:30", buildingId: "bldg_bautista",    roomId: "rm_ik603f1", sortOrder: 1 },
        { subjectId: "sub_ged103", dayOfWeek: "TUESDAY",   startTime: "10:00", endTime: "11:30", buildingId: "bldg_belmonte",    roomId: "rm_sbog", sortOrder: 2 },
        { subjectId: "sub_ged104", dayOfWeek: "WEDNESDAY", startTime: "10:00", endTime: "11:30", buildingId: "bldg_new_academic", roomId: "rm_il606a", sortOrder: 3 },
        { subjectId: "sub_eng102", dayOfWeek: "THURSDAY",  startTime: "10:00", endTime: "11:30", buildingId: "bldg_techboc",     roomId: "rm_tb_301", sortOrder: 4 },
        { subjectId: "sub_math102", dayOfWeek: "FRIDAY",   startTime: "10:00", endTime: "11:30", buildingId: "bldg_new_academic", roomId: "rm_il502a", sortOrder: 5 },
      ],
    },
  ];

  for (const s of students) {
    const user = Users.upsert(s.googleSub, {
      name: s.name,
      email: s.email,
      picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=random`,
    });
    user.state = "ACTIVE";
    user.profile = { yearLevel: s.yearLevel, section: s.sectionLabel };

    const enrollment = Enrollments.create({
      userId: user.userId,
      programId: s.programId,
      campusId: s.campusId,
      termId: s.termId,
      yearLevel: s.yearLevel,
      sectionLabelSnapshot: s.sectionLabel,
      studentStatus: "REGULAR",
      status: "ACTIVE",
    });

    const schedule = Schedules.create({
      enrollmentId: enrollment.enrollmentId,
      userId: user.userId,
      name: "Official Schedule",
      status: "ACTIVE",
    });

    for (const entry of s.entries) {
      ScheduleEntries.create({
        scheduleId: schedule.scheduleId,
        enrollmentId: enrollment.enrollmentId,
        userId: user.userId,
        enrollmentSubjectId: entry.subjectId,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        buildingId: entry.buildingId,
        roomId: entry.roomId,
        sortOrder: entry.sortOrder,
        status: "ACTIVE",
      });
    }
  }

  console.log(`Synthetic students seeded: ${students.length} users with enrollments, schedules, and entries`);
}

seedSyntheticStudents();

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch (_) {
    return false;
  }
}

function corsHeaders(request, headers) {
  const origin = request.headers.get("Origin");
  if (isLocalOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.append("Vary", "Origin");
  }
  return headers;
}

async function nodeRequest(req) {
  const origin = `http://${req.headers.host || `${HOST}:${PORT}`}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value != null) headers.set(name, value);
  }
  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) chunks.push(chunk);
  }
  return new Request(new URL(req.url || "/", origin), {
    method: req.method,
    headers,
    body: chunks.length ? new Blob([Buffer.concat(chunks)]) : undefined,
  });
}

async function sendWebResponse(res, response, request) {
  // Read Set-Cookie from the ORIGINAL response before Headers API merges them
  const setCookieValues = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const headers = corsHeaders(request, new Headers(response.headers));
  const headerObj = {};
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() !== 'set-cookie') {
      headerObj[key] = value;
    }
  }
  if (setCookieValues.length) headerObj['Set-Cookie'] = setCookieValues;
  // DEBUG: log Set-Cookie values for auth debugging
  if (setCookieValues.length) {
    for (const sc of setCookieValues) {
      console.log('  Set-Cookie:', sc.split(';')[0].substring(0, 60));
    }
  }
  res.writeHead(response.status, headerObj);
  if (!response.body) return res.end();
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = resolve(ROOT, "." + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return null;
  const relative = filePath.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (!relative || relative.startsWith(".") || relative.startsWith("functions/") || relative.startsWith("node_modules/")) return null;
  return filePath;
}

async function serveStatic(req, res, pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  try {
    const content = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": type.startsWith("text/html") ? "no-cache" : "public, max-age=0"
    });
    res.end(content);
  } catch (_) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const request = await nodeRequest(req);
    const url = new URL(request.url);
    console.log(req.method, url.pathname + url.search);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/google/")) {
      return sendWebResponse(res, new Response(null, { status: 204 }), request);
    }
    if (url.pathname === "/api/dev/health") {
      return sendWebResponse(res, Response.json({ status: "OK", functions: true }), request);
    }

    const handler = API_ROUTES.get(`${request.method} ${url.pathname}`);
    if (handler) {
      const response = await handler({ request, env });
      return sendWebResponse(res, response, request);
    }

    // ── Parameterized schedule entry routes ────────────────────────────
    if (url.pathname.startsWith("/api/v1/schedule/entries/")) {
      const entryId = url.pathname.split("/").pop();
      if (entryId && entryId.startsWith("sme_")) {
        let response;
        if (request.method === "PATCH") {
          response = await scheduleEntryPatch({ request, env });
        } else if (request.method === "DELETE") {
          response = await scheduleEntryDelete({ request, env });
        }
        if (response) return sendWebResponse(res, response, request);
      }
    }

    // ── Parameterized task routes ──────────────────────────────────────
    if (url.pathname.startsWith("/api/v1/tasks/")) {
      const taskId = url.pathname.split("/").pop();
      if (taskId && taskId.startsWith("tsk_")) {
        let response;
        if (request.method === "PATCH") {
          response = await taskPatch({ request, env });
        } else if (request.method === "DELETE") {
          response = await taskDelete({ request, env });
        }
        if (response) return sendWebResponse(res, response, request);
      }
    }

    // ── Parameterized note routes ──────────────────────────────────────
    if (url.pathname.startsWith("/api/v1/notes/")) {
      const noteId = url.pathname.split("/").pop();
      if (noteId && noteId.startsWith("nt_")) {
        let response;
        if (request.method === "PATCH") {
          response = await notePatch({ request, env });
        } else if (request.method === "DELETE") {
          response = await noteDelete({ request, env });
        }
        if (response) return sendWebResponse(res, response, request);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return sendWebResponse(res, Response.json({ status: "NOT_FOUND", error: "API route not found." }, { status: 404 }), request);
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ERROR", error: String(error && error.message || error) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`My-Schedule development server: http://${HOST}:${PORT}`);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_SESSION_SECRET) {
    console.log("Google OAuth is not configured. Add real values to .dev.vars.");
  }
});
