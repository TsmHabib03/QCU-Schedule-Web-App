import { SESSION_COOKIE, clearCookie, json, readSession } from "./_lib.js";

export async function onRequestPost(context) {
  try {
    const session = await readSession(context);
    if (session && session.refreshToken) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: session.refreshToken })
      });
    }
  } catch (_) {
    // Local disconnection must still succeed if Google is temporarily unavailable.
  }
  return json({ connected: false }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE, context.request) });
}
