// POST /api/v1/cor/upload
// Validates the file and starts a durable import. Local development extracts inline.

import {
  resolveUser,
  refreshSession,
  flushRepo,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorFiles, CorDrafts, Concurrency, Users } from "../../repo/index.js";
import { extractWithGemini, geminiResultToDraft } from "./_gemini.js";
import { isConfigured, jobCall, jobError, encodeBytes } from './_jobs.js';

// The file travels as base64 inside the signed request envelope, and the Apps
// Script side rejects any body above 2,000,000 characters. Base64 inflates by
// ~33%, so the true ceiling is about 1.4 MB. This used to advertise 10 MiB: a
// 2-4 MB phone photo passed here and then failed inside the database, surfacing
// as an unexplained "try again". The limit now matches the channel, and the
// onboarding page shrinks photos to fit it.
const MAX_ENVELOPE_CHARS = 2_000_000;
const BASE64_OVERHEAD = 1.37;                       // 4 base64 chars per 3 bytes
const MAX_FILE_SIZE = Math.floor(MAX_ENVELOPE_CHARS / BASE64_OVERHEAD) - 60_000; // ~1.4 MB with JSON headroom
const SIZE_MESSAGE = `This file is larger than the ${Math.round(MAX_FILE_SIZE / 1024)} KB upload limit. Photos are shrunk automatically - for a PDF, export a smaller copy or split it.`;
const MIME_BY_EXTENSION = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

function computeHash(bytes) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function getExtension(filename) {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------
function validateFile(extension, mimeType, fileSize) {
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { valid: false, error: "UNSUPPORTED_FILE_TYPE", message: "Choose a PDF, JPG, or PNG file." };
  }
  // Missing/generic browser MIME is allowed only with the expected extension
  // and a matching file signature (checked before storing or extracting).
  if (mimeType && mimeType !== 'application/octet-stream' && mimeType !== MIME_BY_EXTENSION[extension]) {
    return { valid: false, error: "UNSUPPORTED_FILE_TYPE", message: "Choose a PDF, JPG, or PNG file." };
  }
  if (fileSize > MAX_FILE_SIZE) {
    return { valid: false, error: "PAYLOAD_TOO_LARGE", message: SIZE_MESSAGE };
  }
  if (fileSize === 0) {
    return { valid: false, error: "FILE_CORRUPT", message: "We could not read this file. Try exporting or photographing it again." };
  }
  return { valid: true };
}

function validatePdfHeader(bytes) {
  // PDF header: %PDF
  if (bytes.length < 4) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function validateJpegHeader(bytes) {
  // JPEG header: FF D8 FF
  if (bytes.length < 3) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function validatePngHeader(bytes) {
  // PNG header: 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length < 8) return false;
  return (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  );
}

function validateFileSignature(bytes, extension) {
  switch (extension) {
    case ".pdf": return validatePdfHeader(bytes);
    case ".jpg":
    case ".jpeg": return validateJpegHeader(bytes);
    case ".png": return validatePngHeader(bytes);
    default: return false;
  }
}

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

    // AUTHENTICATED, ONBOARDING, or ACTIVE users may upload.
    // ACTIVE users can re-scan to update their COR/schedule.
    if (user.state !== "AUTHENTICATED" && user.state !== "ONBOARDING" && user.state !== "ACTIVE") {
      return json(
        { status: "ERROR", error: `Cannot upload COR in state: ${user.state}` },
        400
      );
    }

    // Parse multipart form data
    if (Number(context.request.headers.get('Content-Length')) > MAX_FILE_SIZE + 65536) {
      return json({ status: 'PAYLOAD_TOO_LARGE', error: SIZE_MESSAGE }, 413);
    }
    let form;
    try { form = await context.request.formData(); }
    catch (_) { return json({ status: 'INVALID_UPLOAD', error: 'Choose your COR file and upload it again.' }, 400); }
    const files = form.getAll('file');
    const file = files[0];
    if (files.length !== 1 || !file || typeof file.arrayBuffer !== 'function') {
      return json(
        { status: "INVALID_UPLOAD", error: "Select one COR file to upload." },
        400
      );
    }

    const rawFilename = file.name || 'cor_upload';

    const extension = getExtension(rawFilename);
    const declaredMime = (file.type || '').toLowerCase();
    const fileSize = file.size;

    // Validate file type and size
    const fileValidation = validateFile(extension, declaredMime, fileSize);
    if (!fileValidation.valid) {
      return json(
        { status: fileValidation.error, error: fileValidation.message },
        fileValidation.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400
      );
    }

    // Validate file signature (magic bytes)
    const filePart = { data: new Uint8Array(await file.arrayBuffer()) };
    if (!validateFileSignature(filePart.data, extension)) {
      return json(
        { status: "FILE_CORRUPT", error: "We could not read this file. Try exporting or photographing it again." },
        400
      );
    }

    // Finish asynchronous hashing before checking/creating the record so two
    // requests in the same isolate cannot both pass the duplicate check.
    const contentHash = await computeHash(filePart.data);
    const mimeType = MIME_BY_EXTENSION[extension];

    if (isConfigured(context.env)) {
      if (!context.env.GEMINI_API_KEY) return json({status:'SERVICE_UNAVAILABLE',error:'COR extraction is unavailable.'},503);
      const requestId = context.request.headers.get('X-Request-ID');
      const result = await jobCall(context, session, 'start', {
        requestId, contentHash, filename:sanitizeFilename(rawFilename), mimeType, base64:encodeBytes(filePart.data),
      });
      return json({status:result.duplicate ? 'DUPLICATE' : 'ACCEPTED', ...result}, result.duplicate ? 200 : 201);
    }

    // Check for duplicate active import
    const existingRecord = CorRecords.getByRequestId(user.userId, context.request.headers.get('X-Request-ID')) || Concurrency.getDuplicateCorRecord(user.userId);
    if (existingRecord) {
      return json({
        status: "DUPLICATE",
        corRecordId: existingRecord.id,
        importStatus: existingRecord.status,
        message: "You already have an active COR import.",
      });
    }

    if (!(context.env || {}).GEMINI_API_KEY) {
      return json({ status: "ERROR", error: "COR extraction is unavailable. Please try again later." }, 503);
    }

    // Local development mirrors admission using repository records. Deployed
    // requests always use the shared, locked cor.start handler above.
    const recent = CorRecords.getRecentByUserId(user.userId, Date.now()-600000);
    if (recent.length >= 5) {
      return jobError({code:'RATE_LIMITED',message:'Five scans are allowed every ten minutes.',fields:{retryAfter:Math.ceil((Date.parse(recent[0].createdAt)+600000-Date.now())/1000)}});
    }

    // Create COR record
    const corRecord = CorRecords.create({
      ownerUserId: user.userId,
      filename: sanitizeFilename(rawFilename),
      originalFilename: rawFilename,
      mimeType,
      sizeBytes: fileSize,
      contentHash,
      requestId: context.request.headers.get('X-Request-ID'),
      status: "ACCEPTED",
    });

    // Store file bytes (dev: in-memory; prod: private Drive)
    CorFiles.store(corRecord.id, {
      bytes: new Uint8Array(filePart.data),
      filename: sanitizeFilename(rawFilename),
      mimeType: corRecord.mimeType,
    });

    // Transition user to ONBOARDING (for both new and returning ACTIVE users).
    // Routed through Users.update so the change is recorded for the flush below.
    const previousState = user.state;
    const previousRecordId = user.corRecordId;
    Users.update(user, {
      state: (user.state === "AUTHENTICATED" || user.state === "ACTIVE") ? "ONBOARDING" : user.state,
      corRecordId: corRecord.id,
    });

    // --- Immediately extract COR data via Gemini ---
    // On CF Pages, in-memory Maps are empty on the next request, so process.js
    // cannot find the file bytes.  Extract now and save the draft in the session.
    let corDraft = null;
    const geminiKey = (context.env || {}).GEMINI_API_KEY;
    if (geminiKey) {
      try {
        console.log("Upload: running Gemini extraction for", corRecord.filename);
        const geminiResult = await extractWithGemini(
          new Uint8Array(filePart.data),
          corRecord.mimeType,
          geminiKey
        );
        corDraft = geminiResultToDraft(geminiResult);
        console.log("Upload: Gemini OK,", corDraft.subjects.length, "subjects");
      } catch (geminiError) {
        console.error("Upload: Gemini extraction failed:", geminiError.message);
        CorRecords.update(corRecord, { status: "CANCELLED", failureCode: "EXTRACTION_FAILED", failureStage: "extraction" });
        Users.update(user, { state: previousState, corRecordId: previousRecordId });
        await flushRepo(context, session);
        return json({ status: "ERROR", error: "Could not extract your COR. Please try uploading again." }, 502);
      }
    }

    // Persist the draft so review and confirm can read it back from storage.
    // The response below still carries it for the frontend cache, which is what
    // keeps this working when no Sheets backend is configured.
    if (corDraft) {
      CorDrafts.set(corRecord.id, corDraft);
      CorRecords.update(corRecord, { status: "REVIEW_REQUIRED", draftVersion: 1 });
    }

    // Re-seal session cookie with ONBOARDING state and corRecordId only.
    // The extraction draft is returned in the JSON response (not in the cookie)
    // to stay under the 4 KB browser cookie limit.  The frontend caches the
    // draft in memory and passes it to /cor/review and /cor/confirm.
    const sessionCookie = await refreshSession(context, session, {
      state: "ONBOARDING",
      corRecordId: corRecord.id,
      corDraft: null,
      corRecordStatus: "REVIEW_REQUIRED",
    });

    await flushRepo(context, session);

    const resp = json({
      status: corDraft ? "EXTRACTED" : "ACCEPTED",
      corRecordId: corRecord.id,
      filename: corRecord.filename,
      sizeBytes: corRecord.sizeBytes,
      mimeType: corRecord.mimeType,
      subjectsFound: corDraft?.subjects?.length || 0,
      message: corDraft
        ? "Upload and extraction complete. Please review your information."
        : "Upload complete. Preparing your COR.",
      // Include the full extraction result in the response so the frontend
      // can cache it and pass it to review/confirm without needing Maps.
      result: corDraft || null,
    }, 201);
    resp.headers.append("Set-Cookie", sessionCookie);
    return resp;
  } catch (error) {
    if (isConfigured(context.env)) return jobError(error);
    console.error("COR upload failed:", String(error?.message || error));
    console.error("COR upload error stack:", error?.stack || "no stack");
    return json(
      { status: "ERROR", error: "Failed to process upload. Please try again." },
      500
    );
  }
}
