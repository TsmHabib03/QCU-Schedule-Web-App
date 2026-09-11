import { onRequest as pageGuard } from '../functions/_middleware.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadAppsScript, parseOutput } from './_apps-script-emulator.mjs';
import { platformSessionHeader, readPlatformSession } from '../functions/api/auth/_lib.js';
import { onRequestGet, onRequestPost } from '../functions/api/admin/users.js';
import { onRequestGet as callback } from '../functions/api/auth/google/callback.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { callAction } from '../functions/api/repo/sheets-adapter.js';
const env = { GOOGLE_SESSION_SECRET:'admin-api-test-secret-not-production', APPS_SCRIPT_SECRET:'admin-api-signing-test-secret', APPS_SCRIPT_URL:'https://sheets.test/', ADMIN_GOOGLE_SUB:'test-admin' };
const admin = { googleSub:'test-admin', email:'myscheduleqcu@gmail.com', emailVerified:true, issuedAt:Date.now() };
const student = { googleSub:'test-student', email:'student@example.test', emailVerified:true, issuedAt:Date.now() };
const scriptProperties = { ADMIN_GOOGLE_SUB: admin.googleSub };
const gs = await loadAppsScript({repoRoot:resolve('.'),secret:env.APPS_SCRIPT_SECRET,properties:scriptProperties}); gs.setupDatabase();
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>new Response(JSON.stringify(parseOutput(gs.doPost({postData:{contents:init.body}}))),{headers:{'Content-Type':'application/json'}});
const origin='https://portal.test';
async function cookie(session) { return (await platformSessionHeader({env,request:new Request(origin)},session)).split(';')[0]; }
function context(cookieValue,method='GET',body,headers={}) {return {env,request:new Request(origin+'/api/admin/users',{method,headers:{Cookie:cookieValue,...headers},body:body && JSON.stringify(body)})};}
try {
 for (const actor of [admin,student]) await callAction(env,'batch.write',actor,{ops:[{kind:'users',id:'user_'+actor.googleSub,row:{displayName:'Fixture',email:actor.email}}]});
 const adminCookie=await cookie(admin), studentCookie=await cookie(student);
 assert.equal((await onRequestGet(context(studentCookie))).status,403);
 let response=await onRequestGet(context(adminCookie)); assert.equal(response.status,200);
 const data=await response.json(); const user=data.users.find(u=>u.email===student.email);
 const csrfCookie=response.headers.get('Set-Cookie').split(';')[0];
 const body={operation:'suspend',userId:user.userId,version:user.version,reason:'API test',mutationId:crypto.randomUUID()};
 assert.equal((await onRequestPost(context(adminCookie,'POST',body,{Origin:origin}))).status,403);
 assert.equal((await onRequestPost(context(adminCookie+'; '+csrfCookie,'POST',body,{Origin:'https://evil.test','X-CSRF-Token':data.csrfToken}))).status,403);
 response=await onRequestPost(context(adminCookie+'; '+csrfCookie,'POST',body,{Origin:origin,'X-CSRF-Token':data.csrfToken})); assert.equal(response.status,200);
 assert.equal((await middleware({env,request:new Request(origin+'/api/google/updates',{headers:{Cookie:studentCookie}}),next:()=>new Response('unexpected')})).status,403);
 assert.equal((await middleware({env,request:new Request(origin+'/api/v1/tasks',{method:'POST',headers:{Origin:'https://evil.test'}}),next:()=>new Response('unexpected')})).status,403);
 const large=await onRequestPost(context(adminCookie+'; '+csrfCookie,'POST',{...body,reason:'x'.repeat(5000)},{Origin:origin,'X-CSRF-Token':data.csrfToken})); assert.equal(large.status,400);
 const perfActor={googleSub:'perf-student',email:'perf@example.test',issuedAt:Date.now()};
 await callAction(env,'batch.write',perfActor,{ops:[{kind:'users',id:'user_perf-student',row:{email:perfActor.email}},{kind:'notes',id:'perf-note',row:{title:'Large private note',body:'x'.repeat(10000)}}]});
 const full=await callAction(env,'snapshot.read',perfActor);
 const light=await callAction(env,'auth.read',perfActor);
 const fullBytes=JSON.stringify(full).length,lightBytes=JSON.stringify(light).length;
 assert.ok(lightBytes < fullBytes / 10);
 console.log(`Synthetic session payload: ${fullBytes} bytes for full snapshot -> ${lightBytes} bytes for account-only read.`);
 // Exercise the actual OAuth callback with a previously signed-in different account.
 const oauthEnv={...env,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-client-secret'};
 const stateCookie=(await cookie({state:'test-state',createdAt:new Date().toISOString(),returnTo:'/'})).replace('qcu_platform_session=','qcu_oauth_state=');
 const priorCookie=await cookie({...student,profile:{studentNumber:'PRIVATE-OLD-USER'},corRecordId:'old-cor',enrollment:{private:'old'},enrollmentSubjects:[{private:'old'}]});
 globalThis.fetch=async(url,init)=> String(url) === env.APPS_SCRIPT_URL ? new Response(JSON.stringify(parseOutput(gs.doPost({postData:{contents:init.body}})))) : new Response(JSON.stringify(String(url).includes('userinfo') ? {sub:'different-student',email:'other@example.test',email_verified:true,name:'Other'} : {access_token:'test-token',expires_in:3600}));
 response=await callback({env:oauthEnv,request:new Request(origin+'/api/auth/google/callback?state=test-state&code=test-code',{headers:{Cookie:stateCookie+'; '+priorCookie}})});
 assert.equal(response.status,302); assert.equal(response.headers.get('Location'),'/?auth=onboarding');
 const issued=response.headers.getSetCookie().find(v=>v.startsWith('qcu_platform_session=')); assert.ok(issued);
 const session=await readPlatformSession({env:oauthEnv,request:new Request(origin,{headers:{Cookie:issued.split(';')[0]}})});
 assert.equal(session.googleSub,'different-student'); assert.equal(session.profile,null); assert.equal(session.corRecordId,null); assert.equal(session.enrollment,null); assert.equal(session.enrollmentSubjects,null);
 // Admin intent must not turn an ordinary Google login into an admin-page redirect.
 const adminState=(await cookie({state:'admin-state',createdAt:new Date().toISOString(),returnTo:'/admin.html'})).replace('qcu_platform_session=','qcu_oauth_state=');
 response=await callback({env:oauthEnv,request:new Request(origin+'/api/auth/google/callback?state=admin-state&code=test-code',{headers:{Cookie:adminState+'; '+adminCookie}})});
 assert.equal(response.headers.get('Location'),'/?auth=admin_denied');
 assert.ok(response.headers.getSetCookie().some(v=>v.startsWith('qcu_platform_session=;') && v.includes('Max-Age=0')));
 assert.ok(!response.headers.getSetCookie().some(v=>v.startsWith('qcu_platform_session=') && !v.includes('Max-Age=0')));
 for (const path of ['/admin','/admin.html','/admin/']) {
   response=await pageGuard({env,request:new Request(origin+path,{headers:{Cookie:studentCookie}}),next:()=>new Response('PRIVATE ADMIN HTML')});
   assert.equal(response.status,302); assert.equal(response.headers.get('Location'),'/?auth=admin_denied');
   assert.ok(!(await response.text()).includes('PRIVATE ADMIN HTML'));
 }
 response=await pageGuard({env,request:new Request(origin+'/admin.html',{headers:{Cookie:adminCookie}}),next:()=>new Response('PRIVATE ADMIN HTML')});
 assert.equal(response.status,200); assert.equal(response.headers.get('Cache-Control'),'no-store');
 // The authorized account succeeds without optional pins in either backend.
 delete scriptProperties.ADMIN_GOOGLE_SUB;
 delete oauthEnv.ADMIN_GOOGLE_SUB;
 globalThis.fetch=async(url,init)=> String(url) === env.APPS_SCRIPT_URL ? new Response(JSON.stringify(parseOutput(gs.doPost({postData:{contents:init.body}})))) : new Response(JSON.stringify(String(url).includes('userinfo') ? {sub:admin.googleSub,email:admin.email,email_verified:true,name:'Administrator'} : {access_token:'test-token',expires_in:3600}));
 response=await callback({env:oauthEnv,request:new Request(origin+'/api/auth/google/callback?state=admin-state&code=test-code',{headers:{Cookie:adminState}})});
 assert.equal(response.headers.get('Location'),'/admin.html');
 response=await pageGuard({env:oauthEnv,request:new Request(origin+'/admin.html',{headers:{Cookie:adminCookie}}),next:()=>new Response('ADMIN')});
 assert.equal(response.status,200);
 const { readFile } = await import('node:fs/promises');
 for (const file of ['index.html','admin.html','assets/js/admin.js','functions/api/auth/google/start.js']) {
   assert.ok(!(await readFile(file,'utf8')).includes(admin.email), file + ' must not disclose the admin address');
 }
 const partialEnv = { ...oauthEnv, APPS_SCRIPT_SECRET: '' };
 response=await pageGuard({env:partialEnv,request:new Request('http://127.0.0.1:8788/admin.html',{headers:{Cookie:adminCookie}}),next:()=>new Response('UNEXPECTED')});
 assert.equal(response.status,503);
 const setupMessage=await response.text();
 assert.ok(setupMessage.includes('APPS_SCRIPT_SECRET'));
 assert.ok(!setupMessage.includes(admin.email));
 response=await callback({env:partialEnv,request:new Request(origin+'/api/auth/google/callback?state=admin-state&code=test-code',{headers:{Cookie:adminState}})});
 assert.equal(response.headers.get('Location'),'/?auth=backend_unavailable');
 assert.ok(!response.headers.getSetCookie().some(v=>v.startsWith('qcu_platform_session=')));
 console.log('Admin API checks passed: CSRF, origin, body limits, integration revocation, lightweight reads and OAuth account isolation.');
} finally {globalThis.fetch=realFetch;}
