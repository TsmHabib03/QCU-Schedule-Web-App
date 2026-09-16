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
import { normalizeDayOfWeek, normalizeTime, isClockTime } from "../../../_lib/day-time.js";

const VALID_MODALITIES = ["ONSITE", "ONLINE", "HYBRID", "TBA"];

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
    // Day and time arrive in whatever shape the caller has (numeric day from
    // COR, "8:00 AM", "8:00") and are stored canonically.
    const dayOfWeek = normalizeDayOfWeek(body.dayOfWeek) || normalizeDayOfWeek(entry.dayOfWeek);
    const startTime = normalizeTime(body.startTime) || normalizeTime(entry.startTime);
    const endTime = normalizeTime(body.endTime) || normalizeTime(entry.endTime);
    const modality = body.modality || entry.modality;
    const buildingId = body.buildingId !== undefined ? body.buildingId : entry.buildingId;
    const roomId = body.roomId !== undefined ? body.roomId : entry.roomId;
    const locationText = body.locationText !== undefined ? body.locationText : entry.locationText;

    // ── Validate dayOfWeek ─────────────────────────────────────────────
    if (!dayOfWeek) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid dayOfWeek" }, 422);
    }

    // ── Validate times ─────────────────────────────────────────────────
    if (body.startTime !== undefined || body.endTime !== undefined) {
      if (!isClockTime(startTime) || !isClockTime(endTime)) {
        return json({ status: "VALIDATION_FAILED", error: "Time must be HH:mm format (24h)" }, 422);
      }
      if (startTime >= endTime) {
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

    // ── Resolve the subject ────────────────────────────────────────────
    // Only touched when the caller actually asks for a different subject — a
    // day-only edit must never fail because the existing subject id cannot be
    // re-resolved (that is what broke "move my class to Monday"). A subject
    // *code* is accepted and resolved to the enrollment's subject row, so older
    // clients that only know codes keep working.
    let enrollmentSubjectId = entry.enrollmentSubjectId;
    const requestedSubject =
      typeof body.enrollmentSubjectId === "string" ? body.enrollmentSubjectId.trim() : null;

    if (requestedSubject && requestedSubject !== entry.enrollmentSubjectId) {
      const ens =
        EnrollmentSubjects.getById(requestedSubject) ||
        EnrollmentSubjects.resolveByCode(enrollment.enrollmentId, requestedSubject);

      if (ens) {
        if (ens.enrollmentId !== enrollment.enrollmentId) {
          return json({ status: "FORBIDDEN", error: "Subject does not belong to your enrollment" }, 403);
        }
        enrollmentSubjectId = ens.ensId;
      } else if (!EnrollmentSubjects.getById(entry.enrollmentSubjectId)) {
        // Neither the requested subject nor this class's own subject exists in
        // the catalog (a legacy COR import, or a COR that was re-confirmed and
        // recreated its subject rows). There is nothing sane to compare against,
        // so keep the class's existing subject rather than stranding the save —
        // editing the day or time must still work.
        enrollmentSubjectId = entry.enrollmentSubjectId;
      } else {
        return json({ status: "VALIDATION_FAILED", error: "Enrollment subject not found" }, 422);
      }
    }

    // ── Check exact duplicate first (excluding self) ───────────────────
    // This has to run BEFORE the overlap check. An identical class sitting in
    // the table (a COR confirmed twice, or an old copy) overlaps the one being
    // edited, so the overlap rule answered first and reported a phantom clash
    // with a class the student believed was the same class. Naming it a
    // duplicate is the accurate, actionable answer.
    const allEntries = ScheduleEntries.getByScheduleId(entry.scheduleId);
    const duplicate = allEntries.find(
      (e) =>
        e.smeId !== entryId &&
        e.status === "ACTIVE" &&
        e.enrollmentSubjectId === enrollmentSubjectId &&
        normalizeDayOfWeek(e.dayOfWeek) === dayOfWeek &&
        normalizeTime(e.startTime) === startTime &&
        normalizeTime(e.endTime) === endTime
    );
    if (duplicate) {
      return json({
        ok: false,
        error: {
          code: "DUPLICATE",
          message: `You already have this class on ${dayOfWeek} ${startTime}-${endTime}. It looks like a duplicate, not a different class - delete the extra copy instead of editing this one.`,
          duplicateEntryId: duplicate.smeId,
        },
      }, 409);
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
      const clash = conflicts[0];
      return json({
        ok: false,
        error: {
          code: "SCHEDULE_CONFLICT",
          message: `That clashes with another class on ${clash.dayOfWeek} ${clash.startTime}-${clash.endTime}.`,
          conflicts: conflicts.map((c) => ({
            entryId: c.smeId,
            enrollmentSubjectId: c.enrollmentSubjectId,
            dayOfWeek: c.dayOfWeek,
            startTime: c.startTime,
            endTime: c.endTime,
          })),
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
      enrollmentSubjectId,
    };
    if (body.sortOrder !== undefined) {
      updates.sortOrder = body.sortOrder;
    }

    const updated = ScheduleEntries.update(entry, updates);

    // ── Resolve and return ─────────────────────────────────────────────
    // The subject comes from the enrollment's own row (that is where COR import
    // stored the code/title snapshot); the catalog is only a fallback.
    const ens = EnrollmentSubjects.getById(updated.enrollmentSubjectId);
    const catalogSubject = ens?.matchedSubjectId ? Subjects.getById(ens.matchedSubjectId) : null;
    const building = updated.buildingId ? CatalogBuildings.getById(updated.buildingId) : null;
    const room = updated.roomId ? CatalogRooms.getById(updated.roomId) : null;

    await flushRepo(context, resolved.session);

    return json({
      ok: true,
      data: {
        entryId: updated.smeId,
        scheduleId: updated.scheduleId,
        enrollmentSubjectId: updated.enrollmentSubjectId,
        code: ens?.subjectCodeSnapshot || catalogSubject?.subjectCode || "",
        title: ens?.subjectTitleSnapshot || catalogSubject?.title || "",
        units: ens?.units || catalogSubject?.units || 0,
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
