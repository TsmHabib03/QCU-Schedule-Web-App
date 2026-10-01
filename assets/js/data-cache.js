/* Recent dashboard snapshots are private to this tab and verified session.
 * HTTP/API responses remain no-store; only successful, validated data is saved.
 */
(() => {
  'use strict';
  const STORAGE = 'qcu-dashboard-v1';
  const SIGNAL = 'qcu-data-change-v1';
  const FRESH_MS = 60_000;
  const MAX_AGE_MS = 5 * 60_000;
  let epoch = 0, inflight = null, refresh = null;
  let channel;
  try { channel = new BroadcastChannel(SIGNAL); } catch {}
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  function stored() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STORAGE));
      const age = Date.now() - value?.at;
      if (value?.data?.cacheKey && Array.isArray(value.data.entries) && age >= 0 && age < MAX_AGE_MS) return value;
      sessionStorage.removeItem(STORAGE);
    } catch {}
    return null;
  }
  function discard() {
    epoch++;
    inflight = null;
    refresh = null;
    try { sessionStorage.removeItem(STORAGE); } catch {}
  }
  function invalidate(reason = 'change', broadcast = true) {
    discard();
    if (broadcast) {
      const message = { reason, id: Date.now() + ':' + Math.random() };
      if (channel) channel.postMessage(message);
      else try { localStorage.setItem(SIGNAL, JSON.stringify(message)); } catch {}
    }
  }
  function receive(message) {
    if (!message?.reason) return;
    discard();
    emit('qcu-data-invalidated', message);
  }
  if (channel) channel.onmessage = event => receive(event.data);
  window.addEventListener('storage', event => {
    if (event.key === SIGNAL && event.newValue) {
      try { receive(JSON.parse(event.newValue)); } catch {}
    }
  });
  function assertCurrent(version) {
    if (version !== epoch) throw Object.assign(new Error('Data changed while loading. Please retry.'), { code: 'SUPERSEDED' });
  }
  async function read(check, version) {
    const response = await fetch('/api/v1/dashboard' + (check ? '?check=1' : ''), {
      credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(35000)
    });
    const data = await response.json();
    assertCurrent(version);
    if ([401, 403, 409].includes(response.status) || ['UNAUTHENTICATED', 'DEACTIVATED', 'FORBIDDEN', 'INCOMPLETE', 'ONBOARDING_REQUIRED'].includes(data.status) || data.routing === 'admin') {
      invalidate('access');
      return data;
    }
    if (!response.ok || data.status !== 'OK') {
      throw Object.assign(new Error(data.error || 'The service is unavailable. Please try again.'), { status: response.status });
    }
    return data;
  }
  function save(data, version) {
    assertCurrent(version);
    if (data.status !== 'OK' || !data.cacheKey || !Array.isArray(data.entries)) return data;
    const at = Date.now();
    try { sessionStorage.setItem(STORAGE, JSON.stringify({ at, data })); } catch {}
    return { ...data, cacheInfo: { at, cached: false } };
  }
  function refreshInBackground(version) {
    if (refresh) return;
    const work = read(false, version).then(data => {
      // Routing responses clear the cache and change epoch themselves.
      if (!Array.isArray(data.entries)) { emit('qcu-dashboard-updated', data); return; }
      emit('qcu-dashboard-updated', save(data, version));
    }).catch(error => {
      if (error.code !== 'SUPERSEDED') emit('qcu-dashboard-refresh-failed', { message: error.message });
    }).finally(() => { if (refresh === work) refresh = null; });
    refresh = work;
  }
  function dashboard({ force = false } = {}) {
    if (inflight) return inflight;
    const version = epoch;
    const work = (async () => {
      const cached = force ? null : stored();
      if (cached) {
        const verified = await read(true, version);
        if (verified.status !== 'OK' || verified.routing !== 'dashboard') return verified;
        if (verified.cacheKey === cached.data.cacheKey) {
          assertCurrent(version);
          if (Date.now() - cached.at >= FRESH_MS) setTimeout(() => {
            if (version === epoch) refreshInBackground(version);
          }, 0);
          return { ...cached.data, cacheInfo: { at: cached.at, cached: true } };
        }
        // The server confirmed a different session or schedule. Never paint
        // the previous account's data, even if the full request then fails.
        try { sessionStorage.removeItem(STORAGE); } catch {}
      }
      const data = await read(false, version);
      return Array.isArray(data.entries) ? save(data, version) : data;
    })();
    inflight = work;
    work.finally(() => { if (inflight === work) inflight = null; }).catch(() => {});
    return work;
  }
  async function mutate(url, options) {
    invalidate('change');
    try {
      const response = await fetch(url, options);
      if ([401, 403].includes(response.status)) {
        invalidate('access');
        emit('qcu-data-invalidated', { reason: 'access' });
      }
      return response;
    }
    finally { invalidate('change'); }
  }
  window.QCUData = { dashboard, invalidate, mutate, get epoch() { return epoch; } };
  // Share the early home request between the auth gate and app.js.
  // Sign-in completion must finish setting cookies before any data request.
  const path = location.pathname;
  if (['/', '/index', '/index.html'].includes(path) && new URLSearchParams(location.search).has('auth')) invalidate('access');
  if (['/', '/index', '/index.html'].includes(path) && !new URLSearchParams(location.search).has('auth')) {
    window.QCUStartup = dashboard();
    window.QCUStartup.catch(() => {});
  }
})();
