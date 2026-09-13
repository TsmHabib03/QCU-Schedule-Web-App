import { hydrateRepoFor, upsertUser, readPlatformSession, platformSessionHeader, flushRepo, safeAuthReturnTo } from './_lib.js';
import { callAction, isConfigured } from '../repo/sheets-adapter.js';
import { isAdminIdentity } from '../admin/_lib.js';

export async function finishLogin(context, identity) {
  const hydration = await hydrateRepoFor(context, identity.googleSub, identity.email, identity);
  const user = upsertUser(identity.googleSub, { email: identity.email, name: identity.name, picture: identity.picture });
  const previous = await readPlatformSession(context);
  const prior = previous?.googleSub === identity.googleSub ? previous : null;
  const effectiveState = hydration.hydrated && !hydration.isNew ? user.state : prior?.state || user.state;
  const session = { userId: user.userId, googleSub: identity.googleSub, email: identity.email,
    emailVerified: true, issuedAt: identity.issuedAt, name: identity.name, picture: identity.picture,
    state: effectiveState, role: user.role, createdAt: user.createdAt, corRecordId: user.corRecordId || prior?.corRecordId || null,
    profile: null, enrollment: null, enrollmentSubjects: null };
  try { await flushRepo(context, session); }
  catch (error) {
    if (!isConfigured(context.env) || !error.retryable) throw error;
    // A lost save response can still represent a completed first login. Read
    // the saved login stamp before asking the browser to repeat anything.
    const saved = await callAction(context.env, 'auth.read', session);
    if (saved.isNew || String(saved.user?.lastLoginAt) !== String(user.lastLoginAt)) throw error;
  }
  const returnTo = safeAuthReturnTo(identity.returnTo);
  const destination = isAdminIdentity(context.env, session) ? '/admin.html'
    : returnTo === '/onboarding.html' ? returnTo
    : effectiveState === 'ACTIVE' ? (returnTo === '/' ? '/?auth=dashboard' : returnTo) : '/?auth=onboarding';
  return { cookie: await platformSessionHeader(context, session), destination };
}
