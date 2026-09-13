import { adminCall } from './api/admin/_lib.js';
import { pageErrorResponse } from './_errors.js';

// Protect the HTML route as well as its API. Pages may normalize .html URLs.
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.replace(/\/$/, '');
  if (!['/admin', '/admin.html'].includes(path)) {
    try { return await context.next(); }
    catch (error) {
      console.error('Page request failed:', error.code || error.name);
      if (path.startsWith('/api/')) return Response.json({ status: 'SERVICE_UNAVAILABLE', error: 'The service is temporarily unavailable. Please retry.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      // Never return an HTML document as a missing/failed script or stylesheet.
      if (path.startsWith('/assets/')) return new Response('Resource temporarily unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
      return pageErrorResponse();
    }
  }
  try {
    await adminCall(context, 'admin.access');
    const response = await context.next();
    const protectedResponse = new Response(response.body, response);
    protectedResponse.headers.set('Cache-Control', 'no-store');
    return protectedResponse;
  } catch (error) {
    if (['FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code)) {
      return new Response(null, { status: 302, headers: { Location: error.code === 'UNAUTHENTICATED' ? '/?auth=admin_expired' : '/?auth=admin_denied', 'Cache-Control': 'no-store' } });
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(context.request.url).hostname);
    const diagnostics = {
      BACKEND_NOT_CONFIGURED: 'Database setup is incomplete. Set APPS_SCRIPT_URL and APPS_SCRIPT_SECRET in .dev.vars. The secret must match APPS_SCRIPT_SECRET in Apps Script Project Settings > Script properties. Restart npm run dev, then sign in again.',
      BACKEND_AUTH_FAILED: 'The database rejected the signing credentials. Make APPS_SCRIPT_SECRET in .dev.vars match the Apps Script property, restart npm run dev, then sign in again.',
      NOT_FOUND: 'The Apps Script deployment does not support the current admin API. Update Code.gs from setup-database.gs, run setupDatabase(), and publish a new version of the web-app deployment.',
      SCHEMA_OUTDATED: 'The spreadsheet is missing required admin columns. Run setupDatabase() using the updated Code.gs, then publish a new web-app version.'
    };
    console.error('Admin backend check failed:', error.code || 'BACKEND_UNAVAILABLE');
    return pageErrorResponse(503, local && diagnostics[error.code] ? diagnostics[error.code] : 'Administrator access could not be verified. Please try again shortly.');
  }
}
