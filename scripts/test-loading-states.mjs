import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {onRequest as apiMiddleware} from '../functions/api/_middleware.js';
const source=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
// Run the actual read/cache functions with a small DOM and controlled transport.
const section=source.slice(source.indexOf('let _tasksCache = null;'),source.indexOf('async function loadTasks()'));
function node() { return {children:[],innerHTML:'saved content',hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);},querySelector(){return null;}}; }
const nodes=new Map([['task-list',node()]]), timers=new Map();
let timer=0, response, pending, fetchOptions;
const ctx=vm.createContext({console,Map,performance,AbortSignal,navigator:{onLine:true},location:{},
  window:{addEventListener(){}},
  setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),
  document:{getElementById:id=>nodes.get(id),createElement:node,querySelector:()=>({prepend:n=>nodes.set(n.id,n)})},renderTasks(){},
  fetch:async(url,options)=>{fetchOptions=options; if(pending) await pending; if(response instanceof Error) throw response; return response;},
});
vm.runInContext(readFileSync(new URL('../assets/js/loading.js',import.meta.url),'utf8'),ctx);
vm.runInContext(section,ctx);
response=new Response(JSON.stringify({data:[{taskId:'one',title:'Keep me'}]}),{status:200});
await ctx.fetchTasksFromApi();
assert(fetchOptions.signal instanceof AbortSignal);
assert.equal(timers.size,0);
const content=nodes.get('task-list').innerHTML='visible task';
response=new Response('Unavailable',{status:503});
const cached=await ctx.fetchTasksFromApi();
assert.equal(cached[0].title,'Keep me');
assert.equal(nodes.get('task-list').innerHTML,content);
assert.match(nodes.get('load-notice-tasks').children[0].textContent,/Refresh failed/);
assert.equal(nodes.get('load-notice-tasks').children[1].textContent,'Try again');
assert.equal(timers.size,0);
response=new Response('{}',{status:401});
await ctx.fetchTasksFromApi();
nodes.get('load-notice-tasks').children[1].onclick();
assert.equal(nodes.get('load-notice-tasks').children[1].textContent,'Sign in again');
assert.equal(ctx.location.href,'/api/auth/google/start?returnTo=%2F');
ctx.navigator.onLine=false;
response=new Error('Network interrupted');
await ctx.fetchTasksFromApi();
assert.match(nodes.get('load-notice-tasks').children[0].textContent,/offline/);
ctx.navigator.onLine=true;
let release;
pending=new Promise(resolve=>{release=resolve;});
response=new Response(JSON.stringify({data:[]}),{status:200});
const read=ctx.fetchTasksFromApi();
for(const fn of timers.values()) fn();
assert.match(nodes.get('load-notice-tasks').children[0].textContent,/longer than usual/);
release(); await read; pending=null;
assert.equal(nodes.get('load-notice-tasks').hidden,true);
assert.equal(timers.size,0);
assert.equal(vm.runInContext('_tasksCache.length',ctx),0);
console.log('PASS loaded content survives refresh failure, session recovery, offline feedback, slow state, successful empty result, timer cleanup');

for(const status of [404,503]) {
  const response=await apiMiddleware({request:new Request('https://portal.test/api/missing'),env:{},data:{databaseMs:4},next:async()=>new Response('Missing',{status})});
  assert.equal(response.status,status);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(response.headers.get('Server-Timing'),/api;dur=.*database;dur=4/);
  if(status===404) assert.equal((await response.json()).status,'NOT_FOUND');
}
console.log('PASS missing API JSON, service status preservation, cache control and server timing');
