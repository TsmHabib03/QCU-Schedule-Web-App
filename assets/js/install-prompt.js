/**
 * PWA Install Prompt — Cross-browser smart interval bottom-sheet.
 *
 * Supports:
 *   • Chrome / Edge (Android + Desktop)  → native `beforeinstallprompt`
 *   • Safari (iOS + macOS)               → guided "Add to Home Screen" instructions
 *   • Firefox / others                   → manual instructions
 *
 * Show intervals:
 *   • First visit:  show after 30 s
 *   • Dismissed:    wait 7 days before showing again
 *   • Installed:    never show again
 */
(function () {
  "use strict";

  const STORAGE_KEY = "qcu-install-prompt";
  const DISMISS_DAYS = 7;
  const INITIAL_DELAY_MS = 30_000;

  /* ── Browser detection ──────────────────────────────── */
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isMacSafari = isSafari && !isIOS;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone) return; // already installed

  /* ── State ──────────────────────────────────────────── */
  let deferredPrompt = null;
  let banner = null;
  let timer = null;

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (_) { return null; }
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) {}
  }

  function shouldShow() {
    const s = loadState();
    if (!s) return true;
    if (s.installed) return false;
    if (!s.dismissedAt) return true;
    return Date.now() - s.dismissedAt > DISMISS_DAYS * 86_400_000;
  }

  /* ── Platform-specific instructions ─────────────────── */
  function getPlatformInstructions() {
    if (isIOS) {
      return {
        title: "Add to Home Screen",
        steps: [
          'Tap the <strong>Share</strong> button <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> at the bottom',
          'Scroll down and tap <strong>Add to Home Screen</strong>',
          'Tap <strong>Add</strong> in the top-right corner'
        ],
        icon: "📱"
      };
    }
    if (isMacSafari) {
      return {
        title: "Add to Dock",
        steps: [
          'Click the <strong>Share</strong> button <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> in the toolbar',
          'Click <strong>Add to Dock</strong>'
        ],
        icon: "💻"
      };
    }
    // Chrome, Edge, Firefox on desktop/Android
    return {
      title: "Install QCU Schedule",
      steps: [
        'Tap the <strong>menu</strong> ⋮ in the top-right corner',
        'Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>',
        'Confirm by tapping <strong>Install</strong>'
      ],
      icon: "⬇️"
    };
  }

  /* ── Banner HTML ────────────────────────────────────── */
  function createBanner() {
    const supportsNative = Boolean(deferredPrompt);
    const platform = getPlatformInstructions();

    let actionsHtml;
    if (supportsNative) {
      actionsHtml = `
        <button class="install-btn-primary" id="install-btn-install" type="button">Install</button>
        <button class="install-btn-secondary" id="install-btn-dismiss" type="button">Not now</button>`;
    } else {
      // No native prompt — show instructions instead
      const stepsHtml = platform.steps.map(s => `<li>${s}</li>`).join("");
      actionsHtml = `
        <div class="install-instructions">
          <p class="install-instructions-title">${platform.icon} How to install:</p>
          <ol class="install-instructions-list">${stepsHtml}</ol>
        </div>
        <button class="install-btn-secondary install-btn-full" id="install-btn-dismiss" type="button">Got it</button>`;
    }

    const el = document.createElement("div");
    el.id = "install-prompt";
    el.className = "install-prompt";
    el.setAttribute("role", "alert");
    el.innerHTML = `
      <div class="install-prompt-inner">
        <div class="install-prompt-icon" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <div class="install-prompt-copy">
          <strong>${platform.title}</strong>
          <span>Add to your home screen for quick access — works offline!</span>
        </div>
        <div class="install-prompt-actions">
          ${actionsHtml}
        </div>
      </div>`;
    return el;
  }

  /* ── Show / Hide ────────────────────────────────────── */
  function show() {
    if (banner || !shouldShow()) return;
    // If no native prompt and no mobile browser, still show on mobile browsers
    // For desktop browsers without beforeinstallprompt, show instructions
    banner = createBanner();
    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add("is-visible")));

    const installBtn = document.getElementById("install-btn-install");
    const dismissBtn = document.getElementById("install-btn-dismiss");
    if (installBtn) installBtn.addEventListener("click", install);
    if (dismissBtn) dismissBtn.addEventListener("click", dismiss);
  }

  function hide() {
    if (!banner) return;
    banner.classList.remove("is-visible");
    setTimeout(() => banner?.remove(), 350);
    banner = null;
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      saveState({ installed: true, installedAt: Date.now() });
    }
    deferredPrompt = null;
    hide();
  }

  function dismiss() {
    saveState({ dismissedAt: Date.now() });
    hide();
  }

  /* ── Events ─────────────────────────────────────────── */
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    timer = setTimeout(show, INITIAL_DELAY_MS);
  });

  window.addEventListener("appinstalled", () => {
    saveState({ installed: true, installedAt: Date.now() });
    hide();
  });

  /* ── Manual trigger (for Settings page button) ─────── */
  window.QCUInstallPrompt = {
    canInstall() { return true; }, // always "installable" — either native or instructions
    trigger() { show(); },
    isInstalled() {
      const s = loadState();
      return !!(s && s.installed);
    },
    /** Get browser-specific install instructions for Settings page. */
    getInstructions() { return getPlatformInstructions(); },
    /** Whether native install prompt is available. */
    hasNativePrompt() { return Boolean(deferredPrompt); }
  };

  /* ── Cleanup ────────────────────────────────────────── */
  window.addEventListener("beforeunload", () => {
    if (timer) clearTimeout(timer);
  });
})();
