// POST /api/v1/cor/review
// Saves student corrections to the extraction draft.
// Body: { studentInfo, enrollmentInfo, subjects }
// Persist in the repository when available; the client carries its reviewed
// draft to confirmation when running without durable storage.

import {
  resolveUser,
  refreshSession,
  flushRepo,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorDrafts } from "../../repo/index.js";

export async function onRequestPost(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user, session } = resolved;

    if (!user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import." },
        400
      );
    }

    // --- Get record and existing draft (Maps or session fallback) ---
    const record = CorRecords.getById(user.corRecordId);
    if (record && record.status !== "REVIEW_REQUIRED") {
      return json(
        { status: "ERROR", error: `Cannot review COR in state: ${record.status}` },
        400
      );
    }

    const body = await context.request.json().catch(() => ({}));

    // Validate required fields
    if (!body.studentInfo || !body.enrollmentInfo || !body.subjects) {
      return json(
        { status: "ERROR", error: "Missing required fields: studentInfo, enrollmentInfo, subjects" },
        400
      );
    }

    // Validate student info
    const si = body.studentInfo;
    const value = (field) => field && typeof field === "object" ? field.value : field;
    const hasValue = (field) => String(value(field) ?? "").trim().length > 0;
    if (!hasValue(si.firstName) || !hasValue(si.lastName) || !hasValue(si.studentNumber)) {
      return json(
        { status: "ERROR", error: "Student first name, last name, and student number are required." },
        400
      );
    }

    // Validate enrollment info
    const ei = body.enrollmentInfo;
    if (!hasValue(ei.program) || !hasValue(ei.yearLevel) || !hasValue(ei.term)) {
      return json(
        { status: "ERROR", error: "Program, year level, and term are required." },
        400
      );
    }

    // Validate subjects
    if (!Array.isArray(body.subjects) || body.subjects.length === 0) {
      return json(
        { status: "ERROR", error: "At least one subject is required." },
        400
      );
    }

    for (const subject of body.subjects) {
      if (!hasValue(subject.subjectCode) || !hasValue(subject.subjectName)) {
        return json(
          { status: "ERROR", error: "Each subject must have a code and name." },
          400
        );
      }
    }

    // Update draft with student corrections
    // Accept draft from request body (CF Pages path: draft was not in session)
    const existingDraft = (record ? CorDrafts.get(record.id) : null) || user.corDraft || body.draft || {};
    const updatedDraft = {
      ...existingDraft,
      studentInfo: body.studentInfo,
      enrollmentInfo: body.enrollmentInfo,
      subjects: body.subjects,
      totalUnits: body.subjects.reduce((sum, s) => sum + (typeof s.units === "object" ? (s.units?.value || 0) : (s.units || 0)), 0),
      lastReviewedAt: new Date().toISOString(),
    };

    if (record) {
      CorDrafts.set(record.id, updatedDraft);
      CorRecords.update(record, { draftVersion: (record.draftVersion || 0) + 1 });
      await flushRepo(context, session);
    }

    // Keep drafts out of the cookie: even compact schedules can exceed 4 KB.
    const resp = json({
      status: "OK",
      corRecordId: record?.id || user.corRecordId,
      draftVersion: record?.draftVersion || 1,
      message: "Corrections saved. Ready to confirm.",
    });

    if (!record) {
      // The client sends the reviewed draft to confirmation as JSON.
      const sessionCookie = await refreshSession(context, session, {
        corDraft: null,
        corRecordStatus: "REVIEW_REQUIRED",
      });
      resp.headers.append("Set-Cookie", sessionCookie);
    }

    return resp;
  } catch (error) {
    console.error("COR review save failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to save corrections" },
      500
    );
  }
}
