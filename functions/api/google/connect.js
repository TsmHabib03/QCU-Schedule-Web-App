import { buildAuthorizationUrl, canonicalOrigin, oauthConfig, oauthStateHeader, redirect, safeReturnTo } from "./_lib.js";

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const includeGmail = url.searchParams.get("gmail") === "1";
    const nonce = crypto.randomUUID();
    const returnTo = safeReturnTo(url.searchParams.get("return"));

    // The OAuth state cookie, the Google callback, and the resulting session
    // cookie must all live on one host. When this deployment is reached through
    // a preview/alias hostname, hand the whole flow to the canonical origin
    // first — that is the only origin registered with Google.
    const canonical = canonicalOrigin(context);
    if (canonical && canonical !== url.origin) {
      const handoff = new URL("/api/google/connect", canonical);
      handoff.search = url.search;
      return redirect(handoff.toString());
    }

    const config = oauthConfig(context);
    const state = { nonce, includeGmail, returnTo, createdAt: Date.now() };
    return redirect(buildAuthorizationUrl(config, nonce, includeGmail), {
      "Set-Cookie": await oauthStateHeader(context, state)
    });
  } catch (error) {
    const reason = encodeURIComponent(String(error && error.message || "Google OAuth is not configured").slice(0, 180));
    return redirect(`/google.html?google=unconfigured&reason=${reason}#google-integration`);
  }
}
