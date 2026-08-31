// GET/POST /api/v1/tasks — List or create tasks for the authenticated user.

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

// ── GET (list tasks) ──────────────────────────────────────────────────

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

    if (user.state !== "ACTIVE") {
      return json({ status: "FORBIDDEN", error: "Account not active" }, 403);
    }

    const tasks = Tasks.getByUserId(user.userId);

    // ── Resolve related entities for display ────────────────────────────
    const data = tasks.map((t) => {
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
    });

    return json({ ok: true, data });
  } catch (error) {
    console.error("Tasks list failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to list tasks" }, 500);
  }
}

// ── POST (create task) ────────────────────────────────────────────────

export async function onRequestPost(context) {
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

    // ── Parse body ─────────────────────────────────────────────────────
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

    // ── Validate priority ──────────────────────────────────────────────
    const priority = (body.priority || "MEDIUM").toUpperCase();
    if (!VALID_PRIORITIES.includes(priority)) {
      return json({ status: "VALIDATION_FAILED", error: "Invalid priority. Must be LOW, MEDIUM, or HIGH" }, 422);
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

    // ── Validate dueDate format ────────────────────────────────────────
    const dueDate = body.dueDate || null;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate))) {
      return json({ status: "VALIDATION_FAILED", error: "dueDate must be YYYY-MM-DD format" }, 422);
    }

    // ── Create task ────────────────────────────────────────────────────
    const task = Tasks.create({
      userId: user.userId,
      title: String(title).trim(),
      description: String(body.description || "").trim(),
      priority,
      subjectId,
      enrollmentSubjectId,
      scheduleEntryId,
      dueDate,
    });

    const subject = task.subjectId ? Subjects.getById(task.subjectId) : null;
    const ens = task.enrollmentSubjectId ? EnrollmentSubjects.getById(task.enrollmentSubjectId) : null;
    const entry = task.scheduleEntryId ? ScheduleEntries.getById(task.scheduleEntryId) : null;

    return json({
      ok: true,
      data: {
        taskId: task.taskId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate,
        completedAt: task.completedAt,
        subjectId: task.subjectId,
        subjectCode: subject?.subjectCode || ens?.subjectCodeSnapshot || null,
        subjectName: subject?.title || ens?.subjectTitleSnapshot || null,
        enrollmentSubjectId: task.enrollmentSubjectId,
        scheduleEntryId: task.scheduleEntryId,
        scheduleDay: entry?.dayOfWeek || null,
        scheduleTime: entry ? `${entry.startTime}–${entry.endTime}` : null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    }, 201);
  } catch (error) {
    console.error("Task creation failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to create task" }, 500);
  }
}
