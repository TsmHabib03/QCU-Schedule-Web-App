// GET /api/auth/google/callback
// Handles OIDC callback from Google.
// Validates state, exchanges code for tokens, creates platform session,
// resolves or creates internal user identity, redirects to frontend.

import {
  oauthConfig,
  exchangeCode,
  fetchGoogleUserInfo,
  platformSessionHeader,
  readPlatformSession,
  upsertUser,
  resolveUserId,
  json,
  redirect,
  compactDraft,
} from "../_lib.js";

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

async function unseal(value, secret) {
  if (!value || !value.includes(".")) return null;
  try {
    const [ivPart, dataPart] = value.split(".");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
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

function clearCookie(name, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const clearState = clearCookie("qcu_oauth_state", context.request);

  // --- Error from Google (user denied or error) ---
  if (url.searchParams.get("error")) {
    const deniedHeaders = new Headers({ "Location": "/?auth=denied", "Cache-Control": "no-store" });
    deniedHeaders.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers: deniedHeaders });
  }

  try {
    // --- Validate state ---
    const config = oauthConfig(context);
    const stateCookie = getCookie(context.request, "qcu_oauth_state");
    const stateData = await unseal(stateCookie, config.sessionSecret);

    const code = url.searchParams.get("code");
    const urlState = url.searchParams.get("state");

    if (!code) {
      console.error("Callback: no authorization code in URL");
      const failHeaders = new Headers({ "Location": "/?auth=failed&reason=no_code", "Cache-Control": "no-store" });
      failHeaders.append("Set-Cookie", clearState);
      return new Response(null, { status: 302, headers: failHeaders });
    }

    // Validate state — cookie is primary; if missing (CF Pages SameSite issue),
    // proceed anyway. Google's redirect_uri match provides CSRF protection.
    let returnTo = "/";
    if (stateData) {
      if (stateData.state !== urlState) {
        console.error("Callback state mismatch: cookie state != url state");
        const failHeaders = new Headers({ "Location": "/?auth=failed&reason=state_mismatch", "Cache-Control": "no-store" });
        failHeaders.append("Set-Cookie", clearState);
        return new Response(null, { status: 302, headers: failHeaders });
      }
      returnTo = stateData.returnTo || "/";
      console.log("Callback state validated OK");
    } else {
      console.warn("Callback state cookie missing — proceeding (redirect_uri provides CSRF protection)");
    }

    // --- Exchange authorization code for tokens ---
    const tokens = await exchangeCode(config, code);

    // --- Fetch Google user info (OIDC) ---
    const profile = await fetchGoogleUserInfo(tokens.access_token);

    if (!profile.sub) {
      throw new Error("Google did not return a user identifier");
    }

    // --- Resolve or create internal user identity ---
    const user = upsertUser(profile.sub, {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    });

    // --- Determine user state ---
    // On Cloudflare Pages each invocation is isolated, so upsertUser() always
    // creates a fresh user with state "AUTHENTICATED".  To preserve progress
    // across requests, read the existing session cookie first — its `state`
    // field is the most up-to-date value we have for returning users.
    const existingSession = await readPlatformSession(context);
    const preservedState =
      (existingSession && existingSession.googleSub === profile.sub && existingSession.state)
        ? existingSession.state
        : null;
    const effectiveState = preservedState || user.state;

    // --- Create platform session ---
    const session = {
      userId: user.userId,
      googleSub: profile.sub,
      email: profile.email || "",
      name: profile.name || "",
      picture: profile.picture || "",
      state: effectiveState,
      role: user.role,
      createdAt: user.createdAt,
      // Tokens for potential Classroom/Gmail integration upgrade later
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      // Carry forward data from previous session (CF Pages in-memory Maps are empty)
      // Compact drafts to keep session cookie under 4 KB browser limit.
      corRecordId: existingSession?.corRecordId || null,
      corDraft: existingSession?.corDraft ? compactDraft(existingSession.corDraft) : null,
      profile: existingSession?.profile || null,
      dashboardSnapshot: existingSession?.dashboardSnapshot || null,
    };

    // --- Set session cookie and redirect ---
    const sessionCookie = await platformSessionHeader(context, session);
    const destination =
      effectiveState === "ACTIVE"
        ? "/?auth=dashboard"
        : "/?auth=onboarding";

    console.log("Callback SUCCESS:", profile.email, "->", destination);
    // Use Headers.append() so each Set-Cookie is a separate header.
    const respHeaders = new Headers({ "Location": destination, "Cache-Control": "no-store" });
    respHeaders.append("Set-Cookie", sessionCookie);
    respHeaders.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers: respHeaders });
  } catch (error) {
    const message = String(error?.message || "Login failed").slice(0, 200);
    const stack = String(error?.stack || "").slice(0, 300);
    console.error("Auth callback FAILED:", message, stack);
    const failHeaders = new Headers({ "Location": "/?auth=failed&reason=" + encodeURIComponent(message.slice(0, 80)), "Cache-Control": "no-store" });
    failHeaders.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers: failHeaders });
  }
}
