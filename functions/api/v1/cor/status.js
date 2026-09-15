// GET /api/v1/cor/status
// Returns current COR processing status for the authenticated user.

import {
  resolveUser,
  json,
} from "../../auth/_lib.js";
import { CorRecords } from "../../repo/index.js";
import { jobError } from './_jobs.js';

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    // Find user's active COR record (Maps or session fallback)
    const params = new URL(context.request.url).searchParams;
    const requested = params.get('requestId') ? CorRecords.getByRequestId(user.userId, params.get('requestId')) : null;
    // An unknown requestId must not hide a live import. A stale client ID —
    // sessionStorage from an earlier attempt, or an upload lost before its
    // reserve write landed — used to wedge the flow on "has not appeared yet"
    // because every re-check re-sent the same dead ID. Fall back to the user's
    // active record so "Check again" can actually recover.
    const corRecordId = requested?.id || CorRecords.getActiveByUserId(user.userId)?.id || (!params.has('requestId') ? user.corRecordId : null);
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
        requestId: record.requestId,
        canResume: !record.leaseUntil || record.leaseUntil <= Date.now(),
        fileMissing: !!context.env.APPS_SCRIPT_URL && !record.driveFileId && !!record.requestId && ['ACCEPTED','QUEUED','PROCESSING'].includes(record.status),
      });
    }

    // CF Pages: Maps empty, infer status from session
    if (user.corDraft || user.corRecordStatus === "REVIEW_REQUIRED") {
      return json({
        status: "OK",
        hasImport: true,
        corRecordId,
        importStatus: "REVIEW_REQUIRED",
        filename: user.corDraft?.filename || "unknown.pdf",
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
    if (error.code) return jobError(error);
    console.error("COR status check failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to check status" }, 500);
  }
}
