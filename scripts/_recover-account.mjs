// Recover the blocked (tombstoned) account via the signed admin API.
// The Apps Script authorizes the admin identity by the shared signing secret
// plus the pinned admin email — same trust path the admin console uses.
import { loadEnv } from './_sheets-client.mjs';
import { callAction } from '../functions/api/repo/sheets-adapter.js';
import { randomUUID } from 'node:crypto';

const env = await loadEnv();
const admin = { googleSub: 'recovery-console', email: 'myscheduleqcu@gmail.com', emailVerified: true, issuedAt: Date.now() };
const target = 'user_109931339653384325631';

try {
  const read = await callAction(env, 'admin.user.read', admin, { userId: target });
  console.log('current state:', JSON.stringify(read.user));
} catch (e) {
  console.log('read failed:', e.code, e.message);
  process.exit(1);
}

try {
  const result = await callAction(env, 'admin.user.update', admin, {
    userId: target,
    version: 0,
    operation: 'purge_full',
    confirm: target,
    reason: 'Administrator recovery: unblock identity for re-registration',
    mutationId: randomUUID(),
  });
  console.log('recovery result:', JSON.stringify(result));
} catch (e) {
  console.log('recovery failed:', e.code, e.message);
  process.exit(1);
}

// Verify: the identity should now be free (isNew) and login-ready.
const sub = target.replace('user_', '');
const actor = { googleSub: sub, email: 'probe@example.test', emailVerified: true, issuedAt: Date.now() };
const snap = await callAction(env, 'snapshot.read', actor, { kinds: ['users'] });
console.log('post-recovery:', sub, '=> isNew:', snap.isNew, 'rows:', snap.entities.users.length,
  snap.entities.users.length ? JSON.stringify(snap.entities.users.map(r => ({ status: r.accountStatus, purged: r.purgedAt }))) : '(no rows — identity free to register)');
