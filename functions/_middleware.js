import { adminCall } from './api/admin/_lib.js';

// Protect the HTML route as well as its API. Pages may normalize .html URLs.
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.replace(/\/$/, '');
  if (!['/admin', '/admin.html'].includes(path)) return context.next();
  try {
    await adminCall(context, 'admin.access');
    const response = await context.next();
    const protectedResponse = new Response(response.body, response);
    protectedResponse.headers.set('Cache-Control', 'no-store');
    return protectedResponse;
  } catch (error) {
    if (['FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code)) {
      return new Response(null, { status: 302, headers: { Location: '/?auth=admin_denied', 'Cache-Control': 'no-store' } });
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(context.request.url).hostname);
    const diagnostics = {
      BACKEND_NOT_CONFIGURED: 'Database setup is incomplete. Set APPS_SCRIPT_URL and APPS_SCRIPT_SECRET in .dev.vars. The secret must match APPS_SCRIPT_SECRET in Apps Script Project Settings > Script properties. Restart npm run dev, then sign in again.',
      BACKEND_AUTH_FAILED: 'The database rejected the signing credentials. Make APPS_SCRIPT_SECRET in .dev.vars match the Apps Script property, restart npm run dev, then sign in again.',
      NOT_FOUND: 'The Apps Script deployment does not support the current admin API. Update Code.gs from setup-database.gs, run setupDatabase(), and publish a new version of the web-app deployment.'
    };
    console.error('Admin backend check failed:', error.code || 'BACKEND_UNAVAILABLE');
    return new Response(local && diagnostics[error.code] ? diagnostics[error.code] : 'Administrator access could not be verified. Please retry shortly.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}
