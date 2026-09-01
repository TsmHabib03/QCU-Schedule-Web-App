// GET /api/auth/google/start
// Initiates the platform OIDC login flow.
// Generates state + nonce, stores in encrypted cookie, redirects to Google.

import {
  oauthConfig,
  buildAuthorizationUrl,
  generateCsrfToken,
  json,
  redirect,
} from "../_lib.js";

function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return encodeBytes(iv) + "." + encodeBytes(new Uint8Array(encrypted));
}

function makeCookie(name, value, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function onRequestGet(context) {
  try {
    const config = oauthConfig(context);

    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = encodeBytes(stateBytes);

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = encodeBytes(nonceBytes);

    const url = new URL(context.request.url);
    const returnTo = url.searchParams.get("returnTo") || "/";

    const stateCookie = await seal(
      { state, nonce, returnTo, createdAt: new Date().toISOString() },
      config.sessionSecret
    );

    const authUrl = buildAuthorizationUrl(config, state, nonce);

    const headers = {
      "Set-Cookie": makeCookie("qcu_oauth_state", stateCookie, context.request, 60 * 10),
      "Cache-Control": "no-store",
    };

    return redirect(authUrl, headers);
  } catch (error) {
    const message = String(error?.message || "Failed to start login");
    console.error("Auth start failed:", message);
    return json({ status: "ERROR", error: message }, 500);
  }
}
