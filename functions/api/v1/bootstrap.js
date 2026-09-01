// GET /api/v1/bootstrap
// Returns user state, profile, and routing decision.
// This is the main endpoint the frontend calls on page load to decide
// where to send the user (login → onboarding → dashboard).
// Now includes lightweight academic catalog metadata.

import {
  resolveUser,
  json,
} from "../auth/_lib.js";
import { CatalogSeed, Terms, Enrollments, Profiles } from "../repo/index.js";

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
        routing = "dashboard";
        break;
      case "DEACTIVATED":
        routing = "login";
        break;
      default:
        routing = "login";
    }

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
    console.error("Bootstrap failed:", String(error?.message || error));
    return json({
      status: "UNAUTHENTICATED",
      authenticated: false,
      routing: "login",
    });
  }
}
