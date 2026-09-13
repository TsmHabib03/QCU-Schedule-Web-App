import { readPlatformSession, json } from './auth/_lib.js';
import { callAction, isConfigured } from './repo/sheets-adapter.js';

export async function onRequest(context) {
  const started = Date.now();
  const path = new URL(context.request.url).pathname;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.request.method) &&
      context.request.headers.get('Origin') !== new URL(context.request.url).origin) {
    return json({ error: 'Same-origin request required.' }, 403);
  }
  // Integration cookies cannot retain access after a platform account is closed.
  if (path.startsWith('/api/google/') && !path.endsWith('/disconnect')) {
    try {
      const session = await readPlatformSession(context);
      if (!session || !isConfigured(context.env)) return json({ error: 'Sign in first.' }, 401);
      const result = await callAction(context.env, 'auth.read', session);
      if (result.isNew) return json({ error: 'Sign in first.' }, 401);
    } catch (error) {
      return json({ error: 'Account access could not be verified.' }, ['FORBIDDEN','UNAUTHENTICATED'].includes(error.code) ? 403 : 503);
    }
  }
  let response;
  try { response = await context.next(); }
  catch (error) {
    console.error('API request failed', path, error.code || error.name);
    response = json({ status:'SERVICE_UNAVAILABLE', error:'The service is temporarily unavailable. Please retry.' }, 503);
  }
  if (response.status === 404 && !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('Content-Type') || '')) {
    response = json({ status:'NOT_FOUND', error:'API endpoint not found.' }, 404);
  }
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  secured.headers.append('Server-Timing', `api;dur=${Date.now()-started}`);
  if (context.data?.databaseMs !== undefined) secured.headers.append('Server-Timing', `database;dur=${context.data.databaseMs}`);
  return secured;
}
