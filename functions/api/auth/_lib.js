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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
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
}

export async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
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
}

// ---------------------------------------------------------------------------
// User identity store — delegates to repository layer
// ---------------------------------------------------------------------------

import { Users } from "../repo/index.js";

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

  return { user, session };
}

/**
 * Re-seal the session cookie with updated fields (e.g. state after a
 * transition) and return the Set-Cookie header value.
 */
export async function refreshSession(context, session, overrides) {
  const updated = { ...session, ...overrides };
  return platformSessionHeader(context, updated);
}
