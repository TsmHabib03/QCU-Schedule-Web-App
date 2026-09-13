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
assert.equal(change('purge', { confirm: 'student' }).error.code, 'FILE_CLEANUP_FAILED');
assert.equal(detail().user.accountStatus, 'CLOSED');
assert.equal(detail().dependencies.Notes, 1);
assert.equal(detail().dependencies.COR_Records, 1);
assert.equal(call('auth.read', {}, { googleSub: 'student-sub', issuedAt: Date.now() + 1 }).error.code, 'FORBIDDEN');
driveFiles.get('cor-file').failTrash = false;
assert.equal(change('purge', { confirm: 'student' }).ok, true);
assert.equal(detail().user.accountStatus, 'DELETED');
assert.equal(detail().protected, true);
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

const versionColumn = users._rows[0].indexOf('sessionsRevokedAt');
for (const row of users._rows) row.splice(versionColumn, 1);
assert.equal(call('admin.users.list').error.code, 'SCHEMA_OUTDATED');
assert.equal(parseOutput(gs.doGet({ parameter: { action: 'health' } })).data.status, 'incomplete');
gs.setupDatabase();
assert.equal(call('admin.users.list').ok, true);
assert.equal(parseOutput(gs.doGet({ parameter: { action: 'health' } })).data.status, 'healthy');
console.log('PASS missing schema fails with setup instructions and is repaired without deleting records');
