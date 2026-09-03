// PATCH/DELETE /api/v1/schedule/entries/[id] — Update or delete a schedule entry.
// Validates ownership chain, catalog references, time constraints, and conflicts.

import {
  resolveUser,
  flushRepo,
  json,
} from "../../../auth/_lib.js";
import {
  Enrollments,
  Schedules,
  ScheduleEntries,
  Subjects,
  EnrollmentSubjects,
  CatalogBuildings,
  CatalogRooms,
} from "../../../repo/index.js";

const VALID_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const VALID_MODALITIES = ["ONSITE", "ONLINE", "HYBRID", "TBA"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── PATCH (update) ─────────────────────────────────────────────────────

export async function onRequestPatch(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    // ── Extract entry ID from URL ──────────────────────────────────────
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split("/");
    const entryId = pathParts[pathParts.length - 1];

    if (!entryId || !entryId.startsWith("sme_")) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid entry ID" }, 422);
    }

    // ── Find entry and verify ownership ────────────────────────────────
    const entry = ScheduleEntries.getById(entryId);
    if (!entry) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    // Ownership chain: entry → schedule → enrollment → user
    if (entry.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    const schedule = Schedules.getById(entry.scheduleId);
    if (!schedule || schedule.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    const enrollment = Enrollments.getById(entry.enrollmentId);
    if (!enrollment || enrollment.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    if (enrollment.status !== "ACTIVE") {
      return json({ status: "VALIDATION_FAILED", error: "Enrollment is not active" }, 422);
    }

    if (!schedule.isActive || schedule.status !== "ACTIVE") {
      return json({ status: "VALIDATION_FAILED", error: "Schedule is not active" }, 422);
    }

    if (entry.status !== "ACTIVE") {
      return json({ status: "VALIDATION_FAILED", error: "Entry is not active" }, 422);
    }

    // ── Parse body ─────────────────────────────────────────────────────
    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ status: "VALIDATION_FAILED", error: "Invalid JSON body" }, 422);
    }

    // ── Merge updates ──────────────────────────────────────────────────
    const dayOfWeek = body.dayOfWeek || entry.dayOfWeek;
    const startTime = body.startTime || entry.startTime;
    const endTime = body.endTime || entry.endTime;
    const modality = body.modality || entry.modality;
    const buildingId = body.buildingId !== undefined ? body.buildingId : entry.buildingId;
    const roomId = body.roomId !== undefined ? body.roomId : entry.roomId;
    const locationText = body.locationText !== undefined ? body.locationText : entry.locationText;

    // ── Validate dayOfWeek ─────────────────────────────────────────────
    if (body.dayOfWeek && !VALID_DAYS.includes(body.dayOfWeek)) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid dayOfWeek" }, 422);
    }

    // ── Validate times ─────────────────────────────────────────────────
    if (body.startTime || body.endTime) {
      const st = body.startTime || startTime;
      const et = body.endTime || endTime;
      if (!TIME_RE.test(st) || !TIME_RE.test(et)) {
        return json({ status: "VALIDATION_FAILED", error: "Time must be HH:mm format (24h)" }, 422);
      }
      if (st >= et) {
        return json({ status: "VALIDATION_FAILED", error: "endTime must be after startTime" }, 422);
      }
    }

    // ── Validate modality ──────────────────────────────────────────────
    if (body.modality && !VALID_MODALITIES.includes(body.modality)) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid modality" }, 422);
    }

    // ── Validate building/room ─────────────────────────────────────────
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

    // ── Validate enrollmentSubjectId if changed ────────────────────────
    if (body.enrollmentSubjectId) {
      const ens = EnrollmentSubjects.getById(body.enrollmentSubjectId);
      if (!ens) {
        return json({ status: "VALIDATION_FAILED", error: "Enrollment subject not found" }, 422);
      }
      if (ens.enrollmentId !== enrollment.enrollmentId) {
        return json({ status: "FORBIDDEN", error: "Subject does not belong to your enrollment" }, 403);
      }
    }

    // ── Check conflict (excluding self) ────────────────────────────────
    const conflicts = ScheduleEntries.hasConflict(
      entry.scheduleId,
      dayOfWeek,
      startTime,
      endTime,
      entryId // exclude self
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

    // ── Check exact duplicate (excluding self) ─────────────────────────
    const allEntries = ScheduleEntries.getByScheduleId(entry.scheduleId);
    const isDuplicate = allEntries.some(
      (e) =>
        e.smeId !== entryId &&
        e.status === "ACTIVE" &&
        e.enrollmentSubjectId === (body.enrollmentSubjectId || entry.enrollmentSubjectId) &&
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

    // ── Update entry ───────────────────────────────────────────────────
    const updates = {
      dayOfWeek,
      startTime,
      endTime,
      modality,
      buildingId: buildingId || null,
      roomId: roomId || null,
      locationText: locationText || null,
    };
    if (body.enrollmentSubjectId) {
      updates.enrollmentSubjectId = body.enrollmentSubjectId;
    }
    if (body.sortOrder !== undefined) {
      updates.sortOrder = body.sortOrder;
    }

    const updated = ScheduleEntries.update(entry, updates);

    // ── Resolve and return ─────────────────────────────────────────────
    const subject = Subjects.getById(updated.enrollmentSubjectId);
    const building = updated.buildingId ? CatalogBuildings.getById(updated.buildingId) : null;
    const room = updated.roomId ? CatalogRooms.getById(updated.roomId) : null;

    await flushRepo(context, resolved.session);

    return json({
      ok: true,
      data: {
        entryId: updated.smeId,
        scheduleId: updated.scheduleId,
        enrollmentSubjectId: updated.enrollmentSubjectId,
        code: subject?.subjectCode || "",
        title: subject?.title || "",
        units: subject?.units || 0,
        modality: updated.modality,
        dayOfWeek: updated.dayOfWeek,
        startTime: updated.startTime,
        endTime: updated.endTime,
        buildingId: updated.buildingId,
        buildingCode: building?.buildingCode || "",
        buildingName: building?.name || "",
        roomId: updated.roomId,
        roomCode: room?.roomCode || "",
        floor: room?.floor || null,
        locationText: updated.locationText || "",
        originType: updated.originType,
        sortOrder: updated.sortOrder,
        status: updated.status,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Schedule entry update failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to update entry" }, 500);
  }
}

// ── DELETE (remove) ────────────────────────────────────────────────────

export async function onRequestDelete(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    // ── Extract entry ID from URL ──────────────────────────────────────
    const url = new URL(context.request.url);
    const pathParts = url.pathname.split("/");
    const entryId = pathParts[pathParts.length - 1];

    if (!entryId || !entryId.startsWith("sme_")) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid entry ID" }, 422);
    }

    // ── Find entry and verify ownership ────────────────────────────────
    const entry = ScheduleEntries.getById(entryId);
    if (!entry) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    if (entry.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    const schedule = Schedules.getById(entry.scheduleId);
    if (!schedule || schedule.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    const enrollment = Enrollments.getById(entry.enrollmentId);
    if (!enrollment || enrollment.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Entry not found" }, 404);
    }

    if (entry.status !== "ACTIVE") {
      return json({ status: "VALIDATION_FAILED", error: "Entry is already removed" }, 422);
    }

    // ── Soft-delete: mark as REMOVED ───────────────────────────────────
    ScheduleEntries.update(entry, { status: "REMOVED" });

    await flushRepo(context, resolved.session);

    return json({
      ok: true,
      data: {
        entryId: entry.smeId,
        status: "REMOVED",
      },
    });
  } catch (error) {
    console.error("Schedule entry deletion failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to delete entry" }, 500);
  }
}
