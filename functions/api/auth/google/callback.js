import { isAdminIdentity } from '../../admin/_lib.js';
import { finishLogin } from '../_login.js';
// GET /api/auth/google/callback
// Handles OIDC callback from Google.
// Validates state, exchanges code for tokens, creates platform session,
// resolves or creates internal user identity, redirects to frontend.

import {
  clearAllAuthCookies,
  oauthConfig,
  exchangeCode,
  fetchGoogleUserInfo,
  pendingLoginHeader,
  clearPendingLogin,
  safeAuthReturnTo,
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
  let pendingIdentity = null;

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

    // Require the encrypted state cookie and an exact state match. The OAuth
    // redirect URI alone does not bind this callback to the browser session.
    if (!stateData || !urlState || stateData.state !== urlState ||
        !Number.isFinite(Date.parse(stateData.createdAt)) ||
        Date.now() - Date.parse(stateData.createdAt) > 600000 ||
        Date.parse(stateData.createdAt) > Date.now() + 60000) {
      console.error("Callback state validation failed");
      const mismatchHeaders = new Headers({ "Location": "/?auth=failed&reason=state_mismatch", "Cache-Control": "no-store" });
      mismatchHeaders.append("Set-Cookie", clearState);
      return new Response(null, { status: 302, headers: mismatchHeaders });
    }
    const returnTo = safeAuthReturnTo(stateData.returnTo);
    console.log("Callback state validated OK");

    // --- Exchange authorization code for tokens ---
    const tokens = await exchangeCode(config, code);

    // --- Fetch Google user info (OIDC) ---
    const profile = await fetchGoogleUserInfo(tokens.access_token);

    if (!profile.sub || profile.email_verified !== true) {
      throw new Error("Google did not return a user identifier");
    }

    const adminLogin = ['/admin', '/admin.html'].includes(returnTo);
    const verifiedIdentity = { googleSub: profile.sub, email: profile.email, emailVerified: profile.email_verified === true };
    if (adminLogin && !isAdminIdentity(context.env, verifiedIdentity)) {
      const headers = new Headers({ Location: '/?auth=admin_denied', 'Cache-Control': 'no-store' });
      for (const cookie of clearAllAuthCookies(context.request)) headers.append('Set-Cookie', cookie);
      headers.append('Set-Cookie', clearState);
      return new Response(null, { status: 302, headers });
    }

    pendingIdentity = { ...verifiedIdentity, name: String(profile.name || '').slice(0, 200),
      picture: String(profile.picture || '').slice(0, 1000), issuedAt: Date.now(), returnTo };
    const { cookie: sessionCookie, destination } = await finishLogin(context, pendingIdentity);

    // Use a 302 redirect with Set-Cookie. The same-origin redirect ensures
    // the browser stores the session cookie before navigating.
    const respHeaders = new Headers({
      "Location": destination,
      "Cache-Control": "no-store",
    });
    respHeaders.append("Set-Cookie", sessionCookie);
    respHeaders.append("Set-Cookie", clearState);
    respHeaders.append('Set-Cookie', clearPendingLogin(context));
    return new Response(null, { status: 302, headers: respHeaders });
  } catch (error) {
    console.error('Auth callback failed:', error.code || error.name);
    if (pendingIdentity && error.retryable) {
      const headers = new Headers({ Location: '/?auth=finishing', 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', await pendingLoginHeader(context, pendingIdentity));
      headers.append('Set-Cookie', clearState);
      return new Response(null, { status: 302, headers });
    }
    const errReason = error.code === 'FORBIDDEN' ? 'account_unavailable' : error.code === 'UNAUTHENTICATED' ? 'session_revoked' : 'provider_unavailable';
    const errHeaders = new Headers({
      "Location": error.code === "BACKEND_NOT_CONFIGURED" ? "/?auth=backend_unavailable" : `/?auth=failed&reason=${errReason}`,
      "Cache-Control": "no-store",
    });
    errHeaders.append("Set-Cookie", clearState);
    errHeaders.append('Set-Cookie', clearPendingLogin(context));
    return new Response(null, { status: 302, headers: errHeaders });
  }
}
