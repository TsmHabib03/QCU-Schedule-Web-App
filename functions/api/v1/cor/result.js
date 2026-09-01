// GET /api/v1/cor/result
// Returns the extraction result (draft) for the authenticated user's active COR.

import {
  resolveUser,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorDrafts } from "../../repo/index.js";

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    if (!user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import." },
        400
      );
    }

    // --- Get record and draft (Maps or session fallback) ---
    const record = CorRecords.getById(user.corRecordId);
    let draft = record ? CorDrafts.get(record.id) : null;

    // CF Pages: Maps empty, use draft from session
    if (!draft && user.corDraft) {
      draft = user.corDraft;
      return json({
        status: "OK",
        corRecordId: user.corRecordId,
        importStatus: "REVIEW_REQUIRED",
        hasResult: true,
        draftVersion: 1,
        result: draft,
      });
    }

    if (!record) {
      return json(
        { status: "ERROR", error: "COR record not found." },
        404
      );
    }

    if (record.status !== "REVIEW_REQUIRED") {
      return json({
        status: "OK",
        corRecordId: record.id,
        importStatus: record.status,
        hasResult: false,
      });
    }

    if (!draft) {
      return json({
        status: "OK",
        corRecordId: record.id,
        importStatus: record.status,
        hasResult: false,
      });
    }

    return json({
      status: "OK",
      corRecordId: record.id,
      importStatus: record.status,
      hasResult: true,
      draftVersion: record.draftVersion,
      result: draft,
    });
  } catch (error) {
    console.error("COR result fetch failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to fetch result" }, 500);
  }
}
