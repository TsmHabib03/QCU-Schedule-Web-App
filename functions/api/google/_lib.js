const SESSION_COOKIE = "qcu_google_session";
const OAUTH_COOKIE = "qcu_google_oauth";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const CLASSROOM_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly"
];

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";

function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

async function encryptionKey(secret) {
  if (!secret || secret.length < 24) throw new Error("GOOGLE_SESSION_SECRET is not configured");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
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

function cookie(name, value, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name, request) {
  return cookie(name, "", request, 0);
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      ...headers
    }
  });
}

export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", ...headers } });
}

// Google matches `redirect_uri` byte-for-byte against the Authorized redirect
// URIs registered on the OAuth client, and it accepts no wildcards. Cloudflare
// Pages hands every deployment its own hostname (<hash>.<project>.pages.dev),
// so deriving the redirect URI from the incoming request origin guarantees
// `Error 400: redirect_uri_mismatch` on any origin that was not registered by
// hand. GOOGLE_PUBLIC_ORIGIN pins the flow to the one origin that is.
export function canonicalOrigin(context) {
  const env = context.env || {};
  const configured = String(env.GOOGLE_PUBLIC_ORIGIN || "").trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch (_) {
    return null;
  }
}

export function oauthConfig(context) {
  const env = context.env || {};
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const sessionSecret = env.GOOGLE_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) throw new Error("Google OAuth is not configured");
  const requestOrigin = new URL(context.request.url).origin;
  const origin = canonicalOrigin(context) || requestOrigin;
  return {
    clientId,
    clientSecret,
    sessionSecret,
    origin,
    requestOrigin,
    redirectUri: `${origin}/api/google/callback`
  };
}

export function safeReturnTo(value) {
  const path = String(value || "google.html#google-integration");
  if (/^(?:https?:|\/\/)/i.test(path) || path.includes("\\")) return "/google.html#google-integration";
  return "/" + path.replace(/^\/+/, "");
}

export async function readSession(context) {
  const config = oauthConfig(context);
  return unseal(getCookie(context.request, SESSION_COOKIE), config.sessionSecret);
}

export async function sessionHeader(context, session) {
  const config = oauthConfig(context);
  return cookie(SESSION_COOKIE, await seal(session, config.sessionSecret), context.request, 60 * 60 * 24 * 30);
}

export async function oauthStateHeader(context, state) {
  const config = oauthConfig(context);
  return cookie(OAUTH_COOKIE, await seal(state, config.sessionSecret), context.request, 60 * 10);
}

export async function readOauthState(context) {
  const config = oauthConfig(context);
  return unseal(getCookie(context.request, OAUTH_COOKIE), config.sessionSecret);
}

export function buildAuthorizationUrl(config, state, includeGmail) {
  const scopes = includeGmail ? [...CLASSROOM_SCOPES, GMAIL_SCOPE] : CLASSROOM_SCOPES;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "select_account consent",
    state
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function exchangeCode(config, code) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "OAuth token exchange failed");
  return data;
}

async function refreshToken(config, refreshTokenValue) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token"
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Google connection needs renewal");
  return data;
}

export async function validSession(context) {
  const config = oauthConfig(context);
  const session = await readSession(context);
  if (!session || !session.refreshToken) return { session: null, changed: false };
  if (session.accessToken && Number(session.expiresAt || 0) > Date.now() + 60_000) return { session, changed: false };
  const refreshed = await refreshToken(config, session.refreshToken);
  session.accessToken = refreshed.access_token;
  session.expiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  if (refreshed.scope) session.scopes = refreshed.scope.split(/\s+/).filter(Boolean);
  return { session, changed: true };
}

export async function googleJson(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error && data.error.message ? data.error.message : `Google API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

export function hasScope(session, scope) {
  return Array.isArray(session && session.scopes) && session.scopes.includes(scope);
}

export { SESSION_COOKIE, OAUTH_COOKIE };
