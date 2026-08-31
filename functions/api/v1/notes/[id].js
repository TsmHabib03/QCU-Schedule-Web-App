// PATCH/DELETE /api/v1/notes/[id] — Update or delete a note.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import {
  Notes,
  Subjects,
  EnrollmentSubjects,
  ScheduleEntries,
} from "../../repo/index.js";

// ── Helper: resolve note ID from URL ──────────────────────────────────

function getNoteId(url) {
  const parts = url.pathname.split("/");
  const id = parts[parts.length - 1];
  return id && id.startsWith("nt_") ? id : null;
}

// ── Helper: build note response ───────────────────────────────────────

function formatNote(n) {
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
}

// ── PATCH (update) ────────────────────────────────────────────────────

export async function onRequestPatch(context) {
  try {
    const session = await readPlatformSession(context);
    if (!session) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    const noteId = getNoteId(new URL(context.request.url));
    if (!noteId) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid note ID" }, 422);
    }

    // ── Find note and verify ownership ─────────────────────────────────
    const note = Notes.getById(noteId);
    if (!note) {
      return json({ status: "NOT_FOUND", error: "Note not found" }, 404);
    }
    if (note.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Note not found" }, 404);
    }
    if (note.status === "DELETED") {
      return json({ status: "NOT_FOUND", error: "Note not found" }, 404);
    }

    // ── Parse body ─────────────────────────────────────────────────────
    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ status: "VALIDATION_FAILED", error: "Invalid JSON body" }, 422);
    }

    // ── Build updates ──────────────────────────────────────────────────
    const updates = {};

    if (body.title !== undefined) {
      const trimmed = String(body.title).trim();
      if (!trimmed) {
        return json({ status: "VALIDATION_FAILED", error: "Title cannot be empty" }, 422);
      }
      updates.title = trimmed;
    }

    if (body.body !== undefined) {
      updates.body = String(body.body).trim();
    }

    // ── Validate optional schedule references ───────────────────────────
    if (body.enrollmentSubjectId !== undefined) {
      if (body.enrollmentSubjectId) {
        const ens = EnrollmentSubjects.getById(body.enrollmentSubjectId);
        if (!ens || ens.userId !== user.userId) {
          return json({ status: "VALIDATION_FAILED", error: "Invalid enrollmentSubjectId" }, 422);
        }
        updates.enrollmentSubjectId = body.enrollmentSubjectId;
        if (!updates.subjectId && ens.subjectId) {
          updates.subjectId = ens.subjectId;
        }
      } else {
        updates.enrollmentSubjectId = null;
      }
    }

    if (body.subjectId !== undefined) {
      updates.subjectId = body.subjectId || null;
    }

    if (body.scheduleEntryId !== undefined) {
      if (body.scheduleEntryId) {
        const entry = ScheduleEntries.getById(body.scheduleEntryId);
        if (!entry || entry.userId !== user.userId) {
          return json({ status: "VALIDATION_FAILED", error: "Invalid scheduleEntryId" }, 422);
        }
      }
      updates.scheduleEntryId = body.scheduleEntryId || null;
    }

    // ── Apply updates ──────────────────────────────────────────────────
    const updated = Notes.update(note, updates);

    return json({ ok: true, data: formatNote(updated) });
  } catch (error) {
    console.error("Note update failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to update note" }, 500);
  }
}

// ── DELETE (soft-delete) ──────────────────────────────────────────────

export async function onRequestDelete(context) {
  try {
    const session = await readPlatformSession(context);
    if (!session) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "UNAUTHENTICATED", error: "Not authenticated" }, 401);
    }

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    const noteId = getNoteId(new URL(context.request.url));
    if (!noteId) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid note ID" }, 422);
    }

    // ── Find note and verify ownership ─────────────────────────────────
    const note = Notes.getById(noteId);
    if (!note) {
      return json({ status: "NOT_FOUND", error: "Note not found" }, 404);
    }
    if (note.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Note not found" }, 404);
    }
    if (note.status === "DELETED") {
      return json({ status: "NOT_FOUND", error: "Note not found" }, 404);
    }

    // ── Soft-delete ────────────────────────────────────────────────────
    Notes.delete(noteId);

    return json({
      ok: true,
      data: { noteId, status: "DELETED" },
    });
  } catch (error) {
    console.error("Note deletion failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to delete note" }, 500);
  }
}
