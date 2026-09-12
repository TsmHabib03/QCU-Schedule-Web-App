/**
 * My-Schedule — Onboarding page logic
 * Multi-step wizard: Welcome → Upload COR → Processing → Review → Confirm → Success
 */

(function () {
  "use strict";

  /* ── Globals ─────────────────────────────────────────────────────────── */
  let user = null;
  let selectedFile = null;
  let corRecordId = null;
  let draftResult = null;
  let pollTimer = null;
  const MAX_POLL = 60;
  let pollCount = 0;
  let uploadInFlight = false;
  let pollingInFlight = false;
  let uploadRequest = null;
  let retryAt = 0;
  let cooldownTimer = null;
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(120000) : undefined });
    if (response.status === 401) {
      const error = new Error('Your session expired. Sign in again to reopen your saved import.');
      error.sessionExpired = true;
      throw error;
    }
    return response;
  }
  function cooldown(seconds) {
    retryAt = Date.now() + Math.max(1, Number(seconds) || 10) * 1000;
    if (cooldownTimer) clearInterval(cooldownTimer);
    const update = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      uploadBtn.disabled = remaining > 0 || uploadInFlight || !selectedFile;
      document.getElementById('processing-retry').disabled = remaining > 0;
      const message = remaining ? `Scan limit reached. You can retry in ${remaining}s. Your saved result is still available.` : 'You can now retry your scan.';
      if (currentStep === 'processing') document.getElementById('processing-message').textContent = message;
      else showError(message);
      if (!remaining) { clearInterval(cooldownTimer); cooldownTimer = null; }
    };
    update();
    cooldownTimer = setInterval(update, 1000);
  }
  function pauseRecovery(message, sessionExpired = false) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    goToStep('processing');
    document.getElementById('processing-message').textContent = message;
    document.getElementById('processing-retry').hidden = sessionExpired;
    document.getElementById('processing-sign-in').hidden = !sessionExpired;
    document.getElementById('processing-spinner').hidden = true;
  }
  async function recoverUpload(error) {
    uploadInFlight = false;
    if (error?.sessionExpired) return pauseRecovery(error.message, true);
    goToStep('processing');
    document.getElementById('processing-message').textContent = 'Checking whether your import was saved…';
    try {
      const suffix = uploadRequest?.id ? '?requestId=' + encodeURIComponent(uploadRequest.id) : '';
      const response = await request('/api/v1/cor/status' + suffix, { credentials: 'include' });
      const data = await response.json();
      if (data.status !== 'OK') throw new Error('Your saved status could not be checked.');
      if (data.hasImport === false) {
        // Absence may race a save still running on the server. Keep the same ID.
        pauseRecovery('The upload has not appeared yet. Check again, or select the same file to resume safely.');
        document.getElementById('processing-select-file').hidden = false;
        return;
      }
      corRecordId = data.corRecordId || corRecordId;
      if (data.importStatus === 'COMPLETE') { clearUploadRequest(); goToStep('success'); }
      else if (data.importStatus === 'REVIEW_REQUIRED') { await loadResult(); goToStep('review'); }
      else startPolling();
    } catch (e) {
      pauseRecovery(e.sessionExpired ? e.message : 'We could not check your saved import. Reconnect and check again; your request ID is preserved.', e.sessionExpired);
    }
  }
  function sendUpload(formData, id, fill, label) {
    if (typeof XMLHttpRequest === 'undefined') return request('/api/v1/cor/upload', { method:'POST', credentials:'include', headers:{'X-Request-ID':id}, body:formData });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/cor/upload');
      xhr.withCredentials = true;
      xhr.timeout = 120000;
      xhr.setRequestHeader('X-Request-ID', id);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) {
          const percent = Math.round(event.loaded / event.total * 100);
          fill.style.width = percent + '%';
          label.textContent = `Uploading your COR… ${percent}%`;
        }
      };
      xhr.upload.onload = () => { label.textContent = 'Saving your upload…'; };
      xhr.onload = () => {
        if (xhr.status === 401) { const e = new Error('Your session expired. Sign in again to reopen your saved import.'); e.sessionExpired = true; reject(e); }
        else resolve({ status:xhr.status, json:async () => JSON.parse(xhr.responseText) });
      };
      xhr.onerror = xhr.ontimeout = () => reject(new Error('The upload response was interrupted.'));
      xhr.send(formData);
    });
  }
  function requestIdFor(file) {
    const owner = user?.userId || user?.email;
    const fingerprint = JSON.stringify([file.name, file.size, file.lastModified, file.type]);
    try { uploadRequest = JSON.parse(sessionStorage.getItem("qcu-cor-request")) || uploadRequest; } catch (_) {}
    if (uploadRequest?.owner !== owner || uploadRequest?.fingerprint !== fingerprint) {
      uploadRequest = { owner, fingerprint, id: crypto.randomUUID() };
    }
    try { sessionStorage.setItem("qcu-cor-request", JSON.stringify(uploadRequest)); } catch (_) {}
    return uploadRequest.id;
  }
  function clearUploadRequest() {
    uploadRequest = null;
    try { sessionStorage.removeItem("qcu-cor-request"); } catch (_) {}
  }
  function cacheDraft() {
    try { sessionStorage.setItem("qcu-cor-draft", JSON.stringify({ owner: user?.userId || user?.email, corRecordId, draft: draftResult })); } catch (_) {}
  }
  function restoreDraft() {
    try {
      const cached = JSON.parse(sessionStorage.getItem("qcu-cor-draft"));
      if (cached?.owner === (user?.userId || user?.email) && cached.corRecordId === corRecordId) draftResult = cached.draft;
    } catch (_) {}
  }

  /* ── DOM refs ────────────────────────────────────────────────────────── */
  const headerName = document.getElementById("header-user-name");
  const headerAvatar = document.getElementById("header-user-avatar");
  const tracker = document.getElementById("stage-tracker");

  /* ── Step navigation ─────────────────────────────────────────────────── */
  const STEPS = ["welcome", "upload", "processing", "review", "confirm", "success"];
  let currentStep = "welcome";

  window.goToStep = function (step) {
    if (uploadInFlight && (step === "welcome" || step === "upload")) return;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    currentStep = step;
    document.querySelectorAll(".onboarding-step").forEach((el) => el.classList.remove("active"));
    const target = document.getElementById("step-" + step);
    if (target) target.classList.add("active");
    updateTracker(step);
    window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  function updateTracker(step) {
    const mapping = { welcome: 0, upload: 1, processing: 1, review: 2, confirm: 3, success: 4 };
    const idx = mapping[step] ?? 0;
    tracker.querySelectorAll(".stage-item").forEach((el, i) => {
      el.classList.remove("active", "completed");
      if (i < idx) el.classList.add("completed");
      else if (i === idx) el.classList.add("active");
    });
    tracker.querySelectorAll(".stage-connector").forEach((el, i) => {
      el.classList.toggle("active", i < idx);
    });
  }

  /* ── Sign out ────────────────────────────────────────────────────────── */
  window.signOut = async function () {
    clearUploadRequest();
    try { sessionStorage.removeItem("qcu-cor-draft"); } catch (_) {}
    try { await request("/api/auth/logout", { method: "POST" }); } catch (_) {}
    window.location.href = "/";
  };

  /* ── Session bootstrap ──────────────────────────────────────────────── */
  async function init() {
    try {
      const resp = await request("/api/auth/session", { credentials: "include" });
      const data = await resp.json();
      if (data.status === "OK" && data.user) {
        user = data.user;
        try {
          const saved = JSON.parse(sessionStorage.getItem('qcu-cor-request'));
          if (saved?.owner === (user.userId || user.email)) uploadRequest = saved;
        } catch (_) {}
        renderUser();
        if (uploadRequest) await recoverUpload();
        else await checkOnboardingStatus();
      } else {
        window.location.href = "/?login=1";
      }
    } catch (error) {
      pauseRecovery('Unable to check your session. Reconnect and reload this page.', error.sessionExpired);
    }
  }

  function renderUser() {
    if (!user) return;
    headerName.textContent = user.name || user.email || "";
    if (user.picture) {
      headerAvatar.src = user.picture;
      headerAvatar.alt = user.name || "";
      headerAvatar.style.display = "";
    }
  }

  /* ── Onboarding status ──────────────────────────────────────────────── */
  async function checkOnboardingStatus() {
    try {
      const resp = await request("/api/v1/onboarding/status", { credentials: "include" });
      const data = await resp.json();
      if (data.status !== "OK") {
        goToStep("welcome");
        return;
      }
      switch (data.stage) {
        case "COMPLETE":
          goToStep("success");
          break;
        case "PROCESSING":
          corRecordId = data.corRecordId;
          goToStep("processing");
          startPolling();
          break;
        case "UPLOAD":
          corRecordId = data.corRecordId;
          goToStep("processing");
          startPolling();
          break;
        case "REVIEW":
          corRecordId = data.corRecordId;
          await loadResult();
          goToStep("review");
          break;
        case "CONFIRM":
          corRecordId = data.corRecordId;
          goToStep("processing");
          startPolling();
          break;
        default:
          goToStep("welcome");
      }
    } catch (err) {
      pauseRecovery(err.message || 'Could not resume your import. Check again.', err.sessionExpired);
    }
  }

  /* ── File selection ──────────────────────────────────────────────────── */
  const fileInput = document.getElementById("file-input");
  const uploadZone = document.getElementById("upload-zone");
  const fileSummary = document.getElementById("file-summary");
  const fileNameEl = document.getElementById("file-name");
  const fileMetaEl = document.getElementById("file-meta");
  const uploadBtn = document.getElementById("upload-btn");
  const uploadError = document.getElementById("upload-error");

  const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
  const MAX_SIZE = 10 * 1024 * 1024;

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) handleFileSelect(fileInput.files[0]);
    });
  }

  if (uploadZone) {
    uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
    uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
    uploadZone.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadZone.classList.remove("dragover");
      if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
    });
  }

  function handleFileSelect(file) {
    if (uploadInFlight) return;
    removeFile();
    hideError();
    if (!ALLOWED_TYPES.includes(file.type)) {
      showError("Unsupported file type. Please upload a PDF, JPG, or PNG.");
      return;
    }
    if (file.size > MAX_SIZE) {
      showError("File too large. Maximum size is 10 MB.");
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name;
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const typeLabel = file.type === "application/pdf" ? "PDF" : file.type === "image/png" ? "PNG" : "JPG";
    fileMetaEl.textContent = `${sizeMB} MB  \u00B7  ${typeLabel}`;
    fileSummary.classList.add("visible");
    uploadBtn.disabled = false;
    document.getElementById("upload-zone-text").textContent = "Click to change file";
  }

  window.removeFile = function () {
    if (uploadInFlight) return;
    selectedFile = null;
    fileInput.value = "";
    fileSummary.classList.remove("visible");
    uploadBtn.disabled = true;
    document.getElementById("upload-zone-text").textContent = "Choose a file or drag it here";
    hideError();
  };

  function showError(msg) { uploadError.textContent = msg; uploadError.classList.add("visible"); }
  function hideError() { uploadError.classList.remove("visible"); }

  /* ── Upload ──────────────────────────────────────────────────────────── */
  window.uploadCor = async function () {
    if (!selectedFile || uploadInFlight || Date.now() < retryAt) return;
    uploadInFlight = true;
    hideError();
    uploadBtn.disabled = true;
    uploadBtn.classList.add("btn-spinner");
    const progress = document.getElementById("upload-progress");
    const progressFill = document.getElementById("upload-progress-fill");
    const progressText = document.getElementById("upload-progress-text");
    progress.classList.add("visible");
    progressFill.style.width = "0%";
    progressText.textContent = "Uploading your COR...";

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const resp = await sendUpload(formData, requestIdFor(selectedFile), progressFill, progressText);
      const data = await resp.json();
      if (data.status === 'RATE_LIMITED') { cooldown(data.retryAfter); return; }
      if (resp.status >= 500 || !data.status || ['SERVICE_UNAVAILABLE','OFFLINE','ERROR'].includes(data.status)) {
        await recoverUpload();
        return;
      }

      if (data.status === "DUPLICATE") {
        corRecordId = data.corRecordId;
        draftResult = null;
        goToStep("processing");
        if (data.importStatus === "COMPLETE") {
          clearUploadRequest();
          goToStep("success");
        } else if (data.importStatus === "REVIEW_REQUIRED") {
          await loadResult();
          goToStep("review");
        } else if (["ACCEPTED", "QUEUED"].includes(data.importStatus)) {
          await processImport();
        } else {
          startPolling();
        }
        return;
      }

      if (data.status !== "OK" && data.status !== "ACCEPTED" && data.status !== "EXTRACTED") {
        showError(data.error || "Upload failed. Please try again.");        uploadBtn.disabled = false;
        uploadBtn.classList.remove("btn-spinner");
        progress.classList.remove("visible");
        return;
      }



      corRecordId = data.corRecordId;
      // Cache the extraction result from the upload response so it can be
      // sent to /cor/review and /cor/confirm (avoids needing Maps on CF Pages).
      draftResult = data.result || null;
      if (draftResult) {
        cacheDraft();
        populateReviewForm(draftResult);
        goToStep("review");
        return;
      }
      progressText.textContent = "Upload complete. Starting extraction...";

      goToStep("processing");
      await processImport();
    } catch (err) {
      await recoverUpload(err);
    } finally {
      uploadInFlight = false;
      uploadBtn.disabled = !selectedFile || Date.now() < retryAt;
      uploadBtn.classList.remove("btn-spinner");
      progress.classList.remove("visible");
    }
  };

  async function processImport() {
    if (Date.now() < retryAt) return;
    document.getElementById('processing-message').textContent = 'Reading your COR… Your existing schedule stays available until you confirm.';
    const resp = await request("/api/v1/cor/process", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corRecordId }),
    });
    const data = await resp.json();
    if (data.status === "COMPLETE") {
      clearUploadRequest();
      goToStep("success");
      return;
    }
    if (data.status === "RATE_LIMITED") {
      startPolling();
      cooldown(data.retryAfter);
      return;
    }
    if (data.status === "EXTRACTION_FAILED") clearUploadRequest();
    if (!["OK", "PROCESSING", "REVIEW_REQUIRED"].includes(data.status)) {
      throw new Error(data.error || "Could not start extraction. Please try again.");
    }
    if (data.status === "REVIEW_REQUIRED") {
      draftResult = data.result || null;
      await loadResult();
      goToStep("review");
    } else startPolling();
  }

  /* ── Processing polling ──────────────────────────────────────────────── */
  function startPolling() {
    document.getElementById('processing-select-file').hidden = true;
    document.getElementById('processing-sign-in').hidden = true;
    document.getElementById('processing-spinner').hidden = false;
    document.getElementById("processing-message").textContent = "We are extracting your student and class details. This may take a moment.";
    document.getElementById("processing-retry").hidden = true;
    pollCount = 0;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollStatus, 1500);
    pollStatus();
  }

  async function pollStatus() {
    if (pollingInFlight || currentStep !== "processing") return;
    pollCount++;
    if (pollCount > MAX_POLL) {
      clearInterval(pollTimer);
      pollTimer = null;
      pauseRecovery('Your import has not finished yet. Check again to resume without uploading twice.');
      return;
    }
    pollingInFlight = true;
    try {
      const suffix = !corRecordId && uploadRequest?.id ? '?requestId=' + encodeURIComponent(uploadRequest.id) : '';
      const resp = await request("/api/v1/cor/status" + suffix, { credentials: "include" });
      const data = await resp.json();
      if (data.status !== "OK" || currentStep !== "processing") return;
      if (data.corRecordId) corRecordId = data.corRecordId;
      if (data.fileMissing) {
        goToStep("upload");
        showError("Select the original file again to resume your saved upload.");
        return;
      }

      switch (data.importStatus || data.corStatus) {
        case "ACCEPTED":
        case "QUEUED":
          await processImport();
          break;
        case "PROCESSING":
          if (data.canResume) await processImport();
          break;
        case "REVIEW_REQUIRED":
          clearInterval(pollTimer);
          pollTimer = null;
          await loadResult();
          goToStep("review");
          break;
        case "CANCELLED":
        case "DELETED":
          clearUploadRequest();
          clearInterval(pollTimer);
          pollTimer = null;
          goToStep("upload");
          break;
        case "COMPLETE":
          clearUploadRequest();
          clearInterval(pollTimer);
          pollTimer = null;
          goToStep("success");
          break;
      }
    } catch (err) {
      pauseRecovery(err.message || 'Could not check processing status.', err.sessionExpired);
    } finally { pollingInFlight = false; }
  }
  window.resumeProcessing = () => { if (Date.now() >= retryAt) recoverUpload(); };

  /* ── Load extraction result ──────────────────────────────────────────── */
  async function loadResult() {
    if (!draftResult) restoreDraft();
    // If draft was already cached from the upload response, use it directly.
    if (draftResult && draftResult.subjects && draftResult.subjects.length > 0) {
      cacheDraft();
      populateReviewForm(draftResult);
      return;
    }
    const resp = await request("/api/v1/cor/result", { credentials: "include" });
    const data = await resp.json();
    if (data.status === "OK" && data.hasResult) {
      draftResult = data.result;
      cacheDraft();
      populateReviewForm(draftResult);
      return;
    }
    throw new Error("Your COR result is not available yet. Please check again.");
  }

  /* ── Populate review form ────────────────────────────────────────────── */
  function populateReviewForm(draft) {
    if (!draft) return;

    // Student info
    setField("review-studentNumber", draft.studentInfo?.studentNumber);
    setField("review-firstName", draft.studentInfo?.firstName);
    setField("review-middleName", draft.studentInfo?.middleName);
    setField("review-lastName", draft.studentInfo?.lastName);
    setField("review-suffix", draft.studentInfo?.suffix);

    // Enrollment info
    setField("review-campus", draft.enrollmentInfo?.campus);
    setField("review-yearLevel", draft.enrollmentInfo?.yearLevel);
    setField("review-section", draft.enrollmentInfo?.section);
    setField("review-term", draft.enrollmentInfo?.term);
    setField("review-adviserName", draft.enrollmentInfo?.adviserName);

    // Programs dropdown
    const programSelect = document.getElementById("review-program");
    if (programSelect && draft.enrollmentInfo?.program) {
      const val = draft.enrollmentInfo.program;
      const opt = document.createElement("option");
      programSelect.replaceChildren();
      opt.value = typeof val === "object" ? (val.value || "") : val;
      opt.textContent = opt.value;
      opt.selected = true;
      programSelect.appendChild(opt);
    }

    // Subjects
    renderSubjectList(draft.subjects || []);
  }

  function setField(id, fieldObj) {
    const el = document.getElementById(id);
    if (!el || !fieldObj) return;
    // Handle both full ({value, ...}) and compact (plain value) draft formats
    el.value = (typeof fieldObj === "object" && fieldObj !== null && "value" in fieldObj) ? (fieldObj.value || "") : (fieldObj || "");
  }

  function renderSubjectList(subjects) {
    const container = document.getElementById("subject-list");
    const countEl = document.getElementById("subject-count");
    if (!container) return;
    container.innerHTML = "";
    countEl.textContent = subjects.length;

    // Helper: extract value from full ({value, ...}) or compact (plain value) format
    const fv = (v) => (v && typeof v === "object" && "value" in v) ? v.value : (v || "");

    subjects.forEach((s, idx) => {
      const card = document.createElement("div");
      card.className = "subject-card";

      const scheduleHtml = (s.schedule || []).map((m) => {
        const day = fv(m.day);
        const start = fv(m.time?.start) || m.startTime || "";
        const end = fv(m.time?.end) || m.endTime || "";
        const room = fv(s.room);
        return `<div class="subject-schedule-row">
          <span class="subject-day">${esc(day)}</span>
          <span>${esc(start)}${end ? " \u2013 " + esc(end) : ""}</span>
          ${room ? `<span style="margin-left:auto;color:var(--muted,#5F6368)">${esc(room)}</span>` : ""}
        </div>`;
      }).join("");

      const conf = s.confidence || "medium";
      const confClass = conf === "high" ? "confidence-high" : conf === "low" ? "confidence-low" : "confidence-medium";

      card.innerHTML = `
        <div class="subject-header">
          <span class="subject-code">${esc(fv(s.subjectCode))}</span>
          <span class="review-confidence ${confClass}">${esc(conf)}</span>
          ${fv(s.units) ? `<span class="subject-units">${esc(fv(s.units))} units</span>` : ""}
        </div>
        <div class="subject-name">${esc(fv(s.subjectName))}</div>
        <div class="subject-schedule">${scheduleHtml || "<em>No schedule detected</em>"}</div>
      `;
      container.appendChild(card);
    });
  }

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ── Save corrections ────────────────────────────────────────────────── */
  window.saveAndConfirm = async function () {
    const reviewError = document.getElementById("review-error");
    reviewError.classList.remove("visible");
    const saveBtn = document.getElementById("review-save-btn");
    if (saveBtn?.disabled) return;

    // Gather form values
    const studentInfo = {
      studentNumber: { value: getVal("review-studentNumber"), confidence: "high" },
      firstName: { value: getVal("review-firstName"), confidence: "high" },
      middleName: { value: getVal("review-middleName"), confidence: "high" },
      lastName: { value: getVal("review-lastName"), confidence: "high" },
      suffix: { value: getVal("review-suffix"), confidence: "high" },
    };

    if (!studentInfo.firstName.value || !studentInfo.lastName.value || !studentInfo.studentNumber.value) {
      reviewError.textContent = "Student number, first name, and last name are required.";
      reviewError.classList.add("visible");
      return;
    }

    const enrollmentInfo = {
      program: { value: getVal("review-program"), confidence: "high" },
      campus: { value: getVal("review-campus"), confidence: "high" },
      yearLevel: { value: getVal("review-yearLevel"), confidence: "high" },
      section: { value: getVal("review-section"), confidence: "high" },
      term: { value: getVal("review-term"), confidence: "high" },
      adviserName: { value: getVal("review-adviserName"), confidence: "high" },
    };

    if (!enrollmentInfo.program.value || !enrollmentInfo.yearLevel.value || !enrollmentInfo.term.value) {
      reviewError.textContent = "Program, year level, and term are required.";
      reviewError.classList.add("visible");
      return;
    }

    // Subjects from draft (user can't edit individual subjects in this simplified version,
    // but we preserve the draft subjects so they can confirm them)
    // Handle both full ({value, ...}) and compact (plain value) draft formats
    const fv = (v) => (v && typeof v === "object" && "value" in v) ? v.value : (v || "");
    const fc = (v) => (v && typeof v === "object" && "value" in v) ? (v.confidence || "high") : "high";
    const subjects = (draftResult?.subjects || []).map((s) => ({
      subjectCode: { value: fv(s.subjectCode), confidence: fc(s.subjectCode) },
      subjectName: { value: fv(s.subjectName), confidence: fc(s.subjectName) },
      units: { value: fv(s.units), confidence: fc(s.units) },
      schedule: (s.schedule || s.meetings || []).map((m) => ({
        day: { value: fv(m.day) || fv(m.dayOfWeek), confidence: fc(m.day) },
        time: m.time || { start: m.startTime, end: m.endTime },
      })),
      room: s.room || {},
      matchedSubjectId: s.matchedSubjectId || null,
    }));

    if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add("btn-spinner"); }
    try {
      const resp = await request("/api/v1/cor/review", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentInfo, enrollmentInfo, subjects, draft: draftResult }),
      });
      const data = await resp.json();

      if (data.status === "OK") {
        draftResult = { ...draftResult, studentInfo, enrollmentInfo, subjects };
        cacheDraft();
        // Build confirmation summary
        buildConfirmSummary(studentInfo, enrollmentInfo, subjects);
        goToStep("confirm");
      } else {
        reviewError.textContent = data.error || "Could not save corrections.";
        reviewError.classList.add("visible");
      }
    } catch (err) {
      if (err.sessionExpired) { pauseRecovery(err.message, true); return; }
      reviewError.textContent = "Your corrections could not be confirmed as saved. They are still in this form; reconnect and try again.";
      reviewError.classList.add("visible");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove("btn-spinner"); }
    }
  };

  function getVal(id) {
    return (document.getElementById(id)?.value || "").trim();
  }

  /* ── Confirmation summary ────────────────────────────────────────────── */
  function buildConfirmSummary(si, ei, subjects) {
    const container = document.getElementById("confirm-summary");
    if (!container) return;

    const rows = [
      ["Student Number", si.studentNumber.value],
      ["Name", [si.firstName.value, si.middleName.value, si.lastName.value, si.suffix.value].filter(Boolean).join(" ")],
      ["Program", ei.program.value],
      ["Year Level", ei.yearLevel.value ? ei.yearLevel.value + (suffixFor(Number(ei.yearLevel.value)) + " Year") : ""],
      ["Section", ei.section.value || "\u2014"],
      ["Term", ei.term.value || "\u2014"],
      ["Adviser", ei.adviserName.value || "\u2014"],
      ["Subjects", subjects.length + " total"],
    ];

    container.innerHTML = rows
      .map(([label, value]) => `<div class="confirm-summary-row"><span class="confirm-summary-label">${label}</span><span class="confirm-summary-value">${esc(value || "\u2014")}</span></div>`)
      .join("");
  }

  function suffixFor(n) {
    if (n === 1) return "st";
    if (n === 2) return "nd";
    if (n === 3) return "rd";
    return "th";
  }

  /* ── Confirm and activate ────────────────────────────────────────────── */
  window.confirmAndActivate = async function () {
    const btn = document.getElementById("confirm-btn");
    if (btn.disabled) return;
    document.getElementById("confirm-error").classList.remove("visible");
    btn.disabled = true;
    btn.classList.add("btn-spinner");
    const label = btn.querySelector(".btn-label");
    if (label) label.textContent = "Activating...";

    try {
      const resp = await request("/api/v1/cor/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corRecordId, draft: draftResult }),
      });
      const data = await resp.json();

      if (data.status === "COMPLETE") {
        clearUploadRequest();
        try { sessionStorage.removeItem("qcu-cor-draft"); } catch (_) {}
        goToStep("success");
        // Auto-redirect after 3 seconds
        setTimeout(() => { window.location.href = "/"; }, 3000);
      } else if (resp.status >= 500 || data.status === 'SERVICE_UNAVAILABLE') {
        await recoverUpload();
        btn.disabled = false;
        btn.classList.remove('btn-spinner');
      } else {
        const errEl = document.getElementById("confirm-error");
        errEl.textContent = data.error || "Could not activate. Please try again.";
        errEl.classList.add("visible");
        btn.disabled = false;
        btn.classList.remove("btn-spinner");
        if (label) label.textContent = "Confirm and activate";
      }
    } catch (err) {
      await recoverUpload(err);
      btn.disabled = false;
      btn.classList.remove("btn-spinner");
      if (label) label.textContent = "Confirm and activate";
    }
  };

  /* ── Boot ────────────────────────────────────────────────────────────── */
  init();
})();
