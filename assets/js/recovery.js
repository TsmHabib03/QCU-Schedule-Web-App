/* Safe on nested fallback URLs; retries preserve the requested address. */
(function () {
  'use strict';
  const retry = document.getElementById('recovery-retry');
  if (retry) {
    retry.hidden = false;
    retry.addEventListener('click', () => window.location.reload());
  }
  const status = document.getElementById('connection-status');
  if (status) {
    const update = () => {
      status.textContent = navigator.onLine
        ? 'Your device reports a connection. Try loading the page again.'
        : 'Your device is offline. Reconnect to continue.';
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }
})();
