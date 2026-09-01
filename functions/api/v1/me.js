// GET /api/v1/me — Returns authenticated user profile
// PATCH /api/v1/me — Updates user profile (stub for CHUNK 24)

import {
  resolveUser,
  json,
} from "../auth/_lib.js";

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    return json({
      status: "OK",
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        state: user.state,
        role: user.role,
        profile: user.profile,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Profile fetch failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to fetch profile" }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const { user } = resolved;

    // Only allow state transitions that are valid
    const body = await context.request.json().catch(() => ({}));

    if (body.state) {
      const validTransitions = {
        NEW: ["AUTHENTICATED"],
        AUTHENTICATED: ["ONBOARDING"],
        ONBOARDING: ["ACTIVE"],
        ACTIVE: ["DEACTIVATED"],
        DEACTIVATED: ["AUTHENTICATED"],
      };
      const allowed = validTransitions[user.state] || [];
      if (!allowed.includes(body.state)) {
        return json(
          {
            status: "ERROR",
            error: `Cannot transition from ${user.state} to ${body.state}`,
          },
          400
        );
      }
      user.state = body.state;
    }

    // Profile data (registration fields) — stub for CHUNK 24
    if (body.profile) {
      user.profile = { ...user.profile, ...body.profile };
    }

    user.updatedAt = new Date().toISOString();

    return json({
      status: "OK",
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        state: user.state,
        role: user.role,
        profile: user.profile,
      },
    });
  } catch (error) {
    console.error("Profile update failed:", String(error?.message || error));
    return json({ status: "ERROR", error: "Failed to update profile" }, 500);
  }
}
