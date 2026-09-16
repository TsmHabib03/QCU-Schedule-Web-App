import { isAdminIdentity } from '../admin/_lib.js';
// GET /api/v1/bootstrap
// Returns user state, profile, and routing decision.
// This is the main endpoint the frontend calls on page load to decide
// where to send the user (login → onboarding → dashboard).
// Now includes lightweight academic catalog metadata.

import {
  resolveUser,
  json,
} from "../auth/_lib.js";
import { CatalogSeed, Terms, Enrollments, Profiles, isScheduleReady } from "../repo/index.js";

export async function onRequestGet(context) {
  try {
    const resolved = await resolveUser(context);

    if (!resolved) {
      return json({
        status: "UNAUTHENTICATED",
        authenticated: false,
        routing: "login",
        academic: CatalogSeed.isLoaded() ? CatalogSeed.meta() : null,
      });
    }

    const { user } = resolved;

    let routing;
    switch (user.state) {
      case "NEW":
      case "AUTHENTICATED":
        routing = "onboarding";
        break;
      case "ONBOARDING":
        routing = "onboarding";
        break;
      case "ACTIVE":
        // ACTIVE is not the same as ready: a legacy account (or a COR confirm
        // that produced no meetings) is active with nothing to show, and used to
        // be sent straight to a dashboard with an empty week.
        routing = isScheduleReady(user.userId) ? "dashboard" : "onboarding";
        break;
      case "DEACTIVATED":
        routing = "login";
        break;
      default:
        routing = "login";
    }

    if (isAdminIdentity(context.env, resolved.session)) routing = 'admin';

    // Lightweight academic context for the frontend
    const academicMeta = CatalogSeed.isLoaded() ? CatalogSeed.meta() : null;
    const currentTerm = Terms.getCurrent();

    // Active enrollment (if user is ACTIVE)
    let activeEnrollment = null;
    if (user.state === "ACTIVE") {
      const enrollments = Enrollments.getByUserId(user.userId);
      activeEnrollment = enrollments.find(e => e.status === "ACTIVE") || null;
    }

    return json({
      status: "OK",
      authenticated: true,
      routing,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        state: user.state,
        role: user.role,
        hasProfile: !!user.profile,
      },
      academic: academicMeta ? {
        catalogVersion: academicMeta.version,
        currentTermId: currentTerm?.termId || null,
        currentTermName: currentTerm?.name || null,
        activeEnrollmentId: activeEnrollment?.enrollmentId || null,
        activeProgramId: activeEnrollment?.programId || null,
        activeCampusId: activeEnrollment?.campusId || null,
      } : null,
    });
  } catch (error) {
    if (error.code === 'UNAUTHENTICATED') return json({ status: 'UNAUTHENTICATED', authenticated: false, routing: 'login' }, 401);
    if (error.code === 'FORBIDDEN') return json({ status: 'FORBIDDEN', error: 'Account access is unavailable. Contact your administrator.' }, 403);
    console.error('Bootstrap failed:', error.code || error.name);
    return json({ status: 'SERVICE_UNAVAILABLE', error: 'Your account could not be loaded. Please try again.' }, 503);
  }
}
