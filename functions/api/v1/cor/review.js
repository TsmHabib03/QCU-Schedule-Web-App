// POST /api/v1/cor/review
// Saves student corrections to the extraction draft.
// Body: { studentInfo, enrollmentInfo, subjects }

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorDrafts } from "../../repo/index.js";

export async function onRequestPost(context) {
  try {
    const session = await readPlatformSession(context);
    if (!session) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "NOT_FOUND", error: "User not found" }, 404);
    }

    if (!user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import." },
        400
      );
    }

    const record = CorRecords.getById(user.corRecordId);
    if (!record) {
      return json(
        { status: "ERROR", error: "COR record not found." },
        404
      );
    }

    if (record.status !== "REVIEW_REQUIRED") {
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
    if (!si.firstName || !si.lastName || !si.studentNumber) {
      return json(
        { status: "ERROR", error: "Student first name, last name, and student number are required." },
        400
      );
    }

    // Validate enrollment info
    const ei = body.enrollmentInfo;
    if (!ei.program || !ei.yearLevel || !ei.term) {
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
      if (!subject.subjectCode || !subject.subjectName) {
        return json(
          { status: "ERROR", error: "Each subject must have a code and name." },
          400
        );
      }
    }

    // Update draft with student corrections
    const existingDraft = CorDrafts.get(record.id) || {};
    const updatedDraft = {
      ...existingDraft,
      studentInfo: body.studentInfo,
      enrollmentInfo: body.enrollmentInfo,
      subjects: body.subjects,
      totalUnits: body.subjects.reduce((sum, s) => sum + (s.units?.value || 0), 0),
      lastReviewedAt: new Date().toISOString(),
    };

    CorDrafts.set(record.id, updatedDraft);

    // Bump draft version
    CorRecords.update(record, { draftVersion: (record.draftVersion || 0) + 1 });

    return json({
      status: "OK",
      corRecordId: record.id,
      draftVersion: record.draftVersion,
      message: "Corrections saved. Ready to confirm.",
    });
  } catch (error) {
    console.error("COR review save failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to save corrections" },
      500
    );
  }
}
