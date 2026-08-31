// GET /api/v1/schedule — List schedule entries for authenticated user's active enrollment.
// Returns all entries with resolved subject/building/room details.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import {
  Enrollments,
  Schedules,
  ScheduleEntries,
  Subjects,
  CatalogBuildings,
  CatalogRooms,
} from "../../repo/index.js";

export async function onRequestGet(context) {
  try {
    const session = await readPlatformSession(context);
    if (!session) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    if (user.state === "DEACTIVATED") {
      return json({ status: "FORBIDDEN", error: "Account deactivated" }, 403);
    }

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    // ── Resolve active enrollment ──────────────────────────────────────
    const enrollments = Enrollments.getByUserId(user.userId);
    const activeEnrollment = enrollments.find((e) => e.status === "ACTIVE") || null;

    if (!activeEnrollment) {
      return json({
        ok: true,
        data: {
          enrollment: null,
          schedule: null,
          entries: [],
        },
      });
    }

    // ── Resolve active schedule ────────────────────────────────────────
    const schedule = Schedules.getActiveByUserId(user.userId);

    if (!schedule) {
      return json({
        ok: true,
        data: {
          enrollment: {
            enrollmentId: activeEnrollment.enrollmentId,
            programId: activeEnrollment.programId,
            campusId: activeEnrollment.campusId,
            termId: activeEnrollment.termId,
            yearLevel: activeEnrollment.yearLevel,
            section: activeEnrollment.sectionLabelSnapshot,
          },
          schedule: null,
          entries: [],
        },
      });
    }

    // ── Resolve entries ────────────────────────────────────────────────
    const rawEntries = ScheduleEntries.getByScheduleId(schedule.scheduleId);
    const entries = rawEntries
      .filter((e) => e.status === "ACTIVE")
      .map((e) => resolveEntry(e));

    return json({
      ok: true,
      data: {
        enrollment: {
          enrollmentId: activeEnrollment.enrollmentId,
          programId: activeEnrollment.programId,
          campusId: activeEnrollment.campusId,
          termId: activeEnrollment.termId,
          yearLevel: activeEnrollment.yearLevel,
          section: activeEnrollment.sectionLabelSnapshot,
        },
        schedule: {
          scheduleId: schedule.scheduleId,
          revisionNumber: schedule.revisionNumber,
          isActive: schedule.isActive,
          status: schedule.status,
        },
        entries,
      },
    });
  } catch (error) {
    console.error("Schedule fetch failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to load schedule" }, 500);
  }
}

function resolveEntry(e) {
  const subject = e.enrollmentSubjectId
    ? Subjects.getById(e.enrollmentSubjectId)
    : null;
  const building = e.buildingId
    ? CatalogBuildings.getById(e.buildingId)
    : null;
  const room = e.roomId
    ? CatalogRooms.getById(e.roomId)
    : null;

  return {
    entryId: e.smeId,
    scheduleId: e.scheduleId,
    enrollmentSubjectId: e.enrollmentSubjectId,
    code: subject?.subjectCode || "",
    title: subject?.title || "",
    units: subject?.units || 0,
    modality: e.modality || "ONSITE",
    dayOfWeek: e.dayOfWeek,
    startTime: e.startTime,
    endTime: e.endTime,
    buildingId: e.buildingId,
    buildingCode: building?.buildingCode || "",
    buildingName: building?.name || "",
    roomId: e.roomId,
    roomCode: room?.roomCode || "",
    floor: room?.floor || null,
    locationText: e.locationText || "",
    originType: e.originType || "COR_IMPORT",
    sortOrder: e.sortOrder || 0,
    status: e.status,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
