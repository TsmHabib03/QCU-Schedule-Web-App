// POST /api/auth/logout
// Destroys platform session and integration session cookies.
// Returns success for the frontend to clear local state and redirect.

import {
  clearAllAuthCookies,
  json,
} from "./_lib.js";

export async function onRequestPost(context) {
  try {
    const cookies = clearAllAuthCookies(context.request);

    return json(
      { status: "OK", message: "Logged out" },
      200,
      {
        "Set-Cookie": cookies,
        "Cache-Control": "no-store",
      }
    );
  } catch (error) {
    console.error("Logout failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Logout failed" }, 500);
  }
}
