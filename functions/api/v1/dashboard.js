// GET /api/v1/dashboard — Authenticated student dashboard payload.
// Derives user from session, resolves active enrollment, academic branding,
// schedule, entries, buildings, tasks, and notes.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../auth/_lib.js";
import {
  CatalogSeed,
  Terms,
  Enrollments,
  Schedules,
  ScheduleEntries,
  CatalogBuildings,
  CatalogRooms,
  Programs,
  Departments,
  Campuses,
  Subjects,
  EnrollmentSubjects,
  Tasks,
  Notes,
} from "../repo/index.js";

export async function onRequestGet(context) {
  try {
    const session = await readPlatformSession(context);

    if (!session) {
      return json({ status: "UNAUTHENTICATED", authenticated: false }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "UNAUTHENTICATED", authenticated: false }, 401);
    }

    if (user.state === "DEACTIVATED") {
      return json({ status: "DEACTIVATED", error: "Account deactivated" }, 403);
    }

    if (user.state !== "ACTIVE") {
      return json({
        status: "INCOMPLETE",
        userState: user.state,
        routing: user.state === "ONBOARDING" ? "onboarding" : "login",
      });
    }

    // ── Active enrollment ───────────────────────────────────────────────
    const enrollments = Enrollments.getByUserId(user.userId);
    const activeEnrollment = enrollments.find((e) => e.status === "ACTIVE") || null;

    if (!activeEnrollment) {
      return json({
        status: "OK",
        authenticated: true,
        routing: "dashboard",
        enrollment: null,
        schedule: null,
        entries: [],
        buildings: [],
        tasks: formatDashboardTasks(user.userId),
        notes: formatDashboardNotes(user.userId),
        academic: buildAcademicContext(null),
        profile: buildProfile(user),
      });
    }

    // ── Schedule (looked up by enrollmentId) ────────────────────────────
    const schedule = Schedules.getActiveByUserId(user.userId);

    // ── Entries ─────────────────────────────────────────────────────────
    const rawEntries = schedule
      ? ScheduleEntries.getByScheduleId(schedule.scheduleId)
      : [];

    // ── Resolve entry details (subject, building, room) ─────────────────
    const entries = rawEntries.map((e) => {
      // enrollmentSubjectId is an ens_... ID (from EnrollmentSubjects), not a subject_... ID
      const ens = e.enrollmentSubjectId
        ? EnrollmentSubjects.getById(e.enrollmentSubjectId)
        : null;
      // Also try catalog Subjects for matching subjectId
      const catalogSubject = ens?.matchedSubjectId
        ? Subjects.getById(ens.matchedSubjectId)
        : null;
      const subjectCode = ens?.subjectCodeSnapshot || catalogSubject?.subjectCode || "";
      const subjectTitle = ens?.subjectTitleSnapshot || catalogSubject?.title || "";
      const building = e.buildingId
        ? CatalogBuildings.getById(e.buildingId)
        : null;
      const room = e.roomId
        ? CatalogRooms.getById(e.roomId)
        : null;

      // Parse time strings to get minutes for frontend sorting/filtering
      const startMinutes = timeToMinutes(e.startTime);
      const endMinutes = timeToMinutes(e.endTime);

      // Normalize day to title case ("Monday", "Tuesday", ...) to match QCU_TIME.weekday()
      const dayNumToName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      let normalizedDay = e.dayLabel || "";
      if (!normalizedDay && typeof e.dayOfWeek === "number") {
        normalizedDay = dayNumToName[e.dayOfWeek] || "";
      } else if (!normalizedDay && typeof e.dayOfWeek === "string") {
        // Handle "MONDAY" -> "Monday"
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
      };
    });

    // ── Buildings — derive from entries + campus buildings ───────────────
    const buildingIds = new Set();
    for (const e of rawEntries) {
      if (e.buildingId) buildingIds.add(e.buildingId);
    }
    const buildings = [];
    for (const bid of buildingIds) {
      const building = CatalogBuildings.getById(bid);
      if (building) buildings.push(formatBuilding(building));
    }
    if (activeEnrollment.campusId) {
      const campusBuildings = CatalogBuildings.getByCampusId(activeEnrollment.campusId);
      for (const b of campusBuildings) {
        if (!buildings.find((x) => x.buildingId === b.buildingId)) {
          buildings.push(formatBuilding(b));
        }
      }
    }

    // ── Compute schedule summary ────────────────────────────────────────
    const daySet = new Set(entries.map((e) => e.day));
    const totalUnits = entries.reduce((sum, e) => sum + (e.units || 0), 0);

    // ── Academic context ────────────────────────────────────────────────
    const academic = buildAcademicContext(activeEnrollment);

    // ── Enrollment subjects (for task/note subject dropdown) ─────────────
    const enrollmentSubjects = EnrollmentSubjects.getByEnrollmentId(activeEnrollment.enrollmentId).map(es => ({
      enrollmentSubjectId: es.ensId,
      subjectCode: es.subjectCodeSnapshot || "",
      title: es.subjectTitleSnapshot || "",
      units: es.units || 0,
    }));
    academic.enrollmentSubjects = enrollmentSubjects;

    // ── Profile ─────────────────────────────────────────────────────────
    const profile = buildProfile(user);

    return json({
      status: "OK",
      authenticated: true,
      routing: "dashboard",
      enrollment: {
        enrollmentId: activeEnrollment.enrollmentId,
        programId: activeEnrollment.programId,
        campusId: activeEnrollment.campusId,
        termId: activeEnrollment.termId,
        yearLevel: activeEnrollment.yearLevel,
        section: activeEnrollment.sectionLabelSnapshot,
        status: activeEnrollment.status,
        createdAt: activeEnrollment.createdAt,
      },
      schedule: schedule
        ? {
            scheduleId: schedule.scheduleId,
            subjectCount: entries.length,
            totalUnits,
            dayCount: daySet.size,
            isActive: schedule.isActive,
            revisionNumber: schedule.revisionNumber,
          }
        : null,
      entries,
      buildings,
      tasks: formatDashboardTasks(user.userId),
      notes: formatDashboardNotes(user.userId),
      academic,
      profile,
    });
  } catch (error) {
    console.error("Dashboard fetch failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to load dashboard" }, 500);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildAcademicContext(enrollment) {
  const meta = CatalogSeed.isLoaded() ? CatalogSeed.meta() : null;
  const currentTerm = Terms.getCurrent();

  if (!enrollment) {
    return {
      catalogVersion: meta?.version || null,
      currentTermId: currentTerm?.termId || null,
      currentTermName: currentTerm?.name || null,
      program: null,
      department: null,
      campus: null,
      term: null,
    };
  }

  const program = Programs.getById(enrollment.programId) || null;
  const department = program
    ? Departments.getById(program.departmentId) || null
    : null;
  const campus = enrollment.campusId
    ? Campuses.getById(enrollment.campusId) || null
    : null;
  const term = enrollment.termId
    ? Terms.getById(enrollment.termId) || null
    : null;

  return {
    catalogVersion: meta?.version || null,
    currentTermId: currentTerm?.termId || null,
    currentTermName: currentTerm?.name || null,
    program: program
      ? {
          programId: program.programId,
          name: program.name,
          code: program.programCode,
          abbrev: program.abbreviation || program.name,
          departmentId: program.departmentId,
        }
      : null,
    department: department
      ? {
          departmentId: department.departmentId,
          name: department.name,
          code: department.departmentCode,
        }
      : null,
    campus: campus
      ? {
          campusId: campus.campusId,
          name: campus.name,
          code: campus.campusCode,
        }
      : null,
    term: term
      ? {
          termId: term.termId,
          name: term.name,
          shortName: term.shortName,
          academicYear: term.academicYear,
          semester: term.semester,
        }
      : null,
  };
}

function buildProfile(user) {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    picture: user.picture,
    state: user.state,
    role: user.role,
    profile: user.profile || null,
  };
}

function formatBuilding(building) {
  return {
    buildingId: building.buildingId,
    code: building.buildingCode,
    name: building.name,
    shortName: building.shortName || building.name,
    campusId: building.campusId,
    floors: building.floors || 1,
    rooms: building.rooms || [],
    lat: building.lat || null,
    lng: building.lng || null,
  };
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(":");
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ── Dashboard productivity helpers ────────────────────────────────────

function formatDashboardTasks(userId) {
  const tasks = Tasks.getByUserId(userId);
  return tasks.slice(0, 20).map((t) => {
    const subject = t.subjectId ? Subjects.getById(t.subjectId) : null;
    const ens = t.enrollmentSubjectId ? EnrollmentSubjects.getById(t.enrollmentSubjectId) : null;
    return {
      taskId: t.taskId,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      subjectId: t.subjectId,
      subjectCode: subject?.subjectCode || ens?.subjectCodeSnapshot || null,
      subjectName: subject?.title || ens?.subjectTitleSnapshot || null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });
}

function formatDashboardNotes(userId) {
  const notes = Notes.getByUserId(userId);
  return notes.slice(0, 20).map((n) => {
    const subject = n.subjectId ? Subjects.getById(n.subjectId) : null;
    const ens = n.enrollmentSubjectId ? EnrollmentSubjects.getById(n.enrollmentSubjectId) : null;
    return {
      noteId: n.noteId,
      title: n.title,
      body: n.body,
      status: n.status,
      subjectId: n.subjectId,
      subjectCode: subject?.subjectCode || ens?.subjectCodeSnapshot || null,
      subjectName: subject?.title || ens?.subjectTitleSnapshot || null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  });
}
