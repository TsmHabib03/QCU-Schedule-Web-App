// GET /api/auth/session
// Returns the current platform session status.
// Used by frontend to determine auth state on page load.

import {
  readPlatformSession,
  json,
} from "./_lib.js";

export async function onRequestGet(context) {
  try {
    // DEBUG: log cookies received
    const cookies = context.request.headers.get("Cookie") || "";
    console.log("Session check cookies:", cookies.split(";").map(c => c.trim().split("=")[0]).join(", "));
    const session = await readPlatformSession(context);
    console.log("Session result:", session ? "FOUND" : "NULL");

    if (!session) {
      return json({
        status: "UNAUTHENTICATED",
        authenticated: false,
      });
    }

    return json({
      status: "OK",
      authenticated: true,
      user: {
        userId: session.userId,
        email: session.email,
        name: session.name,
        picture: session.picture,
        state: session.state,
        role: session.role,
      },
    });
  } catch (error) {
    console.error("Session check failed:", String(error?.message || error));
    return json({
      status: "UNAUTHENTICATED",
      authenticated: false,
    });
  }
}
