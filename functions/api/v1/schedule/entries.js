// POST /api/v1/schedule/entries — Create a new schedule entry for authenticated user.
// Validates ownership, catalog references, time constraints, and conflicts.

import {
  resolveUser,
  json,
} from "../../auth/_lib.js";
import {
  Enrollments,
  Schedules,
  ScheduleEntries,
  Subjects,
  EnrollmentSubjects,
  CatalogBuildings,
  CatalogRooms,
} from "../../repo/index.js";

const VALID_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const VALID_MODALITIES = ["ONSITE", "ONLINE", "HYBRID", "TBA"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function onRequestPost(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    // ── Parse body ─────────────────────────────────────────────────────
    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ status: "VALIDATION_FAILED", error: "Invalid JSON body" }, 422);
    }

    // ── Resolve active enrollment ──────────────────────────────────────
    const enrollments = Enrollments.getByUserId(user.userId);
    const activeEnrollment = enrollments.find((e) => e.status === "ACTIVE");
    if (!activeEnrollment) {
      return json({ status: "VALIDATION_FAILED", error: "No active enrollment" }, 422);
    }

    // ── Resolve active schedule ────────────────────────────────────────
    const schedule = Schedules.getActiveByUserId(user.userId);
    if (!schedule) {
      return json({ status: "VALIDATION_FAILED", error: "No active schedule" }, 422);
    }

    // ── Validate enrollmentSubjectId ───────────────────────────────────
    const { enrollmentSubjectId } = body;
    if (!enrollmentSubjectId) {
      return json({ status: "VALIDATION_FAILED", error: "enrollmentSubjectId is required" }, 422);
    }

    const ens = EnrollmentSubjects.getById(enrollmentSubjectId);
    if (!ens) {
      return json({ status: "VALIDATION_FAILED", error: "Enrollment subject not found" }, 422);
    }
    if (ens.enrollmentId !== activeEnrollment.enrollmentId) {
      return json({ status: "FORBIDDEN", error: "Subject does not belong to your enrollment" }, 403);
    }
    if (ens.userId !== user.userId) {
      return json({ status: "FORBIDDEN", error: "Subject does not belong to you" }, 403);
    }

    // ── Validate dayOfWeek ─────────────────────────────────────────────
    const { dayOfWeek } = body;
    if (!dayOfWeek || !VALID_DAYS.includes(dayOfWeek)) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid dayOfWeek" }, 422);
    }

    // ── Validate times ─────────────────────────────────────────────────
    const { startTime, endTime } = body;
    if (!startTime || !endTime) {
      return json({ status: "VALIDATION_FAILED", error: "startTime and endTime are required" }, 422);
    }
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      return json({ status: "VALIDATION_FAILED", error: "Time must be HH:mm format (24h)" }, 422);
    }
    if (startTime >= endTime) {
      return json({ status: "VALIDATION_FAILED", error: "endTime must be after startTime" }, 422);
    }

    // ── Validate modality ──────────────────────────────────────────────
    const modality = body.modality || "ONSITE";
    if (!VALID_MODALITIES.includes(modality)) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid modality" }, 422);
    }

    // ── Validate building/room ─────────────────────────────────────────
    const { buildingId, roomId } = body;
    if (buildingId) {
      const building = CatalogBuildings.getById(buildingId);
      if (!building) {
        return json({ status: "VALIDATION_FAILED", error: "Invalid buildingId" }, 422);
      }
      if (roomId) {
        const room = CatalogRooms.getById(roomId);
        if (!room) {
          return json({ status: "VALIDATION_FAILED", error: "Invalid roomId" }, 422);
        }
        if (room.buildingId !== buildingId) {
          return json({ status: "VALIDATION_FAILED", error: "Room does not belong to this building" }, 422);
        }
      }
    } else if (roomId) {
      return json({ status: "VALIDATION_FAILED", error: "buildingId is required when roomId is provided" }, 422);
    }

    // ── Check conflict ─────────────────────────────────────────────────
    const conflicts = ScheduleEntries.hasConflict(
      schedule.scheduleId,
      dayOfWeek,
      startTime,
      endTime,
      null // no excludeId for create
    );
    if (conflicts.length > 0) {
      return json({
        ok: false,
        error: {
          code: "SCHEDULE_CONFLICT",
          message: "This time overlaps with an existing class.",
          conflicts: conflicts.map((c) => ({
            entryId: c.smeId,
            dayOfWeek: c.dayOfWeek,
            startTime: c.startTime,
            endTime: c.endTime,
          })),
        },
      }, 409);
    }

    // ── Check exact duplicate ──────────────────────────────────────────
    const allEntries = ScheduleEntries.getByScheduleId(schedule.scheduleId);
    const isDuplicate = allEntries.some(
      (e) =>
        e.status === "ACTIVE" &&
        e.enrollmentSubjectId === enrollmentSubjectId &&
        e.dayOfWeek === dayOfWeek &&
        e.startTime === startTime &&
        e.endTime === endTime
    );
    if (isDuplicate) {
      return json({
        ok: false,
        error: {
          code: "DUPLICATE",
          message: "An identical entry already exists.",
        },
      }, 409);
    }

    // ── Determine sort order ───────────────────────────────────────────
    const existingEntries = allEntries.filter((e) => e.status === "ACTIVE");
    const sortOrder = body.sortOrder || (existingEntries.length + 1);

    // ── Create entry ───────────────────────────────────────────────────
    const entry = ScheduleEntries.create({
      scheduleId: schedule.scheduleId,
      enrollmentId: activeEnrollment.enrollmentId,
      userId: user.userId,
      enrollmentSubjectId,
      dayOfWeek,
      startTime,
      endTime,
      modality,
      buildingId: buildingId || null,
      roomId: roomId || null,
      locationText: body.locationText || null,
      sortOrder,
      originType: "STUDENT_MANUAL",
      status: "ACTIVE",
    });

    // ── Resolve and return ─────────────────────────────────────────────
    const subject = Subjects.getById(enrollmentSubjectId);
    const building = buildingId ? CatalogBuildings.getById(buildingId) : null;
    const room = roomId ? CatalogRooms.getById(roomId) : null;

    return json({
      ok: true,
      data: {
        entryId: entry.smeId,
        scheduleId: entry.scheduleId,
        enrollmentSubjectId: entry.enrollmentSubjectId,
        code: subject?.subjectCode || "",
        title: subject?.title || "",
        units: subject?.units || 0,
        modality: entry.modality,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        buildingId: entry.buildingId,
        buildingCode: building?.buildingCode || "",
        buildingName: building?.name || "",
        roomId: entry.roomId,
        roomCode: room?.roomCode || "",
        floor: room?.floor || null,
        locationText: entry.locationText || "",
        originType: entry.originType,
        sortOrder: entry.sortOrder,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    }, 201);
  } catch (error) {
    console.error("Schedule entry creation failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to create entry" }, 500);
  }
}
