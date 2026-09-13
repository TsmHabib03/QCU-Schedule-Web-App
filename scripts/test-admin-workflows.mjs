import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadAppsScript, parseOutput } from './_apps-script-emulator.mjs';

const secret = 'admin-workflow-fixture-secret';
const admin = { googleSub: 'admin-sub', email: 'myscheduleqcu@gmail.com', emailVerified: true, issuedAt: Date.now() };
const driveFiles = new Map([['legacy-file', {}], ['cor-file', { failTrash: true }], ['other-file', {}]]);
const gs = await loadAppsScript({ repoRoot: resolve('.'), secret, properties: { SPREADSHEET_ID: 'test-spreadsheet' }, standalone: true, driveFiles });
const users = gs.spreadsheet.insertSheet('Users');
users.appendRow(['userId','googleSub','email','displayName','accountStatus','version','createdAt']);
users.appendRow(['admin', admin.googleSub, admin.email, 'Administrator', 'ACTIVE', 1, '2026-09-12T18:00:00Z']);
users.appendRow(['student', 'student-sub', 'student@example.test', 'Zoë Niño & 李', 'ACTIVE', 1, '2026-09-12T18:00:00Z']);
// A migrated audit sheet may have a different order than the current definition.
gs.spreadsheet.insertSheet('Audit_Log').appendRow(['auditEventId','targetId','action','requestId','result','occurredAt','actorUserId']);
gs.setupDatabase();
gs.setupDatabase();
assert.equal(users._rows[1][2], admin.email);
assert.equal(users._rows[2][3], 'Zoë Niño & 李');
assert.equal(users._rows.length, 3);
assert.equal(new Set(users._rows[0]).size, users._rows[0].length);
assert(gs.spreadsheet.getSheetByName('COR_Records').getMaxColumns() > 26);

function call(action, payload = {}, actor = admin) {
  const canonical = JSON.stringify({ action, payload, actor, nonce: randomUUID(), timestamp: new Date().toISOString() });
  return parseOutput(gs.doPost({ postData: { contents: JSON.stringify({ canonical, signature: createHmac('sha256', secret).update(canonical).digest('hex') }) } }));
}
function detail(id = 'student') {
  const result = call('admin.user.read', { userId: id });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
function change(operation, options = {}) {
  return call('admin.user.update', { userId: 'student', version: detail().user.version, operation, reason: 'Workflow verification', mutationId: randomUUID(), ...options });
}
function append(name, row) {
  const sheet = gs.spreadsheet.getSheetByName(name);
  sheet.appendRow(sheet._rows[0].map(key => row[key] ?? ''));
}

assert.equal(detail().user.displayName, 'Zoë Niño & 李');
assert.equal(call('admin.users.list', { from: '2026-09-13', to: '2026-09-13' }).data.total, 2);
assert.equal(call('admin.users.list', { from: '2026-02-30' }).error.code, 'VALIDATION_FAILED');
assert.equal(call('admin.users.list', { q: ' Niño ' }).data.total, 1);
const before = detail().user.version;
const receipt = randomUUID();
assert.equal(change('suspend', { mutationId: receipt }).ok, true);
assert.equal(detail().user.accountStatus, 'SUSPENDED');
assert.equal(change('suspend', { version: before, mutationId: receipt }).data.replayed, true);
assert.equal(detail().user.version, before + 1);
assert.equal(change('suspend', { mutationId: receipt, reason: 'Different intent' }).error.code, 'CONFLICT');
assert.equal(change('reactivate').ok, true);
assert.equal(detail().user.suspendedReason, null);
const audit = call('admin.users.list').data.audit;
assert(audit.some(event => event.action === 'admin.suspend' && event.targetId === 'student' && event.result === 'SUCCESS'));
console.log('PASS existing-sheet migration, grid expansion, reordered audit columns, Unicode, Manila date filters, suspension, reactivation, and replay');

append('Notes', { noteId: 'own-note', ownerUserId: 'student', body: 'Private student content' });
append('Notes', { noteId: 'other-note', ownerUserId: 'other', body: 'Must survive deletion' });
append('Document_Assets', { documentId: 'legacy-doc', ownerUserId: 'student', driveFileId: 'legacy-file' });
append('Document_Assets', { documentId: 'other-doc', ownerUserId: 'other', driveFileId: 'other-file' });
append('COR_Records', { corRecordId: 'new-cor', ownerUserId: 'student', extraJson: JSON.stringify({ driveFileId: 'cor-file' }) });
assert.equal(change('purge', { confirm: 'wrong' }).error.code, 'VALIDATION_FAILED');
assert.equal(detail().user.accountStatus, 'ACTIVE');
const purgeRetry = { confirm: 'student', version: detail().user.version, mutationId: randomUUID() };
assert.equal(change('purge', purgeRetry).error.code, 'FILE_CLEANUP_FAILED');
assert.equal(detail().user.accountStatus, 'CLOSED');
assert.equal(detail().dependencies.Notes, 1);
assert.equal(detail().dependencies.COR_Records, 1);
assert.equal(call('auth.read', {}, { googleSub: 'student-sub', issuedAt: Date.now() + 1 }).error.code, 'FORBIDDEN');
driveFiles.get('cor-file').failTrash = false;
assert.equal(change('purge', purgeRetry).ok, true, 'Resume the exact deletion request after cleanup changed the account version');
assert.equal(change('purge', purgeRetry).data.replayed, true);
assert.equal(detail().user.accountStatus, 'DELETED');
assert.equal(detail().protected, false); // DELETED accounts are actionable so a blocked identity can be recovered with purge_full.
assert.equal(detail().dependencies.Notes, 0);
assert.equal(detail().dependencies.COR_Records, 0);
assert.equal(detail().user.email, null);
assert.equal(driveFiles.get('legacy-file').trashed, true);
assert.equal(driveFiles.get('cor-file').trashed, true);
assert.equal(driveFiles.get('other-file').trashed, undefined);
assert(gs.spreadsheet.getSheetByName('Notes')._rows.some(row => row.includes('other-note')));
assert.equal(call('admin.users.list').data.total, 1);
assert.equal(call('admin.users.list', { status: 'DELETED' }).data.users[0].userId, 'student');
assert.equal(change('reactivate').error.code, 'VALIDATION_FAILED');
console.log('PASS direct deletion, Drive failure recovery, new and legacy COR file cleanup, ownership isolation, and retained blocked identities');

// Full deletion removes the Users row entirely; the identity can register again.
const student2 = gs.spreadsheet.getSheetByName('Users');
student2.appendRow(Array.from({ length: student2._rows[0].length }, (_, i) => i === student2._rows[0].indexOf('userId') ? 'student2' : i === student2._rows[0].indexOf('googleSub') ? 'student2-sub' : i === student2._rows[0].indexOf('accountStatus') ? 'ACTIVE' : i === student2._rows[0].indexOf('version') ? 1 : ''));
append('Notes', { noteId: 'student2-note', ownerUserId: 'student2', body: 'Gone for good' });
const version2 = call('admin.user.read', { userId: 'student2' }).data.user.version;
assert.equal(call('admin.user.update', { userId: 'student2', version: version2, operation: 'purge_full', confirm: 'student2', mutationId: randomUUID(), reason: 'duplicate account' }).ok, true);
assert.equal(call('admin.user.read', { userId: 'student2' }).error.code, 'NOT_FOUND');
assert(!gs.spreadsheet.getSheetByName('Users')._rows.some(row => row.includes('student2-sub')), 'Users row removed by purge_full');
assert(!gs.spreadsheet.getSheetByName('Notes')._rows.some(row => row.includes('student2-note')), 'owned records removed');
assert(gs.spreadsheet.getSheetByName('Notes')._rows.some(row => row.includes('Must survive deletion')), 'other records intact');
// The same identity can now authenticate as a brand-new user.
const fresh = call('auth.read', {}, { googleSub: 'student2-sub', email: 'student2@example.test', emailVerified: true, issuedAt: Date.now() + 1 });
assert.equal(fresh.data.isNew, true, 'identity is free to register again after purge_full');
assert.equal(call('admin.users.list', { status: 'DELETED' }).data.users.length, 1, 'purge_full leaves no DELETED tombstone');
console.log('PASS full deletion removes the user row and allows re-registration');

// Tombstone recovery: a blocked (purged) identity can be freed with purge_full.
const student3 = gs.spreadsheet.getSheetByName('Users');
student3.appendRow(Array.from({ length: student3._rows[0].length }, (_, i) => i === student3._rows[0].indexOf('userId') ? 'student3' : i === student3._rows[0].indexOf('googleSub') ? 'student3-sub' : i === student3._rows[0].indexOf('accountStatus') ? 'ACTIVE' : i === student3._rows[0].indexOf('version') ? 1 : ''));
append('Notes', { noteId: 'student3-note', ownerUserId: 'student3', body: 'Blocked then recovered' });
const version3 = call('admin.user.read', { userId: 'student3' }).data.user.version;
// 1) Block the account (purge keeps a tombstone).
assert.equal(call('admin.user.update', { userId: 'student3', version: version3, operation: 'purge', confirm: 'student3', mutationId: randomUUID(), reason: 'blocked for test' }).ok, true);
assert.equal(call('admin.user.read', { userId: 'student3' }).data.user.accountStatus, 'DELETED');
assert.equal(call('auth.read', {}, { googleSub: 'student3-sub', issuedAt: Date.now() + 1 }).error.code, 'FORBIDDEN');
// 2) The read is no longer protected, so the form can act on a DELETED account.
assert.equal(call('admin.user.read', { userId: 'student3' }).data.protected, false);
// 3) Recover with purge_full: the tombstone is removed and login works again.
assert.equal(call('admin.user.update', { userId: 'student3', version: 999, operation: 'purge_full', confirm: 'student3', mutationId: randomUUID(), reason: 'recovery for test' }).ok, true, 'purge_full on a tombstone ignores the stale version');
assert.equal(call('admin.user.read', { userId: 'student3' }).error.code, 'NOT_FOUND');
assert(!gs.spreadsheet.getSheetByName('Users')._rows.some(row => row.includes('student3-sub')), 'tombstone removed');
assert(!gs.spreadsheet.getSheetByName('Notes')._rows.some(row => row.includes('student3-note')), 'owned records removed by the original purge');
const recovered = call('auth.read', {}, { googleSub: 'student3-sub', email: 'student3@example.test', emailVerified: true, issuedAt: Date.now() + 1 });
assert.equal(recovered.data.isNew, true, 'blocked identity can register again after recovery');
console.log('PASS tombstone recovery frees a blocked identity for re-registration');

const versionColumn = users._rows[0].indexOf('sessionsRevokedAt');
for (const row of users._rows) row.splice(versionColumn, 1);
assert.equal(call('admin.users.list').error.code, 'SCHEMA_OUTDATED');
assert.equal(parseOutput(gs.doGet({ parameter: { action: 'health' } })).data.status, 'incomplete');
gs.setupDatabase();
assert.equal(call('admin.users.list').ok, true);
assert.equal(parseOutput(gs.doGet({ parameter: { action: 'health' } })).data.status, 'healthy');
console.log('PASS missing schema fails with setup instructions and is repaired without deleting records');
