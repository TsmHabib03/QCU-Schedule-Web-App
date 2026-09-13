function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

// Standalone response: still readable if the asset server is unavailable.
export function pageErrorResponse(status = 503, message = 'We could not load this page. Please try again in a moment. If you were uploading a COR, reopen the upload page to check your saved progress.') {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Page unavailable · QCU My-Schedule</title><link rel="stylesheet" href="/assets/css/styles.css?v=55"><link rel="stylesheet" href="/assets/css/recovery.css?v=1"></head>
<body><main class="recovery-page"><img src="/assets/images/cropped-logo.jpg" width="72" height="72" alt="Quezon City University">
<h1>${status === 400 ? 'Check the page address' : 'This page is temporarily unavailable'}</h1><p>${escapeHtml(message)}</p>
<nav class="recovery-actions" aria-label="Page recovery"><button id="recovery-retry" class="btn-primary" hidden>Try again</button><a href="/">Return home</a><a href="/onboarding.html">Continue COR upload</a></nav>
<noscript><p>Use your browser to reload this page.</p></noscript><small>Error ${status} · QCU My-Schedule</small></main><script src="/assets/js/recovery.js?v=1"></script></body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 503 ? { 'Retry-After': '10' } : {}) },
  });
}
