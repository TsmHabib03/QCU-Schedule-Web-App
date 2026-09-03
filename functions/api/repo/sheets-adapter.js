// Google Sheets persistence adapter.
//
// Talks to the Apps Script web app deployed from setup-database.gs. Two calls
// carry the whole request:
//
//   snapshot.read  — every row this user owns, in one round trip
//   batch.write    — every row this request changed, in one round trip
//
// That shape is deliberate. An Apps Script round trip costs 300-900 ms, and
// endpoints like /api/v1/cor/confirm touch the repository ~37 times. Per-call
// round trips would mean 15-30 s per request; hydrate-once/flush-once keeps it
// to two. See repo/index.js for how the maps are hydrated and flushed.
//
// Transport envelope is DATABASE.md section 15: Cloudflare serializes the
// command exactly once, signs that string, and posts { canonical, signature }.
// Signing the literal string avoids any dependence on JSON key ordering.

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

// Google Sheets rejects a cell value over 50 000 characters. Drafts are
// normally 3-10 KB; guard so an oversized one fails legibly here instead of as
// an opaque Apps Script exception.
const MAX_CELL_CHARS = 45_000;

export function isConfigured(env) {
  return Boolean(env?.APPS_SCRIPT_URL && env?.APPS_SCRIPT_SECRET);
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

const _keyCache = new Map();

async function hmacKey(secret) {
  if (_keyCache.has(secret)) return _keyCache.get(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  _keyCache.set(secret, key);
  return key;
}

async function sign(canonical, secret) {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class SheetsError extends Error {
  constructor(code, message, { fields = null, retryable = false } = {}) {
    super(message);
    this.name = "SheetsError";
    this.code = code;
    this.fields = fields;
    this.retryable = retryable;
  }
}

/**
 * Send one signed action to Apps Script and return its `data` payload.
 * Throws SheetsError on a transport failure or an `ok: false` response.
 */
export async function callAction(env, action, actor, payload = {}) {
  if (!isConfigured(env)) {
    throw new SheetsError("INTERNAL_ERROR", "APPS_SCRIPT_URL / APPS_SCRIPT_SECRET are not configured.");
  }

  const canonical = JSON.stringify({
    requestId: `req_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    action,
    actor: { googleSub: actor.googleSub, email: actor.email || "" },
    payload,
  });

  const body = JSON.stringify({
    canonical,
    signature: await sign(canonical, env.APPS_SCRIPT_SECRET),
  });

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST",
        // Apps Script only accepts a simple content type without a preflight.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
        signal: controller.signal,
        redirect: "follow",
      });

      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // A login page or stack trace means the deployment is misconfigured.
        throw new SheetsError(
          "INTERNAL_ERROR",
          `Apps Script returned a non-JSON response (HTTP ${response.status}). ` +
            "Check that the web app is deployed with access set to Anyone.",
          { retryable: false }
        );
      }

      if (parsed.ok) return parsed.data ?? {};

      const err = parsed.error || {};
      throw new SheetsError(err.code || "INTERNAL_ERROR", err.message || "Apps Script rejected the request.", {
        fields: err.fields || null,
        retryable: Boolean(err.retryable),
      });
    } catch (error) {
      lastError = error instanceof SheetsError
        ? error
        : new SheetsError("INTERNAL_ERROR", `Apps Script request failed: ${error.message}`, { retryable: true });

      // Only a transport blip or an explicitly retryable code is worth a retry;
      // a rejected signature or validation error will fail identically.
      if (attempt === MAX_ATTEMPTS || !lastError.retryable) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Entity mapping
// ---------------------------------------------------------------------------
// The repository's in-memory shapes predate the normalized sheet schema, so the
// two disagree on some names and the repo carries fields the schema has no
// column for. Each entity therefore declares:
//
//   idField  the repo's primary key property
//   sheetId  the sheet's primary key column
//   alias    repo property -> sheet column, for the renamed ones
//   columns  every column the sheet has, so unmapped repo fields can be
//            collected into extraJson instead of being silently dropped
//
// Anything not in `columns` after aliasing round-trips through extraJson, which
// keeps the mapping lossless without widening the schema for internals.

const COMMON = ["createdAt", "createdBy", "updatedAt", "updatedBy", "version"];

export const ENTITIES = {
  users: {
    idField: "userId",
    sheetId: "userId",
    ownerField: null,
    alias: { name: "displayName", picture: "avatarUrl", state: "onboardingState" },
    columns: [
      "userId", "googleSub", "email", "emailVerified", "displayName", "avatarUrl",
      "accountStatus", "onboardingState", "lastLoginAt", "suspendedReason", "closedAt",
      ...COMMON, "extraJson",
    ],
    defaults: { accountStatus: "ACTIVE", emailVerified: true },
  },

  profiles: {
    idField: "profileId",
    sheetId: "profileId",
    ownerField: "userId",
    alias: {},
    columns: [
      "profileId", "userId", "studentNumber", "firstName", "middleName", "lastName",
      "suffix", "preferredName", "verificationStatus", "sourceCorRecordId", "status",
      ...COMMON, "extraJson",
    ],
  },

  corRecords: {
    idField: "id",
    sheetId: "corRecordId",
    ownerField: "ownerUserId",
    alias: { id: "corRecordId", attemptNumber: "attemptCount", pipelineVersion: "providerKey" },
    columns: [
      "corRecordId", "ownerUserId", "originalDocumentId", "rawArtifactDocumentId",
      "contentHash", "status", "providerKey", "providerJobId", "attemptCount",
      "nextAttemptAt", "leaseOwner", "leaseExpiresAt", "confidenceSummary", "failureCode",
      "failureMessage", "draftVersion", "confirmedAt", "committedEnrollmentId",
      "committedScheduleId", "commitMutationId", "completedAt", ...COMMON, "extraJson",
    ],
  },

  enrollments: {
    idField: "enrollmentId",
    sheetId: "enrollmentId",
    ownerField: "userId",
    alias: { userId: "ownerUserId" },
    columns: [
      "enrollmentId", "ownerUserId", "termId", "offeringId", "sectionId",
      "sectionLabelSnapshot", "yearLevel", "studentStatus", "dateEnrolled", "adviserName",
      "sourceType", "sourceCorRecordId", "status", ...COMMON, "extraJson",
    ],
  },

  enrollmentSubjects: {
    idField: "ensId",
    sheetId: "enrollmentSubjectId",
    ownerField: "userId",
    alias: { ensId: "enrollmentSubjectId", userId: "ownerUserId" },
    columns: [
      "enrollmentSubjectId", "enrollmentId", "ownerUserId", "subjectId",
      "subjectCodeSnapshot", "subjectTitleSnapshot", "units", "classSection",
      "instructorName", "sourceType", "sourceCorDraftSubjectId", "status",
      ...COMMON, "extraJson",
    ],
  },

  schedules: {
    idField: "scheduleId",
    sheetId: "scheduleId",
    ownerField: "userId",
    alias: { userId: "ownerUserId" },
    columns: [
      "scheduleId", "enrollmentId", "ownerUserId", "revisionNumber", "name", "sourceType",
      "sourceCorRecordId", "status", "activatedAt", "archivedAt", ...COMMON, "extraJson",
    ],
  },

  scheduleEntries: {
    idField: "smeId",
    sheetId: "scheduleEntryId",
    ownerField: "userId",
    alias: { smeId: "scheduleEntryId", userId: "ownerUserId" },
    columns: [
      "scheduleEntryId", "scheduleId", "ownerUserId", "enrollmentSubjectId", "dayOfWeek",
      "startTime", "endTime", "modality", "buildingId", "roomId", "locationText",
      "effectiveFrom", "effectiveTo", "sourceCorDraftMeetingId", "originType", "status",
      ...COMMON, "extraJson",
    ],
  },

  tasks: {
    idField: "taskId",
    sheetId: "taskId",
    ownerField: "userId",
    alias: { userId: "ownerUserId", status: "taskStatus", dueDate: "dueAt" },
    columns: [
      "taskId", "ownerUserId", "title", "description", "enrollmentSubjectId", "priority",
      "dueAt", "completedAt", "taskStatus", "clientMutationId", "deletedAt",
      ...COMMON, "extraJson",
    ],
  },

  notes: {
    idField: "noteId",
    sheetId: "noteId",
    ownerField: "userId",
    alias: { userId: "ownerUserId", status: "noteStatus" },
    columns: [
      "noteId", "ownerUserId", "title", "body", "enrollmentSubjectId", "noteStatus",
      "clientMutationId", "deletedAt", ...COMMON, "extraJson",
    ],
  },
};

// ---------------------------------------------------------------------------
// Row <-> object mapping
// ---------------------------------------------------------------------------

const _reverseAlias = new Map();

function reverseAlias(kind) {
  if (_reverseAlias.has(kind)) return _reverseAlias.get(kind);
  const out = {};
  for (const [repoField, column] of Object.entries(ENTITIES[kind].alias)) out[column] = repoField;
  _reverseAlias.set(kind, out);
  return out;
}

/** Repository object -> sheet row object. */
export function toRow(kind, obj) {
  if (kind === "corDrafts") return corDraftToRow(obj);

  const spec = ENTITIES[kind];
  if (!spec) throw new SheetsError("INTERNAL_ERROR", `Unknown entity kind: ${kind}`);

  const columns = new Set(spec.columns);
  const row = {};
  const extras = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "extraJson") continue;
    const column = spec.alias[key] || key;
    if (columns.has(column)) row[column] = value;
    else extras[key] = value;
  }

  for (const [key, value] of Object.entries(spec.defaults || {})) {
    if (row[key] === undefined || row[key] === null) row[key] = value;
  }

  row[spec.sheetId] = obj[spec.idField] ?? row[spec.sheetId] ?? null;
  if (Object.keys(extras).length) row.extraJson = guardCellSize(JSON.stringify(extras), `${kind}.extraJson`);
  return row;
}

/** Sheet row object -> repository object. */
export function fromRow(kind, row) {
  if (kind === "corDrafts") return corDraftFromRow(row);

  const spec = ENTITIES[kind];
  if (!spec) throw new SheetsError("INTERNAL_ERROR", `Unknown entity kind: ${kind}`);

  const reverse = reverseAlias(kind);
  const out = {};

  for (const [column, value] of Object.entries(row)) {
    if (column === "extraJson") continue;
    out[reverse[column] || column] = value;
  }

  if (row.extraJson) {
    try {
      Object.assign(out, JSON.parse(row.extraJson));
    } catch {
      // A hand-edited cell should not take down the whole request.
      console.warn(`repo: unparseable extraJson on ${kind} ${row[spec.sheetId]}`);
    }
  }

  return out;
}

// A COR draft is one opaque extraction document rather than a set of fields, so
// it gets its own mapping instead of an entry in ENTITIES.
function corDraftToRow(obj) {
  return {
    corRecordId: obj.corRecordId,
    ownerUserId: obj.ownerUserId ?? null,
    draftVersion: obj.draftVersion ?? 1,
    draftJson: guardCellSize(JSON.stringify(obj.draft ?? null), "corDrafts.draftJson"),
    status: obj.status || "ACTIVE",
  };
}

function corDraftFromRow(row) {
  let draft = null;
  try {
    draft = row.draftJson ? JSON.parse(row.draftJson) : null;
  } catch {
    console.warn(`repo: unparseable draftJson on COR record ${row.corRecordId}`);
  }
  return {
    corRecordId: row.corRecordId,
    ownerUserId: row.ownerUserId ?? null,
    draftVersion: row.draftVersion ?? 1,
    status: row.status || "ACTIVE",
    draft,
  };
}

function guardCellSize(value, label) {
  if (typeof value === "string" && value.length > MAX_CELL_CHARS) {
    throw new SheetsError(
      "PAYLOAD_TOO_LARGE",
      `${label} is ${value.length} characters; a spreadsheet cell holds at most ${MAX_CELL_CHARS}.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// High-level operations
// ---------------------------------------------------------------------------

/** Kinds fetched by a default hydrate, in the order the repo expects them. */
export const SNAPSHOT_KINDS = [
  "users",
  "profiles",
  "corRecords",
  "corDrafts",
  "enrollments",
  "enrollmentSubjects",
  "schedules",
  "scheduleEntries",
  "tasks",
  "notes",
];

/**
 * Load everything the calling user owns.
 * Returns { userId, isNew, entities: { kind: [repoObject, ...] } }.
 */
export async function readSnapshot(env, actor, kinds = SNAPSHOT_KINDS) {
  const data = await callAction(env, "snapshot.read", actor, { kinds });
  const entities = {};

  for (const kind of kinds) {
    const rows = data?.entities?.[kind];
    entities[kind] = Array.isArray(rows) ? rows.map((row) => fromRow(kind, row)) : [];
  }

  return { userId: data?.userId || null, isNew: Boolean(data?.isNew), entities };
}

/**
 * Persist a set of changes. `ops` entries are either
 *   { kind, obj }            upsert, id taken from the entity's id field
 *   { kind, id, remove: true }  hard delete
 */
export async function writeBatch(env, actor, ops) {
  if (!ops.length) return { applied: 0, inserted: 0, updated: 0, removed: 0, skipped: [] };

  const payloadOps = ops.map((op) => {
    if (op.remove) return { kind: op.kind, id: op.id, remove: true };

    const row = toRow(op.kind, op.obj);
    const spec = ENTITIES[op.kind];
    const id = op.id ?? (spec ? op.obj[spec.idField] : op.obj.corRecordId);
    return { kind: op.kind, id, row };
  });

  const result = await callAction(env, "batch.write", actor, { ops: payloadOps });

  if (result?.skipped?.length) {
    console.warn(`repo: Apps Script skipped ${result.skipped.length} op(s)`, JSON.stringify(result.skipped));
  }
  return result;
}

/**
 * Push the canonical academic catalog into the catalog sheets.
 * The app reads its catalog from the embedded bundle, so this exists to keep the
 * spreadsheet's admin view in step rather than to feed the runtime.
 */
export async function syncCatalog(env, actor, catalog) {
  return callAction(env, "catalog.sync", actor, { catalog });
}

