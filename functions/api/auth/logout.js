// POST /api/auth/logout — API logout (fetch-based)
// GET /api/auth/logout  — Navigation logout (302 redirect, most reliable)
// Both destroy platform session and integration session cookies.

import {
  clearAllAuthCookies,
  json,
} from "./_lib.js";

/**
 * GET handler: 302 redirect with Set-Cookie. The browser follows the redirect
 * and stores the cleared cookies BEFORE navigating to the landing page.
 * This is the most reliable way to clear HttpOnly cookies.
 */
export async function onRequestGet(context) {
  try {
    const cookies = clearAllAuthCookies(context.request);
    const headers = new Headers({
      "Location": "/",
      "Cache-Control": "no-store",
    });
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("Logout failed:", String(error?.message || error));
    return new Response(null, { status: 302, headers: { "Location": "/" } });
  }
}

/**
 * POST handler: JSON response with Set-Cookie. Used by fetch-based logout.
 */
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
