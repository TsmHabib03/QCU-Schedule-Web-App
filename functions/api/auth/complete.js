// Resume only a Google-verified identity from the short-lived, encrypted cookie.
// No access to the portal is issued until the database confirms the login.
import { readPendingLogin, clearPendingLogin, json } from './_lib.js';
import { finishLogin } from './_login.js';

export async function onRequestPost(context) {
  if (context.request.headers.get('Origin') !== new URL(context.request.url).origin) return json({ status: 'FORBIDDEN', error: 'Open sign-in from this website.' }, 403);
  const identity = await readPendingLogin(context);
  if (!identity) return json({ status: 'UNAUTHENTICATED', error: 'Please sign in with Google to continue.' }, 401);
  try {
    const { cookie, destination } = await finishLogin(context, identity);
    const response = json({ status: 'OK', destination });
    response.headers.append('Set-Cookie', cookie);
    response.headers.append('Set-Cookie', clearPendingLogin(context));
    return response;
  } catch (error) {
    const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'UNAUTHENTICATED' ? 401 : 503;
    return json({ status: status === 503 ? 'SERVICE_UNAVAILABLE' : status === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED',
      error: status === 503 ? 'Google sign-in is verified. We could not finish connecting your account yet. Try again.' : status === 403 ? 'Your account cannot access the portal. Contact your administrator.' : 'Please sign in again to continue.' }, status);
  }
}
