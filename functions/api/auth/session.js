import { readPlatformSession } from './_lib.js';
import { callAction, isConfigured } from '../repo/sheets-adapter.js';
import { isAdminIdentity } from '../admin/_lib.js';
// GET /api/auth/session
// Returns the current platform session status.
// Used by frontend to determine auth state on page load.

import {
  resolveUser,
  json,
} from "./_lib.js";

export async function onRequestGet(context) {
  try {
    const session = await readPlatformSession(context);
    if (session && isConfigured(context.env)) {
      const result = await callAction(context.env, 'auth.read', session);
      if (result.isNew) return json({ authenticated: false }, 401);
      return json({ authenticated: true, status: 'OK', user: { userId: result.user.userId, email: result.user.email, name: result.user.displayName, state: result.user.onboardingState, role: isAdminIdentity(context.env, session) ? 'admin' : 'student' } });
    }
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
    if (error.code === 'UNAUTHENTICATED') return json({ status: 'UNAUTHENTICATED', authenticated: false }, 401);
    if (error.code === 'FORBIDDEN') return json({ status: 'FORBIDDEN', error: 'Account access is unavailable. Contact your administrator.' }, 403);
    console.error('Session check failed:', error.code || error.name);
    return json({ status: 'SERVICE_UNAVAILABLE', error: 'Your session could not be checked. Please try again.' }, 503);
  }
}
