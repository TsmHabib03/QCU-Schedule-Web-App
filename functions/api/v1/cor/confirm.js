// POST /api/v1/cor/confirm
// Final confirmation: validates reviewed draft, creates student profile,
// enrollment, enrollment subjects, schedule, and schedule entries.
// Transitions user to ACTIVE state.

import {
  resolveUser,
  refreshSession,
  json,
  compactDraft,
  compactDashboardSnapshot,
} from "../../auth/_lib.js";
import {
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

// In-memory stores for confirmed data — NOW DELEGATED TO REPO
// (Profiles, Enrollments, EnrollmentSubjects, Schedules, ScheduleEntries
//  are imported from the repo module above)

const DAY_MAP = {
  "Monday": 1, "Tuesday": 2, "Wednesday": 3,
  "Thursday": 4, "Friday": 5, "Saturday": 6, "Sunday": 0,
};

// ---------------------------------------------------------------------------
// Helpers — extract value from either full ({ value, sourceText, confidence })
// or compact (plain value) draft formats.
// ---------------------------------------------------------------------------
function val(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && !Array.isArray(v) && "value" in v) return v.value;
  return v;
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

      // Validate schedule days
      const schedule = s.schedule || s.meetings;
      if (schedule) {
        for (let j = 0; j < schedule.length; j++) {
          const m = schedule[j];
          const dayVal = val(m.day) || val(m.dayOfWeek);
          if (dayVal && !(dayVal in DAY_MAP)) {
            issues.push({ field: `subjects[${i}].schedule[${j}].day`, message: `Invalid day: ${dayVal}` });
          }
          const start = val(m.time?.start) || val(m.startTime);
          const end = val(m.time?.end) || val(m.endTime);
          if (start && end) {
            if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
              issues.push({ field: `subjects[${i}].schedule[${j}].time`, message: "Invalid time format." });
            }
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
            const d1 = val(m1.day) || val(m1.dayOfWeek);
            const d2 = val(m2.day) || val(m2.dayOfWeek);
            if (d1 !== d2) continue;
            const s1t = val(m1.time?.start) || val(m1.startTime);
            const e1 = val(m1.time?.end) || val(m1.endTime);
            const s2t = val(m2.time?.start) || val(m2.startTime);
            const e2 = val(m2.time?.end) || val(m2.endTime);
            if (s1t && e1 && s2t && e2) {
              if (s1t < e2 && s2t < e1) {
                issues.push({
                  field: "schedule",
                  message: `Schedule conflict: ${val(s1.subjectCode)} and ${val(s2.subjectCode)} on ${d1} (${s1t}-${e1} vs ${s2t}-${e2})`,
                });
              }
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
  // 1. Create Student Profile
  const profile = Profiles.create({
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
    enrollmentId: enrollment.enrollmentId,
    userId: user.userId,
    sourceType: "COR_IMPORT",
    sourceCorRecordId: user.corRecordId,
  });

  let entryIndex = 0;
  for (const subject of draft.subjects) {
    const enrollmentSubject = EnrollmentSubjects.create({
      enrollmentId: enrollment.enrollmentId,
      userId: user.userId,
      subjectCodeSnapshot: val(subject.subjectCode),
      subjectTitleSnapshot: val(subject.subjectName),
      units: val(subject.units) || 0,
      matchedSubjectId: subject.matchedSubjectId || null,
      matchedRoomId: subject.room?.matchedRoomId || null,
      matchedBuildingId: subject.room?.matchedBuildingId || null,
      roomSnapshot: val(subject.room) || null,
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
        ScheduleEntries.create({
          scheduleId: schedule.scheduleId,
          enrollmentId: enrollment.enrollmentId,
          userId: user.userId,
          enrollmentSubjectId: enrollmentSubject.ensId,
          dayOfWeek: DAY_MAP[dayVal] ?? null,
          dayLabel: dayVal || null,
          startTime: startVal || null,
          endTime: endVal || null,
          locationText: val(subject.room) || null,
          buildingId: subject.room?.matchedBuildingId || null,
          roomId: subject.room?.matchedRoomId || null,
          sortOrder: entryIndex,
        });
      }
    }
  }

  // 5. Update COR record to COMPLETE
  const corRecord = CorRecords.getById(user.corRecordId);
  if (corRecord) {
    CorRecords.update(corRecord, { status: "COMPLETE" });
  }

  // 6. Update user state
  user.state = "ACTIVE";
  // Update user.name with COR-extracted name so it's used everywhere
  const nameParts = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean);
  if (nameParts.length) user.name = nameParts.join(" ");
  user.profile = {
    profileId: profile.profileId,
    studentNumber: profile.studentNumber,
    firstName: profile.firstName,
    middleName: profile.middleName,
    lastName: profile.lastName,
    suffix: profile.suffix,
    verificationStatus: profile.verificationStatus,
  };

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

    if (user.state !== "ONBOARDING" || !user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import to confirm." },
        400
      );
    }

    // --- Get COR record (Maps or session fallback) ---
    const record = CorRecords.getById(user.corRecordId);
    if (record && record.status !== "REVIEW_REQUIRED") {
      return json(
        { status: "ERROR", error: `Cannot confirm COR in state: ${record.status}` },
        400
      );
    }

    // --- Get extraction draft (Maps or session fallback) ---
    let draft = record ? CorDrafts.get(record.id) : null;
    if (!draft && user.corDraft) {
      // CF Pages: draft stored in session cookie during upload
      console.log("Using draft from session cookie (CF Pages path)");
      draft = user.corDraft;
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

    const DAY_NUM = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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
      let normalizedDay = e.dayLabel || "";
      if (!normalizedDay && typeof e.dayOfWeek === "number") {
        normalizedDay = DAY_NUM[e.dayOfWeek] || "";
      } else if (!normalizedDay && typeof e.dayOfWeek === "string") {
        normalizedDay = e.dayOfWeek.charAt(0).toUpperCase() + e.dayOfWeek.slice(1).toLowerCase();
      }
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
    console.error("COR confirmation failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to confirm COR. Please try again." },
      500
    );
  }
}
