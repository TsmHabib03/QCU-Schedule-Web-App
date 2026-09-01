// GET /api/v1/cor/status
// Returns current COR processing status for the authenticated user.

import {
  resolveUser,
  json,
} from "../../auth/_lib.js";
import { CorRecords } from "../../repo/index.js";

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    // Find user's active COR record (Maps or session fallback)
    const corRecordId = user.corRecordId;
    if (!corRecordId) {
      return json({
        status: "OK",
        hasImport: false,
        importStatus: null,
      });
    }

    const record = CorRecords.getById(corRecordId);
    if (record) {
      return json({
        status: "OK",
        hasImport: true,
        corRecordId: record.id,
        importStatus: record.status,
        filename: record.filename,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        failureCode: record.failureCode,
        failureStage: record.failureStage,
        draftVersion: record.draftVersion,
      });
    }

    // CF Pages: Maps empty, infer status from session
    if (user.corDraft) {
      return json({
        status: "OK",
        hasImport: true,
        corRecordId,
        importStatus: "REVIEW_REQUIRED",
        filename: user.corDraft.filename || "unknown.pdf",
        sizeBytes: 0,
        createdAt: null,
        updatedAt: null,
        failureCode: null,
        failureStage: null,
        draftVersion: 1,
      });
    }

    return json({
      status: "OK",
      hasImport: false,
      importStatus: null,
    });
  } catch (error) {
    console.error("COR status check failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to check status" }, 500);
  }
}
