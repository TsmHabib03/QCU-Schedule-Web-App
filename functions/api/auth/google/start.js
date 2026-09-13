// GET /api/auth/google/start
// Initiates the platform OIDC login flow.
// Generates state + nonce, stores in encrypted cookie, redirects to Google.

import {
  oauthConfig,
  buildAuthorizationUrl,
  json,
  redirect,
  safeAuthReturnTo,
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

export async function onRequestGet(context) {
  try {
    const config = oauthConfig(context);
    const incoming = new URL(context.request.url);
    const returnTo = safeAuthReturnTo(incoming.searchParams.get('returnTo'));
    // Host-only state cookies must be created on the callback origin. A state
    // cookie on a preview/custom hostname is unavailable on the public domain.
    if (config.origin !== incoming.origin) {
      const canonicalStart = new URL('/api/auth/google/start', config.origin);
      canonicalStart.searchParams.set('returnTo', returnTo);
      return redirect(canonicalStart.href, { 'Cache-Control': 'no-store' });
    }

    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = encodeBytes(stateBytes);

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = encodeBytes(nonceBytes);

    // Only preserve same-origin application paths. Never seal an external URL
    // into the state cookie because it becomes a post-login open redirect.

    const stateData = { state, nonce, returnTo, createdAt: new Date().toISOString() };
    const stateCookie = await seal(stateData, config.sessionSecret);

    const authorizationUrl = new URL(buildAuthorizationUrl(config, state, nonce));
    const authUrl = authorizationUrl.toString();

    // Return an auto-submitting HTML form instead of a 302 redirect.
    // This ensures the state cookie is set on the page origin (same site)
    // before the browser navigates to Google, fixing SameSite cookie loss
    // that occurs with 302 redirects on some Cloudflare Pages deployments.
    const secure = new URL(context.request.url).protocol === "https:" ? "; Secure" : "";
    const cookieHeader = `qcu_oauth_state=${stateCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;

    // Build the auth URL and use JavaScript redirect instead of form submit.
    // The state cookie is set via HTTP Set-Cookie on this 200 response;
    // the JS redirect fires after the browser processes Set-Cookie.
    const html = `<!DOCTYPE html><html><head><title>Redirecting to Google...</title>` +
      `<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555}</style>` +
      `</head><body>` +
      `<p>Redirecting to Google Sign-In...</p>` +
      `<script>window.location.replace(${JSON.stringify(authUrl).replace(/</g, '\\u003c')})</script>` +
      `<noscript><p>Enable JavaScript, then reload this page to sign in.</p></noscript>` +
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
