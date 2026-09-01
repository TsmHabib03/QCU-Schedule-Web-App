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

    const stateData = { state, nonce, returnTo, createdAt: new Date().toISOString() };
    const stateCookie = await seal(stateData, config.sessionSecret);

    const authUrl = buildAuthorizationUrl(config, state, nonce);

    // Return an auto-submitting HTML form instead of a 302 redirect.
    // This ensures the state cookie is set on the page origin (same site)
    // before the browser navigates to Google, fixing SameSite cookie loss
    // that occurs with 302 redirects on some Cloudflare Pages deployments.
    const secure = new URL(context.request.url).protocol === "https:" ? "; Secure" : "";
    const cookieHeader = `qcu_oauth_state=${stateCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;

    const html = `<!DOCTYPE html><html><head><title>Redirecting to Google...</title></head><body>` +
      `<script>` +
      `try{localStorage.setItem('qcu_oauth_state','${stateCookie}')}catch(e){}` +
      `</script>` +
      `<form id="f" method="GET" action="${authUrl.replace(/"/g, '&quot;')}">` +
      `</form>` +
      `<script>document.getElementById('f').submit()</script>` +
      `</body></html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": cookieHeader,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = String(error?.message || "Failed to start login");
    console.error("Auth start failed:", message);
    return json({ status: "ERROR", error: message }, 500);
  }
}
