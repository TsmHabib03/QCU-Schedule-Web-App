import { GMAIL_SCOPE, hasScope, json, readSession, sessionHeader } from "./_lib.js";

export async function onRequestPost(context) {
  try {
    const session = await readSession(context);
    if (!session) return json({ connected: false, error: "Connect Google first." }, 401);
    const body = await context.request.json().catch(() => ({}));
    const next = {
      classroom: body.classroom !== false,
      gmail: body.gmail === true,
      autoRefresh: body.autoRefresh !== false
    };
    if (next.gmail && !hasScope(session, GMAIL_SCOPE)) {
      return json({
        connected: true,
        needsGmailAuthorization: true,
        authorizationUrl: "/api/google/connect?gmail=1&return=google.html%23google-integration"
      }, 409);
    }
    session.preferences = next;
    return json({ connected: true, preferences: next }, 200, { "Set-Cookie": await sessionHeader(context, session) });
  } catch (_) {
    return json({ error: "Google preferences could not be saved." }, 503);
  }
}
