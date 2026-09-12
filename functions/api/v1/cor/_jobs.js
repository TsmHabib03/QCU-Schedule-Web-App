import { callAction, isConfigured } from '../../repo/sheets-adapter.js';
import { json } from '../../auth/_lib.js';

export { isConfigured };
export function jobCall(context, session, action, payload) {
  return callAction(context.env, 'cor.' + action, session, payload);
}
export function jobError(error) {
  const code = error.code || 'SERVICE_UNAVAILABLE';
  const status = { RATE_LIMITED:429, NOT_FOUND:404, FILE_MISSING:409, CONFLICT:409, VALIDATION_FAILED:400, UNAUTHENTICATED:401, FORBIDDEN:403 }[code] || 503;
  const retryAfter = Math.max(1, Number(error.fields?.retryAfter) || 10);
  const response = json({ status:code, error: status === 503 ? 'The service could not confirm the result. Check the saved import before retrying.' : error.message, ...(status === 429 ? {retryAfter} : {}) }, status);
  if (status === 429) response.headers.set('Retry-After', String(retryAfter));
  return response;
}
export function encodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
