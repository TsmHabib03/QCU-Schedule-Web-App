// POST /api/v1/cor/upload
// Accepts a COR file upload, validates it, stores in dev mock, creates COR record.
// Dev-only: stores file bytes in memory. Production uses private Google Drive.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorFiles, Concurrency } from "../../repo/index.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_TYPES = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};
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
// Multipart parser (boundary from Content-Type)
// ---------------------------------------------------------------------------
async function parseMultipart(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const boundaryMatch = contentType.match(/boundary=(.+)/i);
  if (!boundaryMatch) throw new Error("MISSING_BOUNDARY");

  const boundary = boundaryMatch[1];
  const body = await request.arrayBuffer();
  const decoder = new TextDecoder();

  // Simple boundary-based parser for single-file uploads
  const boundaryBytes = new TextEncoder().encode(`--${boundary}`);
  const endBytes = new TextEncoder().encode(`--${boundary}--`);
  const bodyBytes = new Uint8Array(body);

  // Find parts by scanning for boundary markers
  const parts = [];
  let searchStart = 0;

  while (searchStart < bodyBytes.length) {
    // Find next boundary
    const boundaryIdx = findBytes(bodyBytes, boundaryBytes, searchStart);
    if (boundaryIdx < 0) break;

    // Find end of headers (double CRLF)
    const headerStart = boundaryIdx + boundaryBytes.length + 2; // skip \r\n
    const headerEnd = findBytes(bodyBytes, new Uint8Array([13, 10, 13, 10]), headerStart);
    if (headerEnd < 0) break;

    const headerText = decoder.decode(bodyBytes.slice(headerStart, headerEnd));

    // Find next boundary (start of next part or end)
    const nextBoundary = findBytes(bodyBytes, boundaryBytes, headerEnd + 4);
    if (nextBoundary < 0) break;

    // Data is between header end and next boundary (minus trailing \r\n)
    const dataStart = headerEnd + 4;
    const dataEnd = nextBoundary - 2; // before \r\n before boundary

    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        headers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
      }
    }

    parts.push({
      headers,
      data: bodyBytes.slice(dataStart, dataEnd),
    });

    searchStart = nextBoundary;
  }

  return parts;
}

function findBytes(haystack, needle, start = 0) {
  for (let i = start; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------
function validateFile(extension, mimeType, fileSize) {
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { valid: false, error: "UNSUPPORTED_FILE_TYPE", message: "Choose a PDF, JPG, or PNG file." };
  }
  if (!ALLOWED_TYPES[mimeType]) {
    // Some browsers send wrong MIME; check extension as fallback
    const extToMime = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
    if (extToMime[extension] !== mimeType) {
      return { valid: false, error: "UNSUPPORTED_FILE_TYPE", message: "Choose a PDF, JPG, or PNG file." };
    }
  }
  if (fileSize > MAX_FILE_SIZE) {
    return { valid: false, error: "PAYLOAD_TOO_LARGE", message: "This file is larger than the allowed limit (10 MB)." };
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
// Rate limiting (simple in-memory)
// ---------------------------------------------------------------------------
const _uploadTimestamps = new Map(); // userId -> [timestamps]
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5;

function checkRateLimit(userId) {
  const now = Date.now();
  const timestamps = _uploadTimestamps.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  _uploadTimestamps.set(userId, recent);
  return true;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
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

    // Only AUTHENTICATED or ONBOARDING users may upload
    if (user.state !== "AUTHENTICATED" && user.state !== "ONBOARDING") {
      return json(
        { status: "ERROR", error: `Cannot upload COR in state: ${user.state}` },
        400
      );
    }

    // Rate limit
    if (!checkRateLimit(user.userId)) {
      return json(
        { status: "RATE_LIMITED", error: "Too many upload attempts. Please wait and try again." },
        429
      );
    }

    // Parse multipart form data
    const parts = await parseMultipart(context.request);
    const filePart = parts.find((p) =>
      p.headers["content-disposition"]?.includes("name=\"file\"")
    );

    if (!filePart || !filePart.data || filePart.data.length === 0) {
      return json(
        { status: "ERROR", error: "No file provided. Please select a COR file to upload." },
        400
      );
    }

    const rawFilename = filePart.headers["content-disposition"]?.match(
      /filename="([^"]+)"/
    )?.[1] || "cor_upload";

    const extension = getExtension(rawFilename);
    const declaredMime = filePart.headers["content-type"] || "";
    const fileSize = filePart.data.length;

    // Validate file type and size
    const fileValidation = validateFile(extension, declaredMime, fileSize);
    if (!fileValidation.valid) {
      return json(
        { status: fileValidation.error, error: fileValidation.message },
        400
      );
    }

    // Validate file signature (magic bytes)
    if (!validateFileSignature(filePart.data, extension)) {
      return json(
        { status: "FILE_CORRUPT", error: "We could not read this file. Try exporting or photographing it again." },
        400
      );
    }

    // Check for duplicate active import
    const existingRecord = Concurrency.getDuplicateCorRecord(user.userId);
    if (existingRecord) {
      return json({
        status: "DUPLICATE",
        corRecordId: existingRecord.id,
        importStatus: existingRecord.status,
        message: "You already have an active COR import.",
      });
    }

    // Compute content hash
    const contentHash = await computeHash(filePart.data);

    // Create COR record
    const corRecord = CorRecords.create({
      ownerUserId: user.userId,
      filename: sanitizeFilename(rawFilename),
      originalFilename: rawFilename,
      mimeType: declaredMime || (extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : "image/jpeg"),
      sizeBytes: fileSize,
      contentHash,
      status: "ACCEPTED",
    });

    // Store file bytes (dev: in-memory; prod: private Drive)
    CorFiles.store(corRecord.id, {
      bytes: new Uint8Array(filePart.data),
      filename: sanitizeFilename(rawFilename),
      mimeType: corRecord.mimeType,
    });

    // Transition user to ONBOARDING
    if (user.state === "AUTHENTICATED") {
      user.state = "ONBOARDING";
    }
    user.corRecordId = corRecord.id;

    return json({
      status: "ACCEPTED",
      corRecordId: corRecord.id,
      filename: corRecord.filename,
      sizeBytes: corRecord.sizeBytes,
      mimeType: corRecord.mimeType,
      message: "Upload complete. Preparing your COR.",
    }, 201);
  } catch (error) {
    console.error("COR upload failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to process upload. Please try again." },
      500
    );
  }
}
