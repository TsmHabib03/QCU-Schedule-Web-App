// POST /api/v1/cor/confirm
// Final confirmation: validates reviewed draft, creates student profile,
// enrollment, enrollment subjects, schedule, and schedule entries.
// Transitions user to ACTIVE state.

import {
  resolveUser,
  refreshSession,
  flushRepo,
  json,
  compactDraft,
  compactDashboardSnapshot,
} from "../../auth/_lib.js";
import {
  Users,
  CorRecords,
  CorDrafts,
  Profiles,
  Enrollments,
  EnrollmentSubjects,
  Schedules,
  ScheduleEntries,
  Campuses,
  Programs,
  Terms,
  Subjects,
  CatalogBuildings,
  CatalogRooms,
  CatalogSeed,
  Departments,
} from "../../repo/index.js";
import { normalizeDayOfWeek, normalizeTime, minutesOfDay } from "../../_lib/day-time.js";
import { jobError } from './_jobs.js';

// In-memory stores for confirmed data — NOW DELEGATED TO REPO
// (Profiles, Enrollments, EnrollmentSubjects, Schedules, ScheduleEntries
//  are imported from the repo module above)

// ---------------------------------------------------------------------------
// Helpers — extract value from either full ({ value, sourceText, confidence })
// or compact (plain value) draft format.
// ---------------------------------------------------------------------------
function val(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && !Array.isArray(v) && "value" in v) return v.value;
  return v;
}

/**
 * A text field from a draft, or null.
 *
 * The reviewed draft carries `room` as a free-form bag: a { value, confidence }
 * wrapper when the OCR read one, a plain string when the student typed it, and
 * `{}` when there was no room at all. val() hands back that empty object
 * unchanged, and anything downstream that treats the result as text throws
 * ("e.locationText.match is not a function") — which surfaced to the student as
 * the generic "could not finish setting up your schedule". Only primitives and
 * an explicit .value wrapper are text; everything else is nothing.
 */
function text(v) {
  const raw = val(v);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return null;
  const s = String(raw).trim();
  return s && s !== "[object Object]" ? s : null;
}

// ---------------------------------------------------------------------------
// Final validation
// ---------------------------------------------------------------------------
function validateDraft(draft, catalog) {
  const issues = [];

  // Student info validation
  if (!val(draft.studentInfo?.firstName)) issues.push({ field: "studentInfo.firstName", message: "First name is required." });
  if (!val(draft.studentInfo?.lastName)) issues.push({ field: "studentInfo.lastName", message: "Last name is required." });
  if (!val(draft.studentInfo?.studentNumber)) issues.push({ field: "studentInfo.studentNumber", message: "Student number is required." });

  // Enrollment validation
  if (!val(draft.enrollmentInfo?.program)) issues.push({ field: "enrollmentInfo.program", message: "Program is required." });
  if (!val(draft.enrollmentInfo?.yearLevel)) issues.push({ field: "enrollmentInfo.yearLevel", message: "Year level is required." });
  if (!val(draft.enrollmentInfo?.term)) issues.push({ field: "enrollmentInfo.term", message: "Term is required." });

  // Validate year level
  const yearLevel = val(draft.enrollmentInfo?.yearLevel);
  if (yearLevel && (yearLevel < 1 || yearLevel > 5)) {
    issues.push({ field: "enrollmentInfo.yearLevel", message: "Year level must be between 1 and 5." });
  }

  // Subject validation
  if (!Array.isArray(draft.subjects) || draft.subjects.length === 0) {
    issues.push({ field: "subjects", message: "At least one subject is required." });
  } else {
    for (let i = 0; i < draft.subjects.length; i++) {
      const s = draft.subjects[i];
      if (!val(s.subjectCode)) issues.push({ field: `subjects[${i}].subjectCode`, message: "Subject code is required." });
      if (!val(s.subjectName)) issues.push({ field: `subjects[${i}].subjectName`, message: "Subject name is required." });

      // Validate every meeting's day and clock time. Days arrive in every shape
      // the app has ever written — the importer's canonical "MONDAY", a
      // title-case "Monday" left in an older draft, and the OCR fallback's
      // Monday-first 1-7 index — and all three mean the same day. Checking them
      // against a private title-case table rejected every canonical day
      // ("Invalid day: MONDAY") and failed the whole confirm once the newest
      // importer started writing canonical names. One shared reader, both ways.
      const schedule = s.schedule || s.meetings;
      if (schedule) {
        for (let j = 0; j < schedule.length; j++) {
          const m = schedule[j];
          const dayVal = val(m.day) ?? val(m.dayOfWeek);
          if (String(dayVal ?? "").trim() && !normalizeDayOfWeek(dayVal)) {
            issues.push({ field: `subjects[${i}].schedule[${j}].day`, message: `Unknown day: ${dayVal}` });
          }
          for (const [label, raw] of [["start", val(m.time?.start) ?? val(m.startTime)], ["end", val(m.time?.end) ?? val(m.endTime)]]) {
            if (String(raw ?? "").trim() && !normalizeTime(raw)) {
              issues.push({ field: `subjects[${i}].schedule[${j}].time`, message: `Unknown ${label} time: ${raw}` });
            }
          }
          // The pipeline spec's own rule: a class window runs forward. A window
          // that does not is unreadable data, and importing it silently is how a
          // misread 12-hour time becomes a 13-hour class on the week table.
          const from = minutesOfDay(val(m.time?.start) ?? val(m.startTime));
          const to = minutesOfDay(val(m.time?.end) ?? val(m.endTime));
          if (from !== null && to !== null && from >= to) {
            issues.push({
              field: `subjects[${i}].schedule[${j}].time`,
              message: `${val(s.subjectCode) || "A class"}: the end time (${clock(to)}) is not after the start time (${clock(from)}). Fix the time before confirming.`,
            });
          }
        }
      }
    }
  }

  // Check for schedule conflicts (same day + overlapping time)
  if (draft.subjects) {
    for (let i = 0; i < draft.subjects.length; i++) {
      const s1 = draft.subjects[i];
      const sched1 = s1.schedule || s1.meetings;
      if (!sched1) continue;
      for (let j = 0; j < draft.subjects.length; j++) {
        if (i >= j) continue;
        const s2 = draft.subjects[j];
        const sched2 = s2.schedule || s2.meetings;
        if (!sched2) continue;
        for (const m1 of sched1) {
          for (const m2 of sched2) {
            // Compare what the days and times MEAN, not how they are spelled: a
            // raw !== between "MONDAY" and "Monday" silently disables this check.
            const d1 = normalizeDayOfWeek(val(m1.day) ?? val(m1.dayOfWeek));
            const d2 = normalizeDayOfWeek(val(m2.day) ?? val(m2.dayOfWeek));
            if (!d1 || d1 !== d2) continue;
            const s1t = minutesOfDay(val(m1.time?.start) ?? val(m1.startTime));
            const e1 = minutesOfDay(val(m1.time?.end) ?? val(m1.endTime));
            const s2t = minutesOfDay(val(m2.time?.start) ?? val(m2.startTime));
            const e2 = minutesOfDay(val(m2.time?.end) ?? val(m2.endTime));
            if ([s1t, e1, s2t, e2].some((v) => v === null)) continue;
            if (s1t < e2 && s2t < e1) {
              issues.push({
                field: "schedule",
                message: `Schedule conflict: ${val(s1.subjectCode)} and ${val(s2.subjectCode)} on ${d1} (${clock(s1t)}-${clock(e1)} vs ${clock(s2t)}-${clock(e2)})`,
              });
            }
          }
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Commit logic — create all records in one operation (via repository)
// ---------------------------------------------------------------------------
function commitRecords(user, draft, _catalog) {
  // Every previously active schedule/enrollment, not just one: a sheet can hold
  // several active rows from earlier confirms, and archiving only the first left
  // the rest competing for "the current schedule".
  const previousSchedules = Schedules.getActiveAllByUserId(user.userId);
  const previousEnrollments = Enrollments.getByUserId(user.userId).filter((e) => e.status === "ACTIVE");
  // 1. Create Student Profile
  const profile = Profiles.create({
    profileId: `prf_${user.corRecordId}`,
    userId: user.userId,
    studentNumber: val(draft.studentInfo.studentNumber),
    firstName: val(draft.studentInfo.firstName),
    middleName: val(draft.studentInfo.middleName) || null,
    lastName: val(draft.studentInfo.lastName),
    suffix: val(draft.studentInfo.suffix) || null,
    verificationStatus: "COR_REVIEWED",
    sourceCorRecordId: user.corRecordId,
  });

  // 2. Resolve program and campus from catalog (using repo modules)
  const programCode = val(draft.enrollmentInfo.program);
  const matchedProgram = draft.enrollmentInfo.program?.matchedProgramId
    ? Programs.getById(draft.enrollmentInfo.program.matchedProgramId)
    : Programs.getByCode(programCode);

  const campusName = val(draft.enrollmentInfo.campus);
  const matchedCampus = draft.enrollmentInfo.campus?.matchedCampusId
    ? Campuses.getById(draft.enrollmentInfo.campus.matchedCampusId)
    : (campusName ? Campuses.getAll().find(c => c.name.includes(campusName)) : null);

  const termLabel = val(draft.enrollmentInfo.term);
  const matchedTerm = draft.enrollmentInfo.term?.matchedTermId
    ? Terms.getById(draft.enrollmentInfo.term.matchedTermId)
    : Terms.getAll().find(t => t.name.includes(termLabel));

  // 3. Create Enrollment
  const enrollment = Enrollments.create({
    enrollmentId: `enr_${user.corRecordId}`,
    userId: user.userId,
    profileId: profile.profileId,
    termId: matchedTerm?.termId || null,
    programId: matchedProgram?.programId || null,
    campusId: matchedCampus?.campusId || null,
    yearLevel: val(draft.enrollmentInfo.yearLevel),
    sectionLabelSnapshot: val(draft.enrollmentInfo.section) || null,
    adviserName: val(draft.enrollmentInfo.adviserName) || null,
    sourceType: "COR_IMPORT",
    sourceCorRecordId: user.corRecordId,
  });

  // 4. Create Enrollment Subjects and Schedule
  const schedule = Schedules.create({
    scheduleId: `sch_${user.corRecordId}`,
    enrollmentId: enrollment.enrollmentId,
    userId: user.userId,
    sourceType: "COR_IMPORT",
    sourceCorRecordId: user.corRecordId,
  });

  let entryIndex = 0;
  for (const [subjectIndex, subject] of draft.subjects.entries()) {
    const enrollmentSubject = EnrollmentSubjects.create({
      ensId: `ens_${user.corRecordId}_${subjectIndex}`,
      enrollmentId: enrollment.enrollmentId,
      userId: user.userId,
      subjectCodeSnapshot: val(subject.subjectCode),
      subjectTitleSnapshot: val(subject.subjectName),
      units: val(subject.units) || 0,
      matchedSubjectId: subject.matchedSubjectId || null,
      matchedRoomId: subject.room?.matchedRoomId || null,
      matchedBuildingId: subject.room?.matchedBuildingId || null,
      roomSnapshot: text(subject.room),
      sourceType: "COR_IMPORT",
    });

    // Create schedule entries for each meeting
    const meetings = subject.schedule || subject.meetings;
    if (meetings) {
      for (const meeting of meetings) {
        entryIndex++;
        const dayVal = val(meeting.day) || val(meeting.dayOfWeek);
        const startVal = val(meeting.time?.start) || val(meeting.startTime);
        const endVal = val(meeting.time?.end) || val(meeting.endTime);
        const dayCanonical = normalizeDayOfWeek(dayVal);
        ScheduleEntries.create({
          smeId: `sme_${user.corRecordId}_${entryIndex}`,
          scheduleId: schedule.scheduleId,
          enrollmentId: enrollment.enrollmentId,
          userId: user.userId,
          enrollmentSubjectId: enrollmentSubject.ensId,
          // Canonical day name, matching the class editor. The numeric form
          // (Monday-first 1-7 from the OCR fallback) and a title-case "Monday"
          // both normalise to the same "MONDAY" here, so conflict checks and the
          // day picker never have to guess.
          dayOfWeek: dayCanonical || null,
          // dayLabel is the DISPLAY form every client compares: the week table,
          // the day filter and dayNames.indexOf all use title-case ("Monday").
          // Writing the canonical name here left the schedule unreadable to them.
          dayLabel: dayCanonical ? dayCanonical[0] + dayCanonical.slice(1).toLowerCase() : null,
          // Normalised clock times: "8:00 AM", "08:00:00" and a Sheets time cell
          // all become the one "HH:mm" the rest of the app parses.
          startTime: normalizeTime(startVal) || null,
          endTime: normalizeTime(endVal) || null,
          locationText: text(subject.room),
          buildingId: subject.room?.matchedBuildingId || null,
          roomId: subject.room?.matchedRoomId || null,
          sortOrder: entryIndex,
        });
      }
    }
  }

  // 5. Update COR record to COMPLETE
  // Archive every other active schedule and enrollment, so exactly one remains
  // and it is the one this COR just created.
  for (const stale of previousSchedules) {
    if (stale.scheduleId !== schedule.scheduleId) {
      Schedules.update(stale, { isActive: false, status: "ARCHIVED", archivedAt: new Date().toISOString(), revisionReason: "Replaced by COR re-import" });
    }
  }
  for (const stale of previousEnrollments) {
    if (stale.enrollmentId !== enrollment.enrollmentId) {
      Enrollments.update(stale, { status: "ARCHIVED" });
    }
  }
  const corRecord = CorRecords.getById(user.corRecordId);
  if (corRecord) {
    CorRecords.update(corRecord, { status: "COMPLETE" });
  }

  // 6. Update user state — via Users.update so the change is recorded for flush
  const nameParts = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean);
  Users.update(user, {
    state: "ACTIVE",
    // Prefer the COR-extracted name so it is used everywhere.
    name: nameParts.length ? nameParts.join(" ") : user.name,
    profile: {
      profileId: profile.profileId,
      studentNumber: profile.studentNumber,
      firstName: profile.firstName,
      middleName: profile.middleName,
      lastName: profile.lastName,
      suffix: profile.suffix,
      verificationStatus: profile.verificationStatus,
    },
  });

  return {
    profileId: profile.profileId,
    enrollmentId: enrollment.enrollmentId,
    scheduleId: schedule.scheduleId,
    subjectCount: draft.subjects.length,
    entryCount: entryIndex,
  };
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(":");
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** Minutes since midnight back to "HH:mm", for messages about a specific slot. */
function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function onRequestPost(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user, session } = resolved;
    const body = await context.request.json().catch(() => ({}));
    const requested = CorRecords.getById(body.corRecordId || user.corRecordId);
    if (requested && requested.ownerUserId === user.userId && requested.status === 'COMPLETE') {
      return json({status:'COMPLETE',corRecordId:requested.id,scheduleId:`sch_${requested.id}`,message:'This COR is already confirmed.'});
    }
    // Confirm the import the student actually reviewed when it is still their own
    // pending one; otherwise fall back to their newest pending import (never the
    // OLDEST, which is what a stale earlier upload looks like in sheet order).
    const asked = requested && requested.ownerUserId === user.userId && requested.status === "REVIEW_REQUIRED" ? requested : null;
    const pending = CorRecords.getActiveByUserId(user.userId);
    if (asked) user.corRecordId = asked.id;
    else if (pending) user.corRecordId = pending.id;

    if (!["ONBOARDING","ACTIVE"].includes(user.state) || !user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import to confirm." },
        400
      );
    }

    // --- Get COR record (Maps or session fallback) ---
    const record = CorRecords.getById(user.corRecordId);
    // COMMITTING is retryable, not rejected: it is what a confirm that died
    // half-way leaves behind (the status is written before the records are
    // built, and nothing reaches Sheets until the single batch write). Refusing
    // it locked those students out of the only button that could finish their
    // setup — the app kept showing "we could not finish setting up your
    // schedule" with no way forward. A confirm that did land flushes the record
    // as COMPLETE and is answered by the idempotent branch above, and the batch
    // handler refuses a duplicate confirmation under its own lock.
    if (record && !["REVIEW_REQUIRED", "COMMITTING"].includes(record.status)) {
      return json(
        { status: "ERROR", error: `Cannot confirm COR in state: ${record.status}` },
        400
      );
    }

    // --- Get extraction draft (Maps or session fallback) ---
    // The client named a record that is not the one we are about to confirm:
    // it belongs to another account, or it was cancelled/replaced. Say so, and
    // point at the reload that picks up the newest import.
    if (body.corRecordId && body.corRecordId !== user.corRecordId) {
      return json({ status: "ERROR", error: "That COR import was replaced by a newer one. Check again to load your latest import." }, 409);
    }
    let draft = record ? CorDrafts.get(record.id) : null;
    if (!draft && user.corDraft) {
      // CF Pages: draft stored in session cookie during upload
      console.log("Using draft from session cookie (CF Pages path)");
      draft = user.corDraft;
    }
    if (!draft) {
      draft = body.draft;
    }
    if (!draft) {
      return json(
        { status: "ERROR", error: "No extraction draft found." },
        400
      );
    }

    // Build a lightweight catalog object for validation from repo modules
    const catalogForValidation = {
      programs: Programs.getAll(),
      campuses: Campuses.getAll(),
      terms: Terms.getAll(),
      subjects: Subjects.getAll(),
    };

    // Final validation
    const validationIssues = validateDraft(draft, catalogForValidation);
    if (validationIssues.length > 0) {
      return json(
        {
          status: "VALIDATION_ERROR",
          error: "Please fix the following issues before confirming.",
          issues: validationIssues,
        },
        400
      );
    }

    // Transition to COMMITTING
    if (record) CorRecords.update(record, { status: "COMMITTING" });

    // Commit records
    const result = commitRecords(user, draft, catalogForValidation);

    // ── Build dashboard snapshot for session persistence ───────────────
    // On Cloudflare Pages, in-memory Maps reset per invocation.  We embed
    // the full dashboard payload in the session cookie so dashboard.js can
    // return it on subsequent requests without needing in-memory data.
    const enrollment = Enrollments.getById(result.enrollmentId);
    const schedule = Schedules.getById(result.scheduleId);
    const rawEntries = schedule
      ? ScheduleEntries.getByScheduleId(schedule.scheduleId)
      : [];

    const entries = rawEntries.map((e) => {
      const ens = e.enrollmentSubjectId
        ? EnrollmentSubjects.getById(e.enrollmentSubjectId)
        : null;
      const catalogSubject = ens?.matchedSubjectId
        ? Subjects.getById(ens.matchedSubjectId)
        : null;
      const subjectCode = ens?.subjectCodeSnapshot || catalogSubject?.subjectCode || "";
      const subjectTitle = ens?.subjectTitleSnapshot || catalogSubject?.title || "";
      let building = e.buildingId ? CatalogBuildings.getById(e.buildingId) : null;
      let room = e.roomId ? CatalogRooms.getById(e.roomId) : null;
      if (!building && e.locationText) {
        const m = e.locationText.match(/^([A-Z]{2})/i);
        if (m) building = CatalogBuildings.getByCode(m[1].toUpperCase());
      }
      const startMinutes = timeToMinutes(e.startTime);
      const endMinutes = timeToMinutes(e.endTime);
      // `day`/`dayLabel` are the DISPLAY form (title-case) every view in the
      // client compares against — dayNames ordering, the day filter buttons and
      // the day modal. Derive it from the canonical day rather than echoing
      // whatever the sheet row happened to hold: a canonical "MONDAY" pasted in
      // as-is renders no class at all on the week table.
      const canonicalDay = normalizeDayOfWeek(e.dayOfWeek) || normalizeDayOfWeek(e.dayLabel);
      const normalizedDay = canonicalDay ? canonicalDay[0] + canonicalDay.slice(1).toLowerCase() : "";
      return {
        entryId: e.smeId,
        scheduleId: e.scheduleId,
        code: subjectCode,
        course: subjectCode,
        title: subjectTitle,
        units: ens?.units || 0,
        type: e.modality || "ONSITE",
        modality: e.modality || "ONSITE",
        section: "",
        day: normalizedDay,
        dayLabel: normalizedDay,
        start: e.startTime,
        end: e.endTime,
        startMinutes,
        endMinutes,
        buildingId: e.buildingId,
        buildingCode: building?.buildingCode || "",
        buildingName: building?.name || "",
        roomId: e.roomId,
        roomCode: room?.roomCode || "",
        floor: room?.floor || null,
        room: room?.roomCode || "",
        instructor: "",
        notes: e.locationText || "",
        enrollmentSubjectId: e.enrollmentSubjectId || null,
        originType: "COR_IMPORT",
      };
    });

    // Buildings
    const buildingIds = new Set(rawEntries.map(e => e.buildingId).filter(Boolean));
    const buildings = [];
    for (const bid of buildingIds) {
      const b = CatalogBuildings.getById(bid);
      if (b) buildings.push({
        buildingId: b.buildingId, code: b.buildingCode, name: b.name,
        shortName: b.shortName || b.name, campusId: b.campusId,
        floors: b.floors || 1, rooms: b.rooms || [], lat: b.lat || null, lng: b.lng || null,
      });
    }
    if (enrollment?.campusId) {
      const campusBuildings = CatalogBuildings.getByCampusId(enrollment.campusId);
      for (const b of campusBuildings) {
        if (!buildings.find(x => x.buildingId === b.buildingId)) {
          buildings.push({
            buildingId: b.buildingId, code: b.buildingCode, name: b.name,
            shortName: b.shortName || b.name, campusId: b.campusId,
            floors: b.floors || 1, rooms: b.rooms || [], lat: b.lat || null, lng: b.lng || null,
          });
        }
      }
    }

    // Academic context
    const meta = CatalogSeed.isLoaded() ? CatalogSeed.meta() : null;
    const currentTerm = Terms.getCurrent();
    const program = enrollment ? Programs.getById(enrollment.programId) || null : null;
    const department = program ? Departments.getById(program.departmentId) || null : null;
    const campus = enrollment?.campusId ? Campuses.getById(enrollment.campusId) || null : null;
    const term = enrollment?.termId ? Terms.getById(enrollment.termId) || null : null;

    const academic = {
      catalogVersion: meta?.version || null,
      currentTermId: currentTerm?.termId || null,
      currentTermName: currentTerm?.name || null,
      program: program ? { programId: program.programId, name: program.name, code: program.programCode, abbrev: program.abbreviation || program.name, departmentId: program.departmentId } : null,
      department: department ? { departmentId: department.departmentId, name: department.name, code: department.departmentCode } : null,
      campus: campus ? { campusId: campus.campusId, name: campus.name, code: campus.campusCode } : null,
      term: term ? { termId: term.termId, name: term.name, shortName: term.shortName, academicYear: term.academicYear, semester: term.semester } : null,
    };

    // Enrollment subjects
    const enrollmentSubjects = enrollment
      ? EnrollmentSubjects.getByEnrollmentId(enrollment.enrollmentId).map(es => ({
          enrollmentSubjectId: es.ensId, subjectCode: es.subjectCodeSnapshot || "",
          title: es.subjectTitleSnapshot || "", units: es.units || 0,
        }))
      : [];
    academic.enrollmentSubjects = enrollmentSubjects;

    // Profile
    const profile = user.profile || null;
    let displayName = user.name;
    if (profile && profile.firstName) {
      const parts = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean);
      displayName = parts.join(" ") || user.name;
    }

    const daySet = new Set(entries.map(e => e.day));
    const totalUnits = entries.reduce((sum, e) => sum + (e.units || 0), 0);

    const dashboardSnapshot = {
      enrollment: enrollment ? {
        enrollmentId: enrollment.enrollmentId, programId: enrollment.programId,
        campusId: enrollment.campusId, termId: enrollment.termId,
        yearLevel: enrollment.yearLevel, section: enrollment.sectionLabelSnapshot,
        status: enrollment.status, createdAt: enrollment.createdAt,
      } : null,
      schedule: schedule ? {
        scheduleId: schedule.scheduleId, subjectCount: entries.length,
        totalUnits, dayCount: daySet.size, isActive: schedule.isActive,
        revisionNumber: schedule.revisionNumber,
      } : null,
      entries,
      buildings,
      academic,
      profile: { userId: user.userId, email: user.email, name: displayName,
        picture: user.picture, state: "ACTIVE", role: user.role, profile },
      tasks: [],
      notes: [],
    };

    // Re-seal session cookie with ACTIVE state.
    // Store compact enrollment + subjects so the dashboard can display
    // schedule info on CF Pages where Maps are empty per-invocation.
    // Total ~1 KB, well under the 4 KB browser cookie limit.
    const enrollmentData = enrollment ? {
      enrollmentId: enrollment.enrollmentId,
      programId: enrollment.programId,
      campusId: enrollment.campusId,
      termId: enrollment.termId,
      yearLevel: enrollment.yearLevel,
      section: enrollment.sectionLabelSnapshot,
    } : null;
    const sessionCookie = await refreshSession(context, session, {
      state: "ACTIVE",
      profile: user.profile,
      name: user.name,
      enrollment: enrollmentData,
      enrollmentSubjects: enrollmentSubjects,
    });

    // One batch.write for the whole commit: profile, enrollment, subjects,
    // schedule, every entry, the COR record and the user's new ACTIVE state.
    await flushRepo(context, session);

    const resp = json({
      status: "COMPLETE",
      corRecordId: record?.id || user.corRecordId,
      profileId: result.profileId,
      enrollmentId: result.enrollmentId,
      scheduleId: result.scheduleId,
      subjectCount: result.subjectCount,
      entryCount: result.entryCount,
      message: "Your student profile and schedule have been created.",
      // Return dashboard snapshot in JSON response (not in cookie).
      // The frontend can cache this and the dashboard endpoint reads
      // from in-memory Maps (works locally) or falls back to empty (CF Pages).
      dashboardSnapshot: compactDashboardSnapshot(dashboardSnapshot),
    });
    resp.headers.append("Set-Cookie", sessionCookie);
    return resp;
  } catch (error) {
    if (error.code === 'ALREADY_COMPLETE') return json({status:'COMPLETE',message:'This COR is already confirmed.'});
    if (error.code) { console.error("COR confirmation failed:", error.code, String(error?.message || error)); return jobError(error); }
    console.error("COR confirmation failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to confirm COR. Please try again." },
      500
    );
  }
}
