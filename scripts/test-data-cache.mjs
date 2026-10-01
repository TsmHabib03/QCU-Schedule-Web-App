import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../assets/js/data-cache.js', import.meta.url), 'utf8');
const snapshot = (key = 'student-A:session-1', title = 'Saved class') => ({ status: 'OK', authenticated: true, routing: 'dashboard', cacheKey: key, entries: [{ title }], tasks: [], notes: [] });
const storage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
};
function fixture({ session = storage(), path = '/schedule.html', channels = [] } = {}) {
  const events = new EventTarget(), requests = [], replies = [], timers = [];
  let now = 1_000_000;
  class FakeDate extends Date { static now() { return now; } }
  class Channel {
    constructor() { channels.push(this); }
    postMessage(data) { for (const channel of channels) if (channel !== this) channel.onmessage?.({ data }); }
  }
  const context = vm.createContext({
    window: events, sessionStorage: session, localStorage: storage(), BroadcastChannel: Channel,
    location: { pathname: path, search: '' }, URLSearchParams, AbortSignal,
    Date: FakeDate, CustomEvent, setTimeout: fn => timers.push(fn), console,
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.equal(options.cache, 'no-store');
      const reply = replies.shift();
      assert(reply, `Unexpected request ${url}`);
      const value = await reply;
      if (value instanceof Error) throw value;
      return new Response(JSON.stringify(value.body || value), { status: value.http || 200 });
    }
  });
  vm.runInContext(source, context);
  return { api: events.QCUData, events, requests, replies, session, timers, advance(ms) { now += ms; } };
}
const f = fixture();
f.replies.push(snapshot());
const first = f.api.dashboard(), duplicate = f.api.dashboard();
assert.equal(first, duplicate, 'startup components share the same request');
assert.equal((await first).entries[0].title, 'Saved class');
assert.equal(f.requests.length, 1);
f.replies.push({ status: 'OK', routing: 'dashboard', cacheKey: snapshot().cacheKey });
const warm = await f.api.dashboard();
assert.equal(warm.cacheInfo.cached, true);
assert.equal(f.requests.at(-1).url, '/api/v1/dashboard?check=1');
console.log('PASS first load uses one request; warm navigation verifies access and reuses data');

f.advance(61_000);
f.replies.push({ status: 'OK', routing: 'dashboard', cacheKey: snapshot().cacheKey });
assert.equal((await f.api.dashboard()).entries[0].title, 'Saved class');
const updated = new Promise(resolve => f.events.addEventListener('qcu-dashboard-updated', e => resolve(e.detail), { once: true }));
f.replies.push(snapshot(undefined, 'Fresh class'));
f.timers.shift()();
assert.equal((await updated).entries[0].title, 'Fresh class');
f.advance(61_000);
f.replies.push({ status: 'OK', routing: 'dashboard', cacheKey: snapshot().cacheKey });
await f.api.dashboard();
const failed = new Promise(resolve => f.events.addEventListener('qcu-dashboard-refresh-failed', resolve, { once: true }));
f.replies.push(new Error('Offline'));
f.timers.shift()(); await failed;
assert.match(f.session.getItem('qcu-dashboard-v1'), /Fresh class/);
console.log('PASS stale data refreshes after paint; failed refresh preserves the last good snapshot');

f.replies.push({ status: 'OK', routing: 'dashboard', cacheKey: 'student-B:session-2' }, snapshot('student-B:session-2', 'B only'));
assert.equal((await f.api.dashboard()).entries[0].title, 'B only');
f.replies.push({ http: 403, body: { status: 'FORBIDDEN' } });
assert.equal((await f.api.dashboard()).status, 'FORBIDDEN');
assert.equal(f.session.getItem('qcu-dashboard-v1'), null);
console.log('PASS account switch never returns the old snapshot; denied access clears private cache');

let release;
f.replies.push(new Promise(resolve => { release = resolve; }));
const late = f.api.dashboard();
f.api.invalidate();
release(snapshot());
await assert.rejects(late, /Data changed/);
assert.equal(f.session.getItem('qcu-dashboard-v1'), null);
f.replies.push(snapshot()); await f.api.dashboard();
f.replies.push({ status: 'OK' });
await f.api.mutate('/api/v1/tasks', { method: 'POST', cache: 'no-store' });
assert.equal(f.session.getItem('qcu-dashboard-v1'), null);
console.log('PASS writes invalidate snapshots; old in-flight reads cannot restore stale data');

const channels = [], a = fixture({ channels }), b = fixture({ channels });
b.replies.push(snapshot()); await b.api.dashboard();
let reason;
b.events.addEventListener('qcu-data-invalidated', e => { reason = e.detail.reason; });
a.api.invalidate('logout');
assert.equal(reason, 'logout');
assert.equal(b.session.getItem('qcu-dashboard-v1'), null);
const blocked = fixture({ session: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() {} } });
blocked.replies.push(snapshot());
assert.equal((await blocked.api.dashboard()).status, 'OK');
console.log('PASS logout clears other tabs; disabled browser storage falls back to live loading');
