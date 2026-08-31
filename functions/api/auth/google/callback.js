// GET /api/auth/google/callback
// Handles OIDC callback from Google.
// Validates state, exchanges code for tokens, creates platform session,
// resolves or creates internal user identity, redirects to frontend.

import {
  oauthConfig,
  exchangeCode,
  fetchGoogleUserInfo,
  platformSessionHeader,
  upsertUser,
  resolveUserId,
  json,
  redirect,
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
  return btoa(binary).replace(/\+/g, "-").replace(/_/g, "_").replace(/=+$/g, "");
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

  // --- Validate state ---
  const config = oauthConfig(context);
  const stateCookie = getCookie(context.request, "qcu_oauth_state");
  const stateData = await unseal(stateCookie, config.sessionSecret);

  if (
    !stateData ||
    stateData.state !== url.searchParams.get("state") ||
    !url.searchParams.get("code")
  ) {
    console.error("Callback state validation FAILED. stateData:", !!stateData, "urlState:", url.searchParams.get("state")?.substring(0, 20));
    const failHeaders = new Headers({ "Location": "/?auth=failed", "Cache-Control": "no-store" });
    failHeaders.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers: failHeaders });
  }

  const returnTo = stateData.returnTo || "/";

  try {
    // --- Exchange authorization code for tokens ---
    const tokens = await exchangeCode(config, url.searchParams.get("code"));

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

    // --- Create platform session ---
    const session = {
      userId: user.userId,
      googleSub: profile.sub,
      email: profile.email || "",
      name: profile.name || "",
      picture: profile.picture || "",
      state: user.state,
      role: user.role,
      createdAt: user.createdAt,
      // Tokens for potential Classroom/Gmail integration upgrade later
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    };

    // --- Set session cookie and redirect ---
    const sessionCookie = await platformSessionHeader(context, session);
    const destination =
      user.state === "NEW" || user.state === "AUTHENTICATED"
        ? "/?auth=onboarding"
        : "/?auth=dashboard";

    console.log("Callback SUCCESS:", profile.email, "->", destination);
    console.log("Session cookie starts:", sessionCookie.substring(0, 60));
    // Use Headers.append() so each Set-Cookie is a separate header.
    // Passing an array via redirect() causes the Headers API to merge them
    // into one comma-delimited string, which browsers reject.
    const respHeaders = new Headers({ "Location": destination, "Cache-Control": "no-store" });
    respHeaders.append("Set-Cookie", sessionCookie);
    respHeaders.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers: respHeaders });
  } catch (error) {
    const message = String(error?.message || "Login failed").slice(0, 200);
    console.error("Auth callback FAILED:", message);
    const errHeaders = new Headers({ "Location": "/?auth=failed", "Cache-Control": "no-store" });
    errHeaders.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers: errHeaders });
  }
}
