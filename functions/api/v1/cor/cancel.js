// Replacing a reviewed COR closes only its unconfirmed draft. The Apps Script
// batch handler checks REVIEW_REQUIRED again under the confirmation lock.
import { resolveUser, flushRepo, json } from '../../auth/_lib.js';
import { CorRecords } from '../../repo/index.js';
import { jobError } from './_jobs.js';

export async function onRequestPost(context) {
  try {
    const resolved = await resolveUser(context);
    if (!resolved) return json({ status: 'UNAUTHENTICATED' }, 401);
    const { user, session } = resolved;
    const body = await context.request.json().catch(() => ({}));
    const record = CorRecords.getById(body.corRecordId);
    if (!record || record.ownerUserId !== user.userId) return json({ status: 'NOT_FOUND', error: 'This COR import is no longer available.' }, 404);
    if (record.status === 'CANCELLED') return json({ status: 'CANCELLED', corRecordId: record.id });
    if (record.status !== 'REVIEW_REQUIRED') return json({ status: 'CONFLICT', error: 'This COR has changed. Check its saved status before replacing it.' }, 409);
    CorRecords.update(record, { status: 'CANCELLED' });
    await flushRepo(context, session);
    return json({ status: 'CANCELLED', corRecordId: record.id });
  } catch (error) { return jobError(error); }
}
