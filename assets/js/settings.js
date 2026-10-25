(function () {
  'use strict';
  if (document.body.dataset.page !== 'settings') return;
  const toggle = document.getElementById('notification-toggle');
  const installButton = document.getElementById('install-app-btn');
  const generalButton = document.getElementById('general-settings-btn');
  const helpButton = document.getElementById('settings-help-btn');
  const help = document.getElementById('settings-help');
  let requestingPermission = false;
  let notificationError = '';

  function preferenceEnabled() {
    try { return localStorage.getItem('qcu-notifications') === 'true'; }
    catch (_) { return false; }
  }
  function savePreference(value) {
    try { localStorage.setItem('qcu-notifications', String(value)); }
    catch (_) { notificationError = 'Your browser could not save this preference.'; }
  }
  function renderNotifications() {
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    const enabled = supported && permission === 'granted' && preferenceEnabled();
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.disabled = !supported || requestingPermission;
    toggle.setAttribute('aria-busy', String(requestingPermission));
    document.getElementById('notification-status').textContent = notificationError ||
      (requestingPermission ? 'Waiting for browser permission…' :
        !supported ? 'This browser does not support notifications.' :
          permission === 'denied' ? 'Blocked by your browser. Allow this site in browser settings.' :
            enabled ? 'On · Alerts for new Classroom updates while the app is open.' :
              'Off · Turn on browser alerts for Classroom updates.');
    const dot = document.querySelector('.profile-bell-dot');
    if (dot) dot.hidden = !enabled;
  }
  async function changeNotifications() {
    if (requestingPermission || !('Notification' in window)) return;
    notificationError = '';
    if (preferenceEnabled() && Notification.permission === 'granted') {
      savePreference(false);
      renderNotifications();
      return;
    }
    requestingPermission = true;
    renderNotifications();
    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission() : Notification.permission;
      savePreference(permission === 'granted');
      if (permission === 'default') notificationError = 'Permission was not granted. You can try again.';
    } catch (_) {
      savePreference(false);
      notificationError = 'Notifications could not be enabled. Try again in browser settings.';
    } finally {
      requestingPermission = false;
      renderNotifications();
    }
  }
  function renderInstall() {
    const installed = window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true || window.QCUInstallPrompt?.isInstalled();
    installButton.disabled = Boolean(installed);
    document.getElementById('install-app-status').textContent = installed
      ? 'Installed · Ready on this device.' : 'Keep your schedule close.';
  }
  function renderProfile(profile) {
    const identity = profile?.googleAccount || profile || {};
    const name = String(identity.name || '').trim();
    const email = String(identity.email || '').trim();
    const picture = String(identity.picture || '').trim();
    document.getElementById('profile-name').textContent = name || 'Your profile';
    document.getElementById('profile-email').textContent = email;
    renderVerification();
    const avatar = document.getElementById('profile-avatar');
    const key = JSON.stringify([name, picture]);
    if (avatar.dataset.profileKey === key) return;
    avatar.dataset.profileKey = key;
    const words = name.split(/\s+/).filter(Boolean);
    const initials = words.length ? (Array.from(words[0])[0] +
      (words.length > 1 ? Array.from(words.at(-1))[0] : '')).toUpperCase() : '';
    const fallback = () => {
      const face = document.createElement('span');
      face.className = 'avatar-face';
      avatar.replaceChildren(face);
      if (initials) face.textContent = initials;
      else {
        const icon = document.createElement('i');
        icon.dataset.lucide = 'user';
        face.appendChild(icon);
        window.lucide?.createIcons();
      }
    };
    if (!/^https?:\/\//i.test(picture)) { fallback(); return; }
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', fallback, { once: true });
    img.src = picture;
    const face = document.createElement('span');
    face.className = 'avatar-face';
    face.appendChild(img);
    avatar.replaceChildren(face);
  }

  function renderVerification() {
    const verified = window.QCUGoogleConnection?.account?.connected === true;
    document.getElementById('profile-badge-label').textContent = verified ? 'Google Verified' : 'Student account';
    document.querySelector('.profile-badge').classList.toggle('is-google-verified', verified);
    document.getElementById('profile-avatar').classList.toggle('google-verified-avatar', verified);
  }
  window.addEventListener('qcu-google-state', renderVerification);

  toggle.addEventListener('click', changeNotifications);
  generalButton.addEventListener('click', () => {
    const panel = document.getElementById('general-settings-panel');
    panel.hidden = !panel.hidden;
    generalButton.setAttribute('aria-expanded', String(!panel.hidden));
  });
  installButton.addEventListener('click', () => window.QCUInstallPrompt?.trigger());
  helpButton.addEventListener('click', () => help.showModal());
  help.addEventListener('close', () => helpButton.focus());
  help.addEventListener('click', event => {
    if (event.target !== help) return;
    const rect = help.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) help.close();
  });
  document.getElementById('app-header').addEventListener('click', event => {
    if (!event.target.closest('#profile-notifications-btn')) return;
    document.getElementById('settings-notifications').scrollIntoView({ block: 'center' });
    toggle.focus({ preventScroll: true });
  });
  window.addEventListener('storage', event => {
    if (event.key === 'qcu-notifications' || event.key === null) { notificationError = ''; renderNotifications(); }
    if (event.key === 'qcu-install-prompt' || event.key === null) renderInstall();
  });
  window.addEventListener('qcu-install-changed', renderInstall);
  window.addEventListener('focus', renderNotifications);
  window.QCUSettings = { render(profile) { renderProfile(profile); renderNotifications(); renderInstall(); } };
  window.QCUSettings.render(typeof state !== 'undefined' ? state.profile : null);
})();
