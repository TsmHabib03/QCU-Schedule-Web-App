// Exercise the production Apps Script handlers with durable shared storage mocks.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../setup-database.gs', import.meta.url),'utf8');
const rows = new Map();
const files = new Map();
let now = Date.now(), serial = 0, failFile = false, locked = false;
const actor = {userId:'student',googleSub:'sub'};
const user = {userId:'student',googleSub:'sub',onboardingState:'ACTIVE'};
function runtime() {
  const ctx = vm.createContext({ console, Date:class extends Date { static now() { return now; } },
    LockService:{getScriptLock:() => ({tryLock:() => {assert(!locked); locked=true; return true;},releaseLock:() => {locked=false;}})},
    Utilities:{getUuid:() => String(++serial),base64Decode:s => [...Buffer.from(s,'base64')],base64Encode:b => Buffer.from(b).toString('base64'),newBlob:b => b},
    DriveApp:{Access:{PRIVATE:1},Permission:{NONE:1},createFile:b => {if(failFile) throw Error('Drive interrupted'); const id='f'+(++serial); files.set(id,b); return {setSharing(){},getId:()=>id};},getFileById:id => ({getBlob:()=>({getBytes:()=>files.get(id)})})},
  });
  vm.runInContext(source,ctx);
  Object.assign(ctx, {
    resolveActor:() => {},
    readOwned:() => structuredClone([...rows.values()]),
    readRows:() => [structuredClone(user)],
    applyOps:ops => { assert(locked); for(const op of ops) {if(op.kind==='corRecords') rows.set(op.id,structuredClone(op.row));} },
  });
  return ctx;
}
const a=runtime(), b=runtime();
const payload = id => ({requestId:'request_identifier_'+id,contentHash:'hash'+id,base64:Buffer.from('%PDF-1.4').toString('base64'),filename:'cor.pdf',mimeType:'application/pdf'});
const call = (ctx,action,p) => ctx.handleCorJob(actor,p,action);
const first=call(a,'start',payload(1));
assert.equal(call(b,'start',payload(1)).corRecordId,first.corRecordId);
assert.equal(call(b,'start',payload(2)).corRecordId,first.corRecordId);
assert.equal(rows.size,1);
assert(JSON.parse(rows.get(first.corRecordId).extraJson).requestIds.includes(payload(2).requestId));
assert.equal(user.onboardingState,'ACTIVE');
const claim=call(a,'claim',{corRecordId:first.corRecordId});
assert(claim.leaseToken);
assert(!call(b,'claim',{corRecordId:first.corRecordId}).leaseToken);
now+=180001;
const renewed=call(b,'claim',{corRecordId:first.corRecordId});
assert.notEqual(renewed.leaseToken,claim.leaseToken);
assert.throws(()=>call(a,'finish',{corRecordId:first.corRecordId,leaseToken:claim.leaseToken,draft:{subjects:[]}}),e=>e.apiCode==='CONFLICT');
call(b,'finish',{corRecordId:first.corRecordId,leaseToken:renewed.leaseToken,draft:{subjects:[]}});
assert.equal(call(a,'claim',{corRecordId:first.corRecordId}).importStatus,'REVIEW_REQUIRED');
assert(!call(a,'claim',{corRecordId:first.corRecordId}).leaseToken);
console.log('PASS shared admission, duplicate tabs, single extraction lease, expired lease, stale worker rejection, free result reopening');

rows.clear(); now+=600001; failFile=true;
assert.throws(()=>call(a,'start',payload(3)),/Drive interrupted/);
assert.equal(rows.size,1);
failFile=false;
const resumed=call(b,'start',payload(3));
assert.equal(rows.size,1);
assert(call(a,'claim',{corRecordId:resumed.corRecordId}).leaseToken);
console.log('PASS interrupted file save reserves request and resumes without duplicate admission');

rows.clear(); now+=600001;
for(let i=10;i<15;i++) {
  const job=call(a,'start',payload(i));
  const lease=call(a,'claim',{corRecordId:job.corRecordId});
  call(a,'finish',{corRecordId:job.corRecordId,leaseToken:lease.leaseToken});
}
assert.throws(()=>call(b,'start',payload(15)),e=>e.apiCode==='RATE_LIMITED' && e.apiFields.retryAfter>0);
now+=600001;
assert(call(b,'start',payload(15)).corRecordId);
// Direct extraction calls cannot bypass the shared window after lease expiry.
const row=[...rows.values()].at(-1);
const extra=JSON.parse(row.extraJson);
extra.extractionAttempts=Array(5).fill(now-100);
row.extraJson=JSON.stringify(extra);
assert.throws(()=>call(a,'claim',{corRecordId:row.corRecordId}),e=>e.apiCode==='RATE_LIMITED');
console.log('PASS five attempts per ten minutes, Retry-After, window reset, direct extraction rate limit');

// Run the real confirmation batch handler twice against the same saved record.
Object.assign(a,{assertOwnership(){},protectUserFields(){},applyAtomicOps(ops){ assert(locked); for(const op of ops) if(op.kind==='corRecords') rows.set(op.id,structuredClone(op.row)); return {applied:ops.length}; }});
row.status='REVIEW_REQUIRED';
rows.set(row.corRecordId,row);
const ops=[{kind:'corRecords',id:row.corRecordId,row:{...row,status:'COMPLETE'}}];
assert.equal(a.handleBatchWrite(actor,{ops}).applied,1);
assert.throws(()=>a.handleBatchWrite(actor,{ops}),e=>e.apiCode==='ALREADY_COMPLETE');
console.log('PASS duplicate confirmation rejected under shared lock');
