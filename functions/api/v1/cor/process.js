// POST /api/v1/cor/process
// Triggers extraction processing for an uploaded COR.
// On CF Pages: returns draft from session cookie if Maps are empty.

import {
  resolveUser,
  refreshSession,
  flushRepo,
  json,
  compactDraft,
} from "../../auth/_lib.js";
import { CorRecords, CorDrafts, CorFiles } from "../../repo/index.js";
import { extractWithGemini, geminiResultToDraft, GEMINI_MODELS } from "./_gemini.js";
import { isConfigured, jobCall, jobError } from './_jobs.js';


// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function onRequestPost(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user, session } = resolved;

    if (isConfigured(context.env)) {
      const body = await context.request.json().catch(() => ({}));
      const id = body.corRecordId || CorRecords.getActiveByUserId(user.userId)?.id || user.corRecordId;
      const claim = await jobCall(context, session, 'claim', {corRecordId:id});
      if (!claim.leaseToken) {
        if (claim.importStatus === 'REVIEW_REQUIRED') return json({status:'REVIEW_REQUIRED',corRecordId:id,result:CorDrafts.get(id)});
        if (claim.importStatus === 'COMPLETE') return json({status:'COMPLETE',corRecordId:id});
        const response = json({status:'RATE_LIMITED',error:'This COR is already being read. Check its status.',retryAfter:claim.retryAfter},429);
        response.headers.set('Retry-After',String(claim.retryAfter));
        return response;
      }
      let draft;
      const started = Date.now();
      try {
        const bytes = Uint8Array.from(atob(claim.base64), c => c.charCodeAt(0));
        draft = geminiResultToDraft(await extractWithGemini(bytes, claim.mimeType, context.env.GEMINI_API_KEY));
      } catch (error) {
        await jobCall(context,session,'finish',{corRecordId:id,leaseToken:claim.leaseToken});
        return json({status:'EXTRACTION_FAILED',error:'The COR could not be read. You can start another scan.'},422);
      }
      // A failed/unknown save is never changed into an extraction failure.
      const extractionMs = Date.now()-started;
      const saveStarted = Date.now();
      await jobCall(context,session,'finish',{corRecordId:id,leaseToken:claim.leaseToken,draft});
      const response = json({status:'REVIEW_REQUIRED',corRecordId:id,result:draft});
      response.headers.set('Server-Timing',`extraction;dur=${extractionMs}, save;dur=${Date.now()-saveStarted}`);
      return response;
    }

    // Must be in ONBOARDING with an active COR record
    if (user.state !== "ONBOARDING" || !user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import to process." },
        400
      );
    }

    // --- Draft already extracted during upload ---
    // upload.js extracts in the same request that receives the file, because the
    // bytes cannot outlive it. So by the time we get here a draft normally
    // exists: loaded from Sheets by hydrate, or carried on the session cookie
    // when no Sheets backend is configured.
    const existingDraft = CorDrafts.get(user.corRecordId) || user.corDraft;
    if (existingDraft) {
      console.log("Returning draft already produced at upload time");
      const resp = json({
        status: "REVIEW_REQUIRED",
        corRecordId: user.corRecordId,
        message: "Extraction complete. Please review your information.",
        subjectsFound: existingDraft.subjects?.length || 0,
        totalUnits: existingDraft.totalUnits,
        result: existingDraft,
      });
      // Re-seal session to set corRecordStatus without re-storing the draft
      // (keeps cookie under 4 KB).
      const sessionCookie = await refreshSession(context, session, {
        corRecordStatus: "REVIEW_REQUIRED",
      });
      resp.headers.append("Set-Cookie", sessionCookie);
      return resp;
    }

    const record = CorRecords.getById(user.corRecordId);
    if (!record) {
      return json(
        { status: "ERROR", error: "COR record not found." },
        404
      );
    }

    async function failImport(message) {
      CorRecords.update(record, { status: "CANCELLED", failureCode: "EXTRACTION_FAILED", failureStage: "extraction" });
      await flushRepo(context, session);
      return json({ status: "ERROR", error: message }, 422);
    }

    // Must be in ACCEPTED or QUEUED state
    if (!["ACCEPTED", "QUEUED", "PROCESSING"].includes(record.status)) {
      return json(
        { status: "ERROR", error: `Cannot process COR in state: ${record.status}` },
        400
      );
    }

    // Update record state
    CorRecords.update(record, { status: "PROCESSING" });

    // Get the uploaded file bytes
    const fileData = CorFiles.get(record.id);
    if (!fileData) {
      return failImport("The uploaded file is no longer available. Please upload your COR again.");
    }

    console.log("Processing COR:", record.filename, "(", fileData.mimeType, ")...");

    // Try Gemini first, fall back to Tesseract
    const geminiKey = (context.env || {}).GEMINI_API_KEY;
    let extractionResult = null;

    if (geminiKey) {
      console.log("Using Gemini Vision API");
      try {
        const geminiResult = await extractWithGemini(fileData.bytes, fileData.mimeType, geminiKey);
        extractionResult = geminiResultToDraft(geminiResult);
        console.log("Gemini OK:", extractionResult.subjects.length, "subjects,", extractionResult.studentInfo.firstName?.value, extractionResult.studentInfo.lastName?.value);
      } catch (geminiError) {
        console.error("Gemini FAILED:", geminiError.message);
        return failImport("Could not extract your COR. Please upload it again.");
      }
    } else {
      console.log("No GEMINI_API_KEY found, skipping Gemini");
    }

    if (!extractionResult) {
      return failImport("COR extraction is unavailable. Please try again later.");
    }

    // Store draft
    CorDrafts.set(record.id, extractionResult);

    // Update record to REVIEW_REQUIRED
    CorRecords.update(record, { status: "REVIEW_REQUIRED", draftVersion: 1 });

    await flushRepo(context, session);

    return json({
      status: "REVIEW_REQUIRED",
      corRecordId: record.id,
      message: "Extraction complete. Please review your information.",
      subjectsFound: extractionResult.subjects.length,
      totalUnits: extractionResult.totalUnits,
      result: extractionResult,
    });
  } catch (error) {
    if (isConfigured(context.env)) return jobError(error);
    console.error("COR processing failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to process COR. Please try again." },
      500
    );
  }
}
