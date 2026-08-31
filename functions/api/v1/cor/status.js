// GET /api/v1/cor/status
// Returns current COR processing status for the authenticated user.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import { CorRecords } from "../../repo/index.js";

export async function onRequestGet(context) {
  try {
    const session = await readPlatformSession(context);
    if (!session) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "NOT_FOUND", error: "User not found" }, 404);
    }

    // Find user's active COR record
    const corRecordId = user.corRecordId;
    if (!corRecordId) {
      return json({
        status: "OK",
        hasImport: false,
        importStatus: null,
      });
    }

    const record = CorRecords.getById(corRecordId);
    if (!record) {
      return json({
        status: "OK",
        hasImport: false,
        importStatus: null,
      });
    }

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
  } catch (error) {
    console.error("COR status check failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to check status" }, 500);
  }
}
