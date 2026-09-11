import { readPlatformSession, json } from './auth/_lib.js';
import { callAction, isConfigured } from './repo/sheets-adapter.js';

export async function onRequest(context) {
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
  const response = await context.next();
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  return secured;
}
