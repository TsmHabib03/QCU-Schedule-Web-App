import { readPlatformSession, json, validateCsrf } from '../auth/_lib.js';
import { callAction, isConfigured } from '../repo/sheets-adapter.js';

export const ADMIN_EMAIL = 'myscheduleqcu@gmail.com';
export function isAdminIdentity(env, session) {
  const pinned = String(env.ADMIN_GOOGLE_SUB || '').trim();
  return Boolean(session?.googleSub && session.emailVerified === true &&
    session.email?.toLowerCase() === ADMIN_EMAIL && (!pinned || session.googleSub === pinned));
}
export async function adminCall(context, action, payload = {}) {
  const session = await readPlatformSession(context);
  if (!session) throw Object.assign(new Error('Please sign in again to manage accounts.'), { code: 'UNAUTHENTICATED' });
  if (!isAdminIdentity(context.env, session)) throw Object.assign(new Error('Administrator sign-in required.'), { code: 'FORBIDDEN' });
  if (Date.now() - Number(session.issuedAt || 0) > 60 * 60 * 1000) throw Object.assign(new Error('Please sign in again to manage accounts.'), { code: 'UNAUTHENTICATED' });
  if (!isConfigured(context.env)) throw Object.assign(new Error('The database connection is not configured.'), { code: 'BACKEND_NOT_CONFIGURED' });
  try { return await callAction(context.env, action, session, payload); }
  catch (error) {
    if (error.code === 'UNAUTHENTICATED' && /signature|request timestamp|nonce/i.test(error.message)) {
      throw Object.assign(new Error('The database rejected the server credentials.'), { code: 'BACKEND_AUTH_FAILED' });
    }
    throw error;
  }
}
export async function mutationBody(context) {
  if (context.request.headers.get('Origin') !== new URL(context.request.url).origin) {
    throw Object.assign(new Error('Same-origin request required.'), { code: 'FORBIDDEN' });
  }
  if (!await validateCsrf(context, context.request.headers.get('X-CSRF-Token'))) {
    throw Object.assign(new Error('Refresh the account details and try again.'), { code: 'CSRF_INVALID' });
  }
  const reader = context.request.body?.getReader();
  const chunks = []; let length = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw Object.assign(new Error('Request too large.'), { code: 'VALIDATION_FAILED' }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body;
  } catch { throw Object.assign(new Error('Invalid request.'), { code: 'VALIDATION_FAILED' }); }
}
export function failure(error) {
  const status = { FORBIDDEN: 403, CSRF_INVALID: 403, PROTECTED_ACCOUNT: 403, UNAUTHENTICATED: 401, NOT_FOUND: 404, CONFLICT: 409, RATE_LIMITED: 429, VALIDATION_FAILED: 400 }[error.code] || 503;
  const diagnostics = {
    SCHEMA_OUTDATED: 'Update Apps Script Code.gs from setup-database.gs, run setupDatabase(), then deploy a new version.',
    BACKEND_NOT_CONFIGURED: 'Set APPS_SCRIPT_URL and APPS_SCRIPT_SECRET in the server configuration.',
    BACKEND_AUTH_FAILED: 'APPS_SCRIPT_SECRET must match the signing secret in Apps Script properties.',
    FILE_CLEANUP_FAILED: 'The account is closed, but its files could not be removed. Authorize Drive access in Apps Script and check file permissions, then reopen the details and retry deletion.'
  };
  return json({ code: error.code || 'SERVICE_UNAVAILABLE', error: diagnostics[error.code] || (status === 503 ? 'The database did not confirm the result. Refresh the account details before retrying.' : error.message) }, status, { 'Cache-Control': 'no-store' });
}
