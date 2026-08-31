// GET /api/v1/cor/result
// Returns the extraction result (draft) for the authenticated user's active COR.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorDrafts } from "../../repo/index.js";

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
      return json({
        status: "OK",
        corRecordId: record.id,
        importStatus: record.status,
        hasResult: false,
      });
    }

    const draft = CorDrafts.get(record.id);
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
