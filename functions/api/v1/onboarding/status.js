// GET /api/v1/onboarding/status
// Returns the current onboarding state and next step for the authenticated user.

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

    // Determine onboarding stage
    let stage;
    let nextAction;
    let corRecordId = user.corRecordId || null;
    let corStatus = null;

    if (user.state === "ACTIVE") {
      stage = "COMPLETE";
      nextAction = null;
    } else if (user.corRecordId) {
      const record = CorRecords.getById(user.corRecordId);
      if (record) {
        corStatus = record.status;
        corRecordId = record.id;

        switch (record.status) {
          case "ACCEPTED":
          case "QUEUED":
            stage = "UPLOAD";
            nextAction = "process";
            break;
          case "PROCESSING":
            stage = "PROCESSING";
            nextAction = "wait";
            break;
          case "REVIEW_REQUIRED":
            stage = "REVIEW";
            nextAction = "review";
            break;
          case "COMMITTING":
            stage = "CONFIRM";
            nextAction = "wait";
            break;
          case "COMPLETE":
            stage = "COMPLETE";
            nextAction = null;
            break;
          case "CANCELLED":
          case "DELETED":
            stage = "WELCOME";
            nextAction = "upload";
            corRecordId = null;
            break;
          default:
            stage = "WELCOME";
            nextAction = "upload";
        }
      } else {
        stage = "WELCOME";
        nextAction = "upload";
        corRecordId = null;
      }
    } else {
      stage = "WELCOME";
      nextAction = "upload";
    }

    return json({
      status: "OK",
      userState: user.state,
      stage,
      nextAction,
      corRecordId,
      corStatus,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Onboarding status failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to check onboarding status" }, 500);
  }
}
