// PATCH/DELETE /api/v1/tasks/[id] — Update or delete a task.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import {
  Tasks,
  Subjects,
  EnrollmentSubjects,
  ScheduleEntries,
} from "../../repo/index.js";

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const VALID_STATUSES = ["OPEN", "COMPLETED", "DELETED"];

// ── Helper: resolve task ID from URL ──────────────────────────────────

function getTaskId(url) {
  const parts = url.pathname.split("/");
  const id = parts[parts.length - 1];
  return id && id.startsWith("tsk_") ? id : null;
}

// ── Helper: build task response ───────────────────────────────────────

function formatTask(t) {
  const subject = t.subjectId ? Subjects.getById(t.subjectId) : null;
  const ens = t.enrollmentSubjectId ? EnrollmentSubjects.getById(t.enrollmentSubjectId) : null;
  const entry = t.scheduleEntryId ? ScheduleEntries.getById(t.scheduleEntryId) : null;

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
    enrollmentSubjectId: t.enrollmentSubjectId,
    scheduleEntryId: t.scheduleEntryId,
    scheduleDay: entry?.dayOfWeek || null,
    scheduleTime: entry ? `${entry.startTime}–${entry.endTime}` : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
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

    const taskId = getTaskId(new URL(context.request.url));
    if (!taskId) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid task ID" }, 422);
    }

    // ── Find task and verify ownership ─────────────────────────────────
    const task = Tasks.getById(taskId);
    if (!task) {
      return json({ status: "NOT_FOUND", error: "Task not found" }, 404);
    }
    if (task.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Task not found" }, 404);
    }
    if (task.status === "DELETED") {
      return json({ status: "NOT_FOUND", error: "Task not found" }, 404);
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

    if (body.description !== undefined) {
      updates.description = String(body.description).trim();
    }

    if (body.priority !== undefined) {
      const p = String(body.priority).toUpperCase();
      if (!VALID_PRIORITIES.includes(p)) {
        return json({ status: "VALIDATION_FAILED", error: "Invalid priority" }, 422);
      }
      updates.priority = p;
    }

    if (body.status !== undefined) {
      const s = String(body.status).toUpperCase();
      if (!VALID_STATUSES.includes(s)) {
        return json({ status: "VALIDATION_FAILED", error: "Invalid status" }, 422);
      }
      updates.status = s;
      if (s === "COMPLETED") {
        updates.completedAt = new Date().toISOString();
      } else if (s === "OPEN") {
        updates.completedAt = null;
      }
    }

    if (body.dueDate !== undefined) {
      const d = body.dueDate || null;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
        return json({ status: "VALIDATION_FAILED", error: "dueDate must be YYYY-MM-DD format" }, 422);
      }
      updates.dueDate = d;
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
    const updated = Tasks.update(task, updates);

    return json({ ok: true, data: formatTask(updated) });
  } catch (error) {
    console.error("Task update failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to update task" }, 500);
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

    const taskId = getTaskId(new URL(context.request.url));
    if (!taskId) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid task ID" }, 422);
    }

    // ── Find task and verify ownership ─────────────────────────────────
    const task = Tasks.getById(taskId);
    if (!task) {
      return json({ status: "NOT_FOUND", error: "Task not found" }, 404);
    }
    if (task.userId !== user.userId) {
      return json({ status: "NOT_FOUND", error: "Task not found" }, 404);
    }
    if (task.status === "DELETED") {
      return json({ status: "NOT_FOUND", error: "Task not found" }, 404);
    }

    // ── Soft-delete ────────────────────────────────────────────────────
    Tasks.delete(taskId);

    return json({
      ok: true,
      data: { taskId, status: "DELETED" },
    });
  } catch (error) {
    console.error("Task deletion failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to delete task" }, 500);
  }
}
