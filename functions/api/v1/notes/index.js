// GET/POST /api/v1/notes — List or create notes for the authenticated user.

import {
  resolveUser,
  flushRepo,
  json,
} from "../../auth/_lib.js";
import {
  Notes,
  Subjects,
  EnrollmentSubjects,
  ScheduleEntries,
} from "../../repo/index.js";

// ── GET (list notes) ──────────────────────────────────────────────────

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    const notes = Notes.getByUserId(user.userId);

    // ── Resolve related entities for display ────────────────────────────
    const data = notes.map((n) => {
      const subject = n.subjectId ? Subjects.getById(n.subjectId) : null;
      const ens = n.enrollmentSubjectId ? EnrollmentSubjects.getById(n.enrollmentSubjectId) : null;
      const entry = n.scheduleEntryId ? ScheduleEntries.getById(n.scheduleEntryId) : null;

      return {
        noteId: n.noteId,
        title: n.title,
        body: n.body,
        status: n.status,
        subjectId: n.subjectId,
        subjectCode: subject?.subjectCode || ens?.subjectCodeSnapshot || null,
        subjectName: subject?.title || ens?.subjectTitleSnapshot || null,
        enrollmentSubjectId: n.enrollmentSubjectId,
        scheduleEntryId: n.scheduleEntryId,
        scheduleDay: entry?.dayOfWeek || null,
        scheduleTime: entry ? `${entry.startTime}–${entry.endTime}` : null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      };
    });

    return json({ ok: true, data });
  } catch (error) {
    console.error("Notes list failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to list notes" }, 500);
  }
}

// ── POST (create note) ────────────────────────────────────────────────

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

    // ── Parse body
    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ status: "VALIDATION_FAILED", error: "Invalid JSON body" }, 422);
    }

    const { title } = body;
    if (!title || !String(title).trim()) {
      return json({ status: "VALIDATION_FAILED", error: "Title is required" }, 422);
    }

    // ── Validate optional schedule references ───────────────────────────
    let subjectId = body.subjectId || null;
    let enrollmentSubjectId = body.enrollmentSubjectId || null;
    let scheduleEntryId = body.scheduleEntryId || null;

    if (enrollmentSubjectId) {
      const ens = EnrollmentSubjects.getById(enrollmentSubjectId);
      if (!ens || ens.userId !== user.userId) {
        return json({ status: "VALIDATION_FAILED", error: "Invalid enrollmentSubjectId" }, 422);
      }
      if (!subjectId && ens.subjectId) {
        subjectId = ens.subjectId;
      }
    }

    if (scheduleEntryId) {
      const entry = ScheduleEntries.getById(scheduleEntryId);
      if (!entry || entry.userId !== user.userId) {
        return json({ status: "VALIDATION_FAILED", error: "Invalid scheduleEntryId" }, 422);
      }
    }

    // ── Create note ────────────────────────────────────────────────────
    const note = Notes.create({
      userId: user.userId,
      title: String(title).trim(),
      body: String(body.body || "").trim(),
      subjectId,
      enrollmentSubjectId,
      scheduleEntryId,
    });

    const subject = note.subjectId ? Subjects.getById(note.subjectId) : null;
    const ens = note.enrollmentSubjectId ? EnrollmentSubjects.getById(note.enrollmentSubjectId) : null;
    const entry = note.scheduleEntryId ? ScheduleEntries.getById(note.scheduleEntryId) : null;

    await flushRepo(context, resolved.session);

    return json({
      ok: true,
      data: {
        noteId: note.noteId,
        title: note.title,
        body: note.body,
        status: note.status,
        subjectId: note.subjectId,
        subjectCode: subject?.subjectCode || ens?.subjectCodeSnapshot || null,
        subjectName: subject?.title || ens?.subjectTitleSnapshot || null,
        enrollmentSubjectId: note.enrollmentSubjectId,
        scheduleEntryId: note.scheduleEntryId,
        scheduleDay: entry?.dayOfWeek || null,
        scheduleTime: entry ? `${entry.startTime}–${entry.endTime}` : null,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    }, 201);
  } catch (error) {
    console.error("Note creation failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to create note" }, 500);
  }
}
