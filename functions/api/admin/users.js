import { json, csrfHeader, generateCsrfToken } from '../auth/_lib.js';
import { adminCall, mutationBody, failure } from './_lib.js';

export async function onRequestGet(context) {
  try {
    const params = Object.fromEntries(new URL(context.request.url).searchParams);
    const result = await adminCall(context, params.userId ? 'admin.user.read' : 'admin.users.list', params);
    const csrfToken = generateCsrfToken();
    return json({ ...result, csrfToken }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': await csrfHeader(context, csrfToken) });
  } catch (error) { return failure(error); }
}
export async function onRequestPost(context) {
  try {
    const body = await mutationBody(context);
    return json(await adminCall(context, 'admin.user.update', body), 200, { 'Cache-Control': 'no-store' });
  } catch (error) { return failure(error); }
}
