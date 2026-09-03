// Platform authentication library.
// Reuses cookie encryption from the existing Google integration library
// (AES-GCM sealed cookies) and adds platform-specific helpers.

import {
  canonicalOrigin,
  clearCookie as clearCookieBase,
  json as jsonResponse,
  redirect as redirectBase,
  SESSION_COOKIE as INTEGRATION_SESSION_COOKIE,
} from "../google/_lib.js";

const PLATFORM_SESSION_COOKIE = "qcu_platform_session";
const CSRF_COOKIE = "qcu_csrf";

// ---------------------------------------------------------------------------
// Platform scopes — minimal OIDC only (no Classroom/Gmail).
// ---------------------------------------------------------------------------
const PLATFORM_SCOPES = ["openid", "email", "profile"];

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(secret) {
  if (!secret || secret.length < 24)
    throw new Error("GOOGLE_SESSION_SECRET is not configured");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plain
  );
  return encodeBytes(iv) + "." + encodeBytes(new Uint8Array(encrypted));
}

async function unseal(value, secret) {
  if (!value || !value.includes(".")) return null;
  try {
    const [ivPart, dataPart] = value.split(".");
    const key = await encryptionKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBytes(ivPart) },
      key,
      decodeBytes(dataPart)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (_) {
    return null;
  }
}

function makeCookie(name, value, request, maxAge) {
  const secure =
    new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { PLATFORM_SESSION_COOKIE, CSRF_COOKIE, PLATFORM_SCOPES };

export function json(data, status = 200, headers = {}) {
  return jsonResponse(data, status, headers);
}

export function redirect(location, headers = {}) {
  return redirectBase(location, headers);
}

export function clearPlatformCookie(request) {
  return makeCookie(PLATFORM_SESSION_COOKIE, "", request, 0);
}

export function clearCsrfCookie(request) {
  return makeCookie(CSRF_COOKIE, "", request, 0);
}

export function clearIntegrationCookie(request) {
  return clearCookieBase(INTEGRATION_SESSION_COOKIE, request);
}

export function clearAllAuthCookies(request) {
  return [
    makeCookie(PLATFORM_SESSION_COOKIE, "", request, 0),
    makeCookie(CSRF_COOKIE, "", request, 0),
    clearCookieBase(INTEGRATION_SESSION_COOKIE, request),
  ];
}

// ---------------------------------------------------------------------------
// compactDraft — strip sourceText/confidence metadata from extraction drafts
// to keep session cookie under the 4 KB browser limit.
// Fields like { value, sourceText, confidence } → just their .value.
// Handles nested arrays (subjects[].meetings[], subjects[].schedule[]).
// ---------------------------------------------------------------------------

function compactValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && !Array.isArray(v) && "value" in v) return v.value;
  return v;
}

function compactMeeting(m) {
  if (!m || typeof m !== "object") return m;
  const out = { ...m };
  if (out.day && typeof out.day === "object" && "value" in out.day) out.day = out.day.value;
  if (out.dayOfWeek && typeof out.dayOfWeek === "object" && "value" in out.dayOfWeek) out.dayOfWeek = out.dayOfWeek.value;
  if (out.startTime && typeof out.startTime === "object" && "value" in out.startTime) out.startTime = out.startTime.value;
  if (out.endTime && typeof out.endTime === "object" && "value" in out.endTime) out.endTime = out.endTime.value;
  if (out.time && typeof out.time === "object") {
    out.time = { ...out.time };
    if (out.time.start && typeof out.time.start === "object" && "value" in out.time.start) out.time.start = out.time.start.value;
    if (out.time.end && typeof out.time.end === "object" && "value" in out.time.end) out.time.end = out.time.end.value;
  }
  return out;
}

export function compactDraft(draft) {
  if (!draft || typeof draft !== "object") return draft;
  const out = { ...draft };

  if (out.studentInfo && typeof out.studentInfo === "object") {
    const si = { ...out.studentInfo };
    for (const k of Object.keys(si)) {
      if (k !== "suffix" || si[k] === null) si[k] = compactValue(si[k]);
    }
    out.studentInfo = si;
  }

  if (out.enrollmentInfo && typeof out.enrollmentInfo === "object") {
    const ei = { ...out.enrollmentInfo };
    for (const k of Object.keys(ei)) {
      if (k !== "adviserName") ei[k] = compactValue(ei[k]);
    }
    out.enrollmentInfo = ei;
  }

  if (Array.isArray(out.subjects)) {
    out.subjects = out.subjects.map((s) => {
      if (!s || typeof s !== "object") return s;
      const sub = { ...s };
      for (const k of ["subjectCode", "subjectName", "units", "room", "roomNumber"]) {
        if (sub[k]) sub[k] = compactValue(sub[k]);
      }
      const meetings = sub.meetings || sub.schedule;
      if (Array.isArray(meetings)) {
        const compacted = meetings.map(compactMeeting);
        if (sub.meetings) sub.meetings = compacted;
        if (sub.schedule) sub.schedule = compacted;
      }
      return sub;
    });
  }

  // Drop large non-essential fields
  delete out.rawText;
  delete out.processingTime;

  return out;
}

/**
 * Compact a dashboard snapshot for session storage (keeps cookie under 4 KB).
 * Strips redundant entry fields and trims building data.
 */
export function compactDashboardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const out = {};

  out.enrollment = snapshot.enrollment || null;
  out.schedule = snapshot.schedule || null;

  // Keep only the fields mapEntryToSchedule() in app.js actually uses.
  // Drops: scheduleId, course (duplicate of code), dayLabel (duplicate of day),
  //        section (always ""), room (duplicate of roomCode).
  if (Array.isArray(snapshot.entries)) {
    out.entries = snapshot.entries.map((e) => ({
      entryId: e.entryId,
      code: e.code,
      title: e.title,
      units: e.units,
      type: e.type,
      day: e.day,
      start: e.start,
      end: e.end,
      startMinutes: e.startMinutes,
      endMinutes: e.endMinutes,
      buildingId: e.buildingId || null,
      buildingCode: e.buildingCode || "",
      buildingName: e.buildingName || "",
      roomId: e.roomId || null,
      roomCode: e.roomCode || "",
      floor: e.floor != null ? e.floor : null,
      instructor: e.instructor || "",
      notes: e.notes || "",
      enrollmentSubjectId: e.enrollmentSubjectId || null,
      originType: e.originType || "COR_IMPORT",
      modality: e.modality || "ONSITE",
    }));
  } else {
    out.entries = [];
  }

  // Keep only display fields; drops rooms array, lat/lng (large).
  if (Array.isArray(snapshot.buildings)) {
    out.buildings = snapshot.buildings.map((b) => ({
      buildingId: b.buildingId,
      code: b.code,
      name: b.name,
      shortName: b.shortName || b.name,
      campusId: b.campusId,
      floors: b.floors || 1,
    }));
  } else {
    out.buildings = [];
  }

  out.academic = snapshot.academic || null;
  out.profile = snapshot.profile || null;
  out.tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.slice(0, 20) : [];
  out.notes = Array.isArray(snapshot.notes) ? snapshot.notes.slice(0, 20) : [];

  return out;
}

export function platformSessionHeader(context, session) {
  const secret = context.env.GOOGLE_SESSION_SECRET;
  if (!secret) throw new Error("GOOGLE_SESSION_SECRET is not configured");
  return seal(session, secret).then((sealed) =>
    makeCookie(PLATFORM_SESSION_COOKIE, sealed, context.request, 60 * 60 * 24 * 30)
  );
}

export async function readPlatformSession(context) {
  const secret = context.env.GOOGLE_SESSION_SECRET;
  if (!secret) return null;
  return unseal(
    getCookie(context.request, PLATFORM_SESSION_COOKIE),
    secret
  );
}

export function generateCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeBytes(bytes);
}

export function csrfHeader(context, token) {
  const secret = context.env.GOOGLE_SESSION_SECRET;
  if (!secret) throw new Error("GOOGLE_SESSION_SECRET is not configured");
  return seal({ t: token, c: new Date().toISOString() }, secret).then(
    (sealed) =>
      makeCookie(CSRF_COOKIE, sealed, context.request, 60 * 10)
  );
}

export async function validateCsrf(context, token) {
  const secret = context.env.GOOGLE_SESSION_SECRET;
  if (!secret || !token) return false;
  const cookieValue = getCookie(context.request, CSRF_COOKIE);
  const data = await unseal(cookieValue, secret);
  if (!data || data.t !== token) return false;
  // CSRF token valid for 10 minutes
  const created = new Date(data.c).getTime();
  return Date.now() - created < 10 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// OAuth configuration (reuses canonical origin from Google lib)
// ---------------------------------------------------------------------------

export function oauthConfig(context) {
  const env = context.env || {};
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const sessionSecret = env.GOOGLE_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret)
    throw new Error("Google OAuth is not configured");
  const requestOrigin = new URL(context.request.url).origin;
  const origin = canonicalOrigin(context) || requestOrigin;
  return {
    clientId,
    clientSecret,
    sessionSecret,
    origin,
    requestOrigin,
    redirectUri: `${origin}/api/auth/google/callback`,
  };
}

export function buildAuthorizationUrl(config, state, nonce) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: PLATFORM_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "select_account consent",
    state,
    nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(config, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token)
      throw new Error(
        data.error_description || data.error || "OAuth token exchange failed"
      );
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGoogleUserInfo(accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.error?.message || `Google userinfo HTTP ${response.status}`
      );
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// User identity store — delegates to repository layer
// ---------------------------------------------------------------------------

import { Repo, Users } from "../repo/index.js";

export function resolveUserId(googleSub) {
  return Users.resolveId(googleSub);
}

export function getUserByGoogleSub(googleSub) {
  return Users.getByGoogleSub(googleSub);
}

export function upsertUser(googleSub, profile) {
  return Users.upsert(googleSub, profile);
}

export function getUser(userId) {
  return Users.getById(userId);
}

export function getAllUsers() {
  return Users.getAll();
}

// ---------------------------------------------------------------------------
// Sheets persistence boundary
// ---------------------------------------------------------------------------
// The repository is synchronous, so a request loads once and saves once around
// its ordinary calls. resolveUser() hydrates; any endpoint that writes must
// call flushRepo() before it responds, or the change lives only in the isolate.

/** The signed identity Apps Script authorizes every action against. */
function actorFrom(session) {
  return { googleSub: session.googleSub, email: session.email || "" };
}

async function hydrateRepo(context, session) {
  try {
    return await Repo.hydrate(context.env, actorFrom(session));
  } catch (error) {
    // Serve the request degraded rather than failing it outright: reads fall
    // back to the session cookie, and a write still persists on its own.
    console.error("repo: hydrate failed —", error.code || "", error.message);
    return { hydrated: false, isNew: false, counts: {}, error: error.message };
  }
}

/**
 * Load a user's rows before any repository read, for callers that run outside
 * resolveUser(). The OAuth callback needs this: it has a googleSub but no
 * platform session yet, and must see an existing row to update rather than
 * replace it. Returns { hydrated, isNew }.
 */
export async function hydrateRepoFor(context, googleSub, email) {
  if (!googleSub) return { hydrated: false, isNew: false, counts: {} };
  return hydrateRepo(context, { googleSub, email: email || "" });
}

/**
 * Persist everything this request changed. Call before returning a response
 * from any endpoint that mutates. Errors propagate on purpose: a student who
 * sees "saved" must not be looking at a write that silently failed.
 */
export async function flushRepo(context, session) {
  if (!session || !session.googleSub) return { flushed: false, applied: 0 };
  return Repo.flush(context.env, actorFrom(session));
}

/** True when this deployment persists to Google Sheets. */
export function persistenceEnabled(context) {
  return Repo.enabled(context.env);
}

// ---------------------------------------------------------------------------
// resolveUser / refreshSession — session-cookie-backed identity
// ---------------------------------------------------------------------------
// On Cloudflare Pages every invocation is isolated: in-memory Maps are empty.
// The session cookie is the only persistent store.  resolveUser() builds a
// user object from session data when the in-memory lookup misses, so every
// endpoint can rely on having a valid user without a cold-start crash.
// refreshSession() re-seals the cookie after state transitions (ONBOARDING,
// ACTIVE) so bootstrap can read the correct routing on the next page load.

/**
 * Read session, look up in-memory user, merge into a single object.
 * Returns { user, session, sessionCookie } or null if unauthenticated.
 * `sessionCookie` is only non-null when caller must set it on the response.
 */
export async function resolveUser(context) {
  const session = await readPlatformSession(context);
  if (!session || !session.googleSub) return null;

  // Load this user's rows from Sheets before any synchronous repository read.
  // A no-op when APPS_SCRIPT_URL is unset, which is how local dev runs.
  await hydrateRepo(context, session);

  const memUser = getUserByGoogleSub(session.googleSub);
  const ts = new Date().toISOString();

  // Build a canonical user object — prefer in-memory data when available,
  // fall back to session cookie fields.
  const user = memUser || {
    userId: session.userId || `user_${session.googleSub}`,
    googleSub: session.googleSub,
    email: session.email || "",
    name: session.name || "",
    picture: session.picture || "",
    state: session.state || "AUTHENTICATED",
    role: session.role || "student",
    profile: session.profile || null,
    corRecordId: session.corRecordId || null,
    corDraft: session.corDraft || null,
    createdAt: session.createdAt || ts,
    updatedAt: ts,
  };

  // Make the map hold this exact object, so a later Users.update() marks the
  // right row dirty instead of mutating a copy no flush can find.
  return { user: Users.adopt(user), session };
}

/**
 * Re-seal the session cookie with updated fields (e.g. state after a
 * transition) and return the Set-Cookie header value.
 */
export async function refreshSession(context, session, overrides) {
  const updated = { ...session, ...overrides };
  return platformSessionHeader(context, updated);
}
