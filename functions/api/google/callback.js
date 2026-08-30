import {
  GMAIL_SCOPE,
  OAUTH_COOKIE,
  clearCookie,
  exchangeCode,
  googleJson,
  oauthConfig,
  readOauthState,
  readSession,
  redirect,
  sessionHeader
} from "./_lib.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const oauthState = await readOauthState(context).catch(() => null);
  const returnTo = oauthState && oauthState.returnTo ? oauthState.returnTo : "/google.html#google-integration";
  const clearState = clearCookie(OAUTH_COOKIE, context.request);

  if (url.searchParams.get("error")) {
    const result = oauthState && oauthState.includeGmail ? "gmail_denied" : "cancelled";
    return redirect(`${returnTo.split("#")[0]}?google=${result}#google-integration`, { "Set-Cookie": clearState });
  }
  if (!oauthState || oauthState.nonce !== url.searchParams.get("state") || !url.searchParams.get("code")) {
    return redirect(`${returnTo.split("#")[0]}?google=failed#google-integration`, { "Set-Cookie": clearState });
  }

  try {
    const config = oauthConfig(context);
    const previous = await readSession(context).catch(() => null);
    const tokens = await exchangeCode(config, url.searchParams.get("code"));
    const profile = await googleJson("https://openidconnect.googleapis.com/v1/userinfo", tokens.access_token);
    const scopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
    const session = {
      email: profile.email || (previous && previous.email) || "",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || (previous && previous.refreshToken) || "",
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      scopes,
      preferences: {
        classroom: previous && previous.preferences ? previous.preferences.classroom !== false : true,
        gmail: scopes.includes(GMAIL_SCOPE) && (oauthState.includeGmail || Boolean(previous && previous.preferences && previous.preferences.gmail)),
        autoRefresh: previous && previous.preferences ? previous.preferences.autoRefresh !== false : true
      },
      connectedAt: previous && previous.connectedAt ? previous.connectedAt : new Date().toISOString()
    };
    if (!session.refreshToken) throw new Error("Google did not return a renewable authorization");
    const destination = `${returnTo.split("#")[0]}?google=connected#google-integration`;
    return redirect(destination, { "Set-Cookie": await sessionHeader(context, session) });
  } catch (error) {
    const message = String(error && error.message || "OAuth callback failed").slice(0, 180);
    console.error("Google OAuth callback failed:", message);
    const reason = encodeURIComponent(message);
    return redirect(`${returnTo.split("#")[0]}?google=failed&reason=${reason}#google-integration`, { "Set-Cookie": clearState });
  }
}
