// GET /api/auth/session
// Returns the current platform session status.
// Used by frontend to determine auth state on page load.

import {
  resolveUser,
  json,
} from "./_lib.js";

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);

    if (!resolved) {
      return json({
        status: "UNAUTHENTICATED",
        authenticated: false,
      });
    }

    const { user } = resolved;

    return json({
      status: "OK",
      authenticated: true,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        state: user.state,
        role: user.role,
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
