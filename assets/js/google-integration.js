(function () {
  "use strict";

  const CACHE_KEY = "qcu-google-integration-v1";
  const MIN_AUTO_SYNC_MS = 5 * 60 * 1000;
  const AUTO_REFRESH_MS = 15 * 60 * 1000;
  const localStaticPorts = new Set(["5500", "5501", "5502", "5503"]);

  const ui = {};
  let cache = loadCache();
  let account = null;
  let syncing = false;
  let autoRefreshTimer = null;
  let updateView = "new";

  // True when the page is served by a plain static server (Live Server) and API
  // calls are being redirected to the project's own dev server on port 8788.
  function usingProxiedApi() {
    const isLocalHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    return isLocalHost && localStaticPorts.has(location.port);
  }

  function apiPath(path) {
    if (usingProxiedApi()) {
      return `${location.protocol}//${location.hostname}:8788${path}`;
    }
    return path;
  }

  const TYPE_META = {
    announcement: { label: "Announcement", icon: "megaphone", action: "Open Classroom" },
    material: { label: "New Material", icon: "file-text", action: "View in Classroom" },
    assignment: { label: "Assignment", icon: "clipboard-check", action: "View Assignment" },
    email: { label: "Email", icon: "mail", action: "Open Gmail" }
  };

  /* Google Classroom icon — green chalkboard with two people */
  const CLASSROOM_ICON = `<svg class="brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" fill="#0F9D58"/><path d="M7.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="#fff"/><path d="M3 17.5c0-1.93 2.01-3.5 4.5-3.5s4.5 1.57 4.5 3.5V18H3v-.5Z" fill="#fff"/><path d="M16.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="#fff"/><path d="M12 17.5c0-1.93 2.01-3.5 4.5-3.5s4.5 1.57 4.5 3.5V18H12v-.5Z" fill="#fff"/></svg>`;

  /* Gmail icon — red M envelope */
  const GMAIL_ICON = `<svg class="brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" stroke="#EA4335" stroke-width="1.5" fill="none"/><path d="M2 6l10 7 10-7" stroke="#EA4335" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 6v12" stroke="#4285F4" stroke-width="1.5" stroke-linecap="round"/><path d="M22 6v12" stroke="#34A853" stroke-width="1.5" stroke-linecap="round"/><path d="M2 18h4" stroke="#FBBC05" stroke-width="1.5" stroke-linecap="round"/><path d="M18 18h4" stroke="#34A853" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  /* Google G logo */
  const GOOGLE_LOGO = `<svg class="brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadCache() {
    try {
      const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (stored && typeof stored === "object") return stored;
    } catch (_) {}
    return { email: "", preferences: null, permissions: null, updates: [], knownIds: [], checkedAt: null };
  }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) {}
  }

  function clearLocalCache() {
    localStorage.removeItem(CACHE_KEY);
    cache = loadCache();
  }

  function iconify() {
    if (window.lucide) window.lucide.createIcons();
  }

  function formatDate(value, includeDate = true) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Time unavailable";
    const options = includeDate
      ? { timeZone: "Asia/Manila", month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined, hour: "numeric", minute: "2-digit" }
      : { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat([], options).format(date);
  }

  function setStatus(label, state) {
    if (!ui.status) return;
    ui.status.textContent = label;
    ui.status.className = `google-status-badge is-${state}`;
  }

  function showFeedback(message, kind = "info") {
    if (!ui.feedback) return;
    if (!message) {
      ui.feedback.hidden = true;
      ui.feedback.textContent = "";
      return;
    }
    ui.feedback.hidden = false;
    ui.feedback.className = `google-feedback is-${kind}`;
    ui.feedback.textContent = message;
  }

  async function api(path, options) {
    const endpoint = apiPath(path);
    const response = await fetch(endpoint, {
      cache: "no-store",
      credentials: endpoint.startsWith("http") ? "include" : "same-origin",
      headers: { "Content-Type": "application/json", ...(options && options.headers ? options.headers : {}) },
      ...options
    });
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const error = new Error("Google Integration server routes are unavailable.");
      error.status = response.status;
      error.code = "INVALID_API_RESPONSE";
      error.data = { status: "SERVER_UNAVAILABLE" };
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Google integration request failed.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function permissionRow(icon, title, copy) {
    return `
      <div class="google-permission-row">
        <i data-lucide="${icon}"></i>
        <div><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>
      </div>`;
  }

  function renderNotConnected(mode, diagnostic = null) {
    const isServerUnavailable = mode === "server_unavailable";
    const isError = mode === "error" || mode === "unconfigured" || isServerUnavailable;
    const statusCopy = mode === "unconfigured"
      ? "Configuration required"
      : isServerUnavailable
        ? "Server unavailable"
        : isError ? "Connection error" : "Not connected";
    setStatus(statusCopy, isError ? "error" : "idle");
    ui.account.innerHTML = `
      <article class="google-account-card is-disconnected">
        <header class="google-card-band">
          <div class="google-band-mark">${CLASSROOM_ICON}</div>
          <div class="google-band-copy">
            <span>Google Classroom</span>
            <strong>Classroom &amp; Email Updates</strong>
          </div>
          <span class="google-card-code">QCU-GOOGLE</span>
        </header>
        <div class="google-card-body">
          <div class="google-card-lead">
            <div class="google-card-seal"><i data-lucide="book-open-check"></i></div>
            <div>
              <p class="google-card-eyebrow">Google Account</p>
              <h3>Connect Google Classroom</h3>
              <p>See Classroom announcements, materials, and assignments directly inside My-Schedule.</p>
            </div>
          </div>
          <div class="google-permissions-list" aria-label="Permissions requested">
            ${permissionRow("school", "Classroom access", "Read your courses and posted class activity.")}
            ${permissionRow("mail", "Email remains optional", "Gmail metadata is requested only when you enable it.")}
          </div>
          ${mode === "unconfigured" ? `<p class="google-inline-error">Google OAuth environment variables are not configured on this deployment.${diagnostic && diagnostic.missing && diagnostic.missing.length ? ` Missing: ${esc(diagnostic.missing.join(", "))}.` : ""}${diagnostic && diagnostic.invalid && diagnostic.invalid.length ? ` Invalid: ${esc(diagnostic.invalid.join(", "))}.` : ""}</p>` : ""}
          ${isServerUnavailable ? `<p class="google-inline-error">This preview is serving static HTML only. Start My-Schedule with Cloudflare Pages Functions before connecting Google.</p>` : ""}
          ${mode === "idle" ? `
            <a class="google-primary-button" href="${apiPath("/api/google/connect?return=google.html%23google-integration")}">
              <i data-lucide="log-in"></i>
              Connect Google Account
            </a>` : isServerUnavailable || mode === "error" || mode === "unconfigured" ? `
            <button class="google-primary-button" type="button" data-google-action="retry-status">
              <i data-lucide="refresh-cw"></i>
              Retry Server Check
            </button>` : `
            <span class="google-primary-button is-disabled" aria-disabled="true">
              <i data-lucide="log-in"></i>
              Connect Google Account
            </span>`}
          <p class="google-secure-note"><i data-lucide="external-link"></i>You will be redirected to Google to securely authorize access.</p>
        </div>
      </article>`;
    ui.account.setAttribute("aria-busy", "false");
    ui.updatesSection.hidden = true;
    iconify();
  }

  function toggleRow(key, title, copy, checked, disabled, icon) {
    const isHtml = icon && icon.startsWith("<");
    const iconContent = isHtml ? icon : `<i data-lucide="${esc(icon || "settings")}" aria-hidden="true"></i>`;
    return `
      <label class="google-control-row">
        <span class="google-control-icon" aria-hidden="true">${iconContent}</span>
        <span class="google-control-copy"><strong>${esc(title)}</strong><small>${esc(copy)}</small></span>
        <span class="google-switch-wrap">
          <span class="google-switch-state">${checked ? "ON" : "OFF"}</span>
          <input class="google-switch-input" type="checkbox" data-google-pref="${key}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span class="google-switch" aria-hidden="true"></span>
        </span>
      </label>`;
  }

  function renderConnected() {
    const prefs = account.preferences || { classroom: true, gmail: false, autoRefresh: true };
    const permissions = account.permissions || { gmail: false };
    setStatus("Connected", "connected");
    const syncTime = cache.checkedAt ? esc(formatDate(cache.checkedAt)) : "Not synchronized yet";
    ui.account.innerHTML = `
      <article class="google-account-card is-connected">
        <header class="google-card-band">
          <div class="google-band-mark">${CLASSROOM_ICON}</div>
          <div class="google-band-copy">
            <span>Google Classroom</span>
            <strong>Authorized Account</strong>
          </div>
          <span class="google-card-code">CONNECTED</span>
        </header>
        <div class="google-card-body">
          <div class="google-account-identity">
            <div class="google-card-seal is-connected">${GOOGLE_LOGO.replace('class="brand-icon"', 'class="brand-icon brand-icon--seal"')}</div>
            <div>
              <p class="google-card-eyebrow">Google Account</p>
              <h3>${esc(account.email || "Google account")}</h3>
              <p class="google-card-status"><i data-lucide="check-circle" aria-hidden="true"></i>Authorization active · Tokens encrypted</p>
            </div>
          </div>
          <div class="google-controls">
            <div class="google-controls-header">
              <i data-lucide="sliders-horizontal" aria-hidden="true"></i>
              <span>Preferences</span>
            </div>
            ${toggleRow("classroom", "Classroom Updates", "Announcements, materials, and assignments", prefs.classroom !== false, false, CLASSROOM_ICON)}
            ${toggleRow("gmail", "Gmail Notifications", permissions.gmail ? "Relevant message metadata only" : "Requires separate Google authorization", prefs.gmail === true, false, GMAIL_ICON)}
            ${toggleRow("autoRefresh", "Auto Refresh", "Checks at most every 15 minutes while active", prefs.autoRefresh !== false, false, "refresh-cw")}
          </div>
          <div class="google-sync-row">
            <div>
              <span><i data-lucide="clock-3" aria-hidden="true"></i>Last synchronized</span>
              <strong>${syncTime}</strong>
            </div>
            <button class="google-icon-button" type="button" data-google-action="refresh" title="Refresh Google updates" aria-label="Refresh Google updates" ${syncing ? "disabled" : ""}>
              <i data-lucide="refresh-cw"${syncing ? " class=\"is-spinning\"" : ""}></i>
            </button>
          </div>
          ${account.needsReauthorization ? `
            <div class="google-renewal">
              <div><strong>Authorization renewal required</strong><span>Your Google connection has expired or was revoked.</span></div>
              <a class="google-primary-button" href="${apiPath(`/api/google/connect?${permissions.gmail ? "gmail=1&" : ""}return=google.html%23google-integration`)}"><i data-lucide="key-round"></i>Reconnect Google</a>
            </div>` : ""}
          <div class="google-account-actions">
            <button class="google-secondary-button" type="button" data-google-action="refresh" ${syncing ? "disabled" : ""}><i data-lucide="refresh-cw"></i>${syncing ? "Refreshing" : "Refresh Now"}</button>
            <button class="google-danger-button" type="button" data-google-action="disconnect"><i data-lucide="unlink"></i>Disconnect Account</button>
          </div>
        </div>
      </article>`;
    ui.account.setAttribute("aria-busy", String(syncing));
    ui.updatesSection.hidden = false;
    renderUpdates();
    iconify();
  }

  function updateCard(item) {
    const meta = TYPE_META[item.type] || TYPE_META.announcement;
    const source = item.source === "gmail" ? "Gmail" : "Classroom";
    const posted = item.postedAt || item.createdAt;
    const due = item.dueAt;
    const detail = item.materialType ? esc(item.materialType) : "";
    const author = item.author ? esc(item.author) : "";
    const desc = item.description && item.description !== item.title ? item.description : "";
    const brandIcon = item.source === "gmail" ? GMAIL_ICON : CLASSROOM_ICON;
    return `
      <article class="google-update-card type-${esc(item.type)}${item.isNew ? " is-new" : ""}" data-update-id="${esc(item.id)}">
        <div class="google-update-card-head">
          <span class="google-update-source-tag">
            ${brandIcon}
            ${esc(source)}
          </span>
          <span class="google-update-type-tag">
            <i data-lucide="${meta.icon}" aria-hidden="true"></i>
            ${esc(meta.label)}
          </span>
          ${item.isNew ? `<span class="google-update-new-dot" aria-label="New"></span>` : ""}
        </div>
        <p class="google-update-course">${esc(item.courseName || "Google Classroom")}</p>
        <h3 class="google-update-title">${esc(item.title || "Classroom update")}</h3>
        ${desc ? `<p class="google-update-description">${esc(desc)}</p>` : ""}
        ${author ? `<p class="google-update-author">By ${esc(author)}</p>` : ""}
        <div class="google-update-footer">
          <div class="google-update-meta">
            ${posted ? `<span class="google-update-meta-item"><i data-lucide="clock-3" aria-hidden="true"></i>${esc(formatDate(posted))}</span>` : ""}
            ${due ? `<span class="google-update-meta-item google-update-meta-item--due"><i data-lucide="calendar-clock" aria-hidden="true"></i>Due ${esc(formatDate(due))}</span>` : ""}
            ${detail ? `<span class="google-update-meta-item"><i data-lucide="paperclip" aria-hidden="true"></i>${detail}</span>` : ""}
          </div>
          <a class="google-update-action-link" href="${esc(item.url || "https://classroom.google.com")}" target="_blank" rel="noopener noreferrer" data-google-open-update="${esc(item.id)}">
            ${brandIcon}
            <span>${esc(meta.action)}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
        </div>
      </article>`;
  }

  function renderUpdates() {
    if (!ui.updatesList || !account || !account.connected) return;
    const updates = Array.isArray(cache.updates) ? cache.updates : [];
    populateUpdateSubjectFilter();
    const search = (ui.updateSearch?.value || "").trim().toLowerCase();
    const subject = ui.updateSubject?.value || "all";
    const type = ui.updateType?.value || "all";
    const newOnly = updateView === "new" || Boolean(ui.updateNew?.checked);
    const filtered = updates.filter(item => {
      const haystack = [item.title, item.description, item.author, item.courseName].filter(Boolean).join(" ").toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (subject !== "all" && String(item.courseName || "") !== subject) return false;
      if (type !== "all" && item.type !== type) return false;
      if (newOnly && !item.isNew) return false;
      return true;
    });
    const newCount = updates.filter(item => item.isNew).length;
    ui.count.textContent = filtered.length === updates.length && updateView === "all"
      ? `${updates.length} update${updates.length === 1 ? "" : "s"}${newCount ? `, ${newCount} new` : ""}`
      : updateView === "new" && !search && subject === "all" && type === "all" && !ui.updateNew?.checked
        ? `${filtered.length} new`
        : `${filtered.length} of ${updates.length} updates`;
    ui.offline.hidden = navigator.onLine;

    if (syncing && !updates.length) {
      ui.updatesList.innerHTML = `
        <div class="google-updates-loading" aria-label="Loading Classroom updates">
          <span class="skeleton-line skeleton-line-lg"></span>
          <span class="skeleton-line"></span>
          <span class="skeleton-line skeleton-line-sm"></span>
        </div>`;
    } else if (!updates.length) {
      ui.updatesList.innerHTML = `
        <div class="google-empty-state">
          <i data-lucide="inbox"></i>
          <h3>No new Classroom updates</h3>
          <p>You're all caught up. New announcements, materials, and assignments will appear here.</p>
          <span>Last checked: ${cache.checkedAt ? esc(formatDate(cache.checkedAt)) : "Not yet checked"}</span>
          <button class="google-secondary-button" type="button" data-google-action="refresh" ${syncing || !navigator.onLine ? "disabled" : ""}><i data-lucide="refresh-cw"></i>Refresh</button>
        </div>`;
    } else if (!filtered.length) {
      ui.updatesList.innerHTML = `
        <div class="google-empty-state google-empty-state--filtered">
          <i data-lucide="${updateView === "new" ? "sparkles" : "filter-x"}"></i>
          <h3>${updateView === "new" ? "No new updates" : "No matching updates"}</h3>
          <p>${updateView === "new" ? "You are all caught up. View all updates to review older activity." : "Try a different subject, type, or search term."}</p>
          <button class="google-secondary-button" type="button" data-google-action="clear-filters"><i data-lucide="rotate-ccw"></i>Clear filters</button>
          ${updateView === "new" ? '<button class="google-secondary-button" type="button" data-google-action="set-view-all"><i data-lucide="layers-3"></i>View all updates</button>' : ''}
        </div>`;
    } else {
      ui.updatesList.innerHTML = filtered.map(updateCard).join("");
    }
    iconify();
  }

  function mergeUpdates(incoming) {
    const previous = new Map((cache.updates || []).map(item => [item.id, item]));
    const known = new Set(cache.knownIds || []);
    const hadPreviousSync = Boolean(cache.checkedAt);
    const newlyDetected = [];
    const merged = (incoming || []).map(item => {
      const old = previous.get(item.id);
      const isNew = old ? old.isNew === true : hadPreviousSync && !known.has(item.id);
      if (isNew && !old) newlyDetected.push(item);
      return { ...item, isNew };
    });
    cache.updates = merged;
    cache.knownIds = Array.from(new Set([...known, ...merged.map(item => item.id)])).slice(-250);
    return newlyDetected;
  }

  function populateUpdateSubjectFilter() {
    if (!ui.updateSubject) return;
    const current = ui.updateSubject.value || "all";
    const subjects = Array.from(new Set((cache.updates || []).map(item => String(item.courseName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    ui.updateSubject.innerHTML = '<option value="all">All Subjects</option>' + subjects.map(subject => `<option value="${esc(subject)}">${esc(subject)}</option>`).join("");
    ui.updateSubject.value = subjects.includes(current) ? current : "all";
  }

  function clearUpdateFilters() {
    if (ui.updateSearch) ui.updateSearch.value = "";
    if (ui.updateSubject) ui.updateSubject.value = "all";
    if (ui.updateType) ui.updateType.value = "all";
    if (ui.updateNew) ui.updateNew.checked = false;
    renderUpdates();
  }

  function setUpdateView(view) {
    updateView = view === "all" ? "all" : "new";
    document.querySelectorAll("[data-google-view]").forEach(button => {
      const active = button.dataset.googleView === updateView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    renderUpdates();
  }

  function notifyNewUpdates(items) {
    if (!items.length || !("Notification" in window) || Notification.permission !== "granted") return;
    const first = items[0];
    const body = items.length === 1 ? first.title : `${items.length} new Classroom updates are available.`;
    try { new Notification(first.courseName || "Google Classroom", { body, icon: "assets/images/QCU college of computer studies logo.jpg" }); } catch (_) {}
  }

  async function syncUpdates(force) {
    if (!account || !account.connected || syncing) return;
    if (!navigator.onLine) {
      showFeedback("Offline - showing last synced updates.", "info");
      renderUpdates();
      return;
    }
    const elapsed = Date.now() - new Date(cache.checkedAt || 0).getTime();
    if (!force && cache.checkedAt && elapsed < MIN_AUTO_SYNC_MS) return;
    syncing = true;
    showFeedback("", "info");
    renderConnected();
    try {
      const result = await api("/api/google/updates");
      const preserveCachedFeed = result.status === "PARTIAL" && !(result.updates || []).length;
      const newlyDetected = preserveCachedFeed ? [] : mergeUpdates(result.updates || []);
      cache.checkedAt = result.checkedAt || new Date().toISOString();
      saveCache();
      if (result.warnings && result.warnings.length) showFeedback(result.warnings.join(" "), "warning");
      notifyNewUpdates(newlyDetected);
    } catch (error) {
      if (error.data && error.data.status === "REAUTHORIZE") {
        account.needsReauthorization = true;
        showFeedback("Your Google connection needs to be renewed.", "error");
        setStatus("Connection error", "error");
      } else {
        showFeedback(error.message || "Google Classroom couldn't be reached right now.", "error");
      }
    } finally {
      syncing = false;
      renderConnected();
    }
  }

  async function savePreference(input) {
    const key = input.dataset.googlePref;
    const previous = { ...(account.preferences || {}) };
    const next = { ...previous, [key]: input.checked };
    if (key === "gmail" && input.checked && !(account.permissions && account.permissions.gmail)) {
      window.location.href = apiPath("/api/google/connect?gmail=1&return=google.html%23google-integration");
      return;
    }
    account.preferences = next;
    cache.preferences = next;
    renderConnected();
    try {
      const result = await api("/api/google/preferences", { method: "POST", body: JSON.stringify(next) });
      account.preferences = result.preferences;
      cache.preferences = result.preferences;
      saveCache();
      configureAutoRefresh();
      if (key === "classroom" && input.checked) syncUpdates(true);
    } catch (error) {
      account.preferences = previous;
      cache.preferences = previous;
      saveCache();
      showFeedback(error.message, "error");
      renderConnected();
    }
  }

  async function disconnect() {
    if (!navigator.onLine) {
      showFeedback("Connect to the internet before disconnecting your Google account.", "warning");
      return;
    }
    if (!window.confirm("Disconnect this Google account from My-Schedule? Cached Classroom updates on this device will also be removed.")) return;
    try { await api("/api/google/disconnect", { method: "POST", body: "{}" }); }
    catch (_) {}
    clearLocalCache();
    account = { connected: false, status: "not_connected" };
    showFeedback("Google account disconnected.", "info");
    renderNotConnected("idle");
  }

  function markRead(id) {
    const item = (cache.updates || []).find(update => update.id === id);
    if (!item || !item.isNew) return;
    item.isNew = false;
    saveCache();
    renderUpdates();
  }

  function configureAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (!account || !account.connected || !account.preferences || account.preferences.autoRefresh === false) return;
    autoRefreshTimer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) syncUpdates(false);
    }, AUTO_REFRESH_MS);
  }

  function handleOAuthResult() {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (!result) return;
    const messages = {
      connected: ["Google account connected.", "success"],
      cancelled: ["Google connection was cancelled.", "warning"],
      gmail_denied: ["Gmail notifications are disabled. You can enable them later from Google Integration settings.", "warning"],
      failed: ["We couldn't connect your Google account. Please try again.", "error"],
      unconfigured: ["Google OAuth is not configured on this deployment.", "error"]
    };
    if (messages[result]) {
      const reason = result === "failed" ? url.searchParams.get("reason") : "";
      showFeedback(reason ? `${messages[result][0]} (${reason})` : messages[result][0], messages[result][1]);
    }
    url.searchParams.delete("google");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function loadStatus() {
    if (location.hostname.endsWith("github.io")) {
      renderNotConnected("server_unavailable");
      showFeedback("This GitHub Pages preview is static and cannot run Google OAuth. Open the deployed Cloudflare Pages URL instead.", "error");
      return;
    }
    if (!navigator.onLine) {
      if (cache.email) {
        account = { connected: true, email: cache.email, preferences: cache.preferences, permissions: cache.permissions };
        setStatus("Connected", "connected");
        renderConnected();
        showFeedback("Offline - showing last synced updates.", "info");
      } else {
        renderNotConnected("idle");
        showFeedback("You're offline. Connect to the internet to authorize Google.", "info");
      }
      return;
    }
    try {
      account = await api("/api/google/status");
      if (!account.connected) {
        renderNotConnected(account.status === "unconfigured" ? "unconfigured" : "idle", account);
        if (account.status === "unconfigured") {
          const problems = [...(account.missing || []), ...(account.invalid || [])];
          if (problems.length) showFeedback(`Cloudflare runtime configuration required: ${problems.join(", ")}.`, "error");
          else if (account.detail) showFeedback(account.detail, "error");
        }
        return;
      }
      cache.email = account.email;
      cache.preferences = account.preferences;
      cache.permissions = account.permissions;
      saveCache();
      renderConnected();
      configureAutoRefresh();
      syncUpdates(false);
    } catch (error) {
      if (error.code === "INVALID_API_RESPONSE") {
        renderNotConnected("server_unavailable");
        showFeedback("Google Integration requires Cloudflare Pages Functions. A static HTML server cannot run OAuth.", "error");
      } else if (error.status === 503) renderNotConnected("unconfigured");
      else {
        renderNotConnected("error");
        // A refused connection throws a TypeError with no status or code. When
        // API calls are proxied to port 8788, that almost always means the
        // project's dev server simply isn't running.
        if (usingProxiedApi()) {
          showFeedback("The API server on port 8788 isn't responding. Run `npm run dev` in the project folder, then reload this page (or open http://127.0.0.1:8788/google.html#google-integration directly).", "error");
        } else {
          showFeedback("We couldn't check your Google connection. Please try again.", "error");
        }
      }
    }
  }

  function bindEvents() {
    function handleClick(event) {
      const action = event.target.closest("[data-google-action]");
      if (action && action.dataset.googleAction === "refresh") syncUpdates(true);
      if (action && action.dataset.googleAction === "disconnect") disconnect();
      if (action && action.dataset.googleAction === "retry-status") loadStatus();
      if (action && action.dataset.googleAction === "clear-filters") clearUpdateFilters();
      if (action && action.dataset.googleAction === "set-view-all") setUpdateView("all");
      const viewButton = event.target.closest("[data-google-view]");
      if (viewButton) setUpdateView(viewButton.dataset.googleView);
      const update = event.target.closest("[data-google-open-update]");
      if (update) markRead(update.dataset.googleOpenUpdate);
    }
    function handleChange(event) {
      const input = event.target.closest("[data-google-pref]");
      if (input) savePreference(input);
      if (event.target.closest("#google-update-subject, #google-update-type, #google-update-new")) renderUpdates();
    }
    document.getElementById("google-integration")?.addEventListener("click", handleClick);
    document.getElementById("google-updates-section")?.addEventListener("click", handleClick);
    document.getElementById("google-integration")?.addEventListener("change", handleChange);
    document.getElementById("google-updates-section")?.addEventListener("change", handleChange);
    document.getElementById("google-update-search")?.addEventListener("input", renderUpdates);
    window.addEventListener("online", () => { showFeedback("", "info"); loadStatus(); });
    window.addEventListener("offline", () => { showFeedback("Offline - showing last synced updates.", "error"); renderUpdates(); });
  }

  function init() {
    ui.account = document.getElementById("google-account-card");
    if (!ui.account) return;
    ui.status = document.getElementById("google-status-indicator");
    ui.feedback = document.getElementById("google-feedback");
    ui.updatesSection = document.getElementById("google-updates-section");
    ui.updatesList = document.getElementById("google-updates-list");
    ui.count = document.getElementById("google-update-count");
    ui.offline = document.getElementById("google-offline-notice");
    ui.updateSearch = document.getElementById("google-update-search");
    ui.updateSubject = document.getElementById("google-update-subject");
    ui.updateType = document.getElementById("google-update-type");
    ui.updateNew = document.getElementById("google-update-new");
    bindEvents();
    handleOAuthResult();
    loadStatus();
  }

  window.QCUGoogleIntegration = { init, clearLocalCache };
})();
