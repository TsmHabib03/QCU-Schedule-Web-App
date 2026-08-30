/* =============================================================
   status.js — Home "Today in Quezon City" panel
   Weather (Open-Meteo, keyless) + reliable Class-Suspension engine.
   Loaded ONLY on index.html. Mirrors the eta.js page-script pattern.

   NO API KEY: Open-Meteo requires none, so nothing is hardcoded or
   exposed in frontend source (honors the no-key constraint).

   SUSPENSION DATA — data/suspensions.json (normalized feed). Because a
   static frontend cannot fetch quezoncity.gov.ph directly (no CORS/JSON
   API — the page is server-rendered HTML), the feed is kept current by
   an out-of-band job (GitHub Action / proxy) that reads the OFFICIAL QC
   announcements page and writes normalized objects. Nothing is ever
   fabricated. A fetch failure becomes UNKNOWN — NEVER "no suspension".

   Feed object shape (all optional except a suspension-like title/body):
     {
       "title": "Walang Pasok: Afternoon Face-to-Face Classes – August 17, 2026",
       "body":  "…full announcement text…",
       "effectiveDate": "2026-08-17",   // when the suspension applies
       "publishedAt":   "2026-08-17",   // when it was announced
       "reason": "Continued heavy rain",
       "source": "Quezon City Government",
       "sourceUrl": "https://quezoncity.gov.ph/news-and-media/announcements/",
       "active": true                   // optional hard override for "today"
     }
   Period / modality / education-level / QCU-coverage are PARSED from
   title+body — see the SUSPENSION ENGINE section. The engine is
   schedule-aware: it matches the suspended window against the user's
   real class times to decide SUSPENDED / PARTIALLY_AFFECTED / NOT.
   ============================================================= */
(function () {
  "use strict";

  var CFG = Object.assign({
    // QCU San Bartolome main campus coordinates, shared with the flood proxy.
    lat: 14.7001, lon: 121.0343, place: "QCU San Bartolome",
    weatherTtlMin: 15,
    suspFeed: "/api/suspensions",
    suspFeedFallback: "data/suspensions.json",
    scheduleFeed: "data/schedule.json",
    // Google Flood Forecasting API (the engine behind Google Flood Hub),
    // proxied server-side at /api/flood. Key-gated (GOOGLE_FLOOD_KEY in the
    // Pages dashboard); the proxy returns a non-OK status until configured,
    // so the client falls back to the rainfall-derived estimate — never a
    // fabricated "no flood risk".
    floodFeed: "/api/flood",
    floodFeedFallback: "data/flood.json",
    debug: false,
    /* Time windows (Asia/Manila, 24h "HH:MM") — single source of truth,
       no scattered magic numbers. Afternoon spans noon→6pm. */
    windows: {
      MORNING:   { start: "00:00", end: "12:00", label: "Morning" },
      AFTERNOON: { start: "12:00", end: "18:00", label: "Afternoon" },
      EVENING:   { start: "18:00", end: "23:59", label: "Evening" }
    },
    officialLinks: [
      { label: "QC Government", url: "https://quezoncity.gov.ph/news-and-media/announcements/" },
      { label: "QCU", url: "https://qcu.edu.ph" }
    ]
  }, window.QCU_STATUS_CONFIG || {});
  var root = document.getElementById("home-status");
  if (!root) return; // Guard: only run on the Home page.

  var CACHE_KEY = "qcu-weather-cache";
  var WEATHER_VIEW_KEY = "qcu-weather-view";
  var weatherView = "campus";
  try {
    var savedWeatherView = localStorage.getItem(WEATHER_VIEW_KEY);
    if (savedWeatherView === "user" || savedWeatherView === "campus") weatherView = savedWeatherView;
  } catch (e) { /* local storage may be unavailable */ }

  function dbg() {
    if (CFG.debug && window.console && console.log)
      console.log.apply(console, ["[QCU-STATUS]"].concat([].slice.call(arguments)));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function iconify() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }

  /* --- Manila-local date/time helpers (no scattered magic numbers) --- */
  function manilaToday() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  // Minutes-since-midnight, Asia/Manila (used for schedule-window matching).
  function manilaNowMin() {
    try {
      var p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      return toMin(p);
    } catch (e) { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  }
  // Manila weekday name ("Monday"…) for schedule lookup.
  function manilaWeekday() {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long" }).format(new Date()); }
    catch (e) { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()]; }
  }
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    var h = +m[1], mm = +m[2];
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  // "August 17, 2026" | "Aug 17 2026" | "17 August 2026" -> "YYYY-MM-DD" | null
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseDatePhrase(text, todayStr) {
    var t = String(text || "").toLowerCase();
    if (/\b(bukas|tomorrow)\b/.test(t)) return addDays(todayStr, 1);
    if (/\b(ngayong araw|ngayon|today|this afternoon|this morning|ngayong hapon|ngayong umaga)\b/.test(t)) return todayStr;
    var m = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(t);           // Month DD, YYYY
    if (m && MONTHS[m[1].slice(0, 3)]) return iso(m[3], MONTHS[m[1].slice(0, 3)], m[2]);
    m = /\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/.exec(t);                  // DD Month YYYY
    if (m && MONTHS[m[2].slice(0, 3)]) return iso(m[3], MONTHS[m[2].slice(0, 3)], m[1]);
    m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);                                // ISO
    if (m) return m[0];
    return null;
  }
  function iso(y, mo, d) { return y + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (+d < 10 ? "0" + d : d); }

  /* =============================================================
     WEATHER (Open-Meteo, keyless) — WMO code → label/icon/severity.
     severity 0 clear · 1 cloud · 2 light rain · 3 rain · 4 severe.
     ============================================================= */
  var WMO = {
    0: ["Clear sky", "sun", 0], 1: ["Mainly clear", "sun", 0], 2: ["Partly cloudy", "cloud-sun", 1],
    3: ["Overcast", "cloud", 1], 45: ["Fog", "cloud-fog", 1], 48: ["Rime fog", "cloud-fog", 1],
    51: ["Light drizzle", "cloud-drizzle", 2], 53: ["Drizzle", "cloud-drizzle", 2], 55: ["Dense drizzle", "cloud-drizzle", 2],
    56: ["Freezing drizzle", "cloud-drizzle", 2], 57: ["Freezing drizzle", "cloud-drizzle", 2],
    61: ["Light rain", "cloud-rain", 2], 63: ["Rain", "cloud-rain", 3], 65: ["Heavy rain", "cloud-rain-wind", 4],
    66: ["Freezing rain", "cloud-rain", 3], 67: ["Freezing rain", "cloud-rain-wind", 4],
    71: ["Light snow", "cloud-snow", 2], 73: ["Snow", "cloud-snow", 3], 75: ["Heavy snow", "cloud-snow", 4],
    77: ["Snow grains", "cloud-snow", 2], 80: ["Rain showers", "cloud-rain", 3], 81: ["Rain showers", "cloud-rain", 3],
    82: ["Violent showers", "cloud-rain-wind", 4], 85: ["Snow showers", "cloud-snow", 3], 86: ["Snow showers", "cloud-snow", 4],
    95: ["Thunderstorm", "cloud-lightning", 4], 96: ["Thunderstorm w/ hail", "cloud-lightning", 4], 99: ["Severe thunderstorm", "cloud-lightning", 4]
  };
  function wmo(code) { return WMO[code] || ["Unknown", "cloud", 1]; }
  // Uppercase institutional status label, e.g. "RAIN EXPECTED".
  function weatherStatusLabel(code, pop) {
    var sev = wmo(code)[2];
    if (sev >= 4) return "SEVERE WEATHER";
    if (sev === 3) return "RAIN EXPECTED";
    if (sev === 2) return (pop != null && pop >= 50) ? "RAIN LIKELY" : "LIGHT RAIN";
    if (sev === 1) return "CLOUDY";
    return "FAIR WEATHER";
  }
  function weatherSevClass(code) {
    var sev = wmo(code)[2];
    return sev >= 4 ? "sev-severe" : sev === 3 ? "sev-high" : sev === 2 ? "sev-mod" : sev === 1 ? "sev-low" : "sev-clear";
  }
  // Weather-based advisory ONLY. NEVER an official suspension signal.
  function computeRisk(code, pop) {
    var sev = wmo(code)[2];
    var p = (pop == null ? 0 : pop);
    if (sev >= 4) return "SEVERE";
    if (sev >= 3 && p >= 60) return "HIGH";
    if (sev >= 3 || (sev >= 2 && p >= 70)) return "MODERATE";
    return "LOW";
  }

  /* =============================================================
     SUSPENSION ENGINE
     Structured, schedule-aware, source-prioritized. A false
     "No Suspension" is worse than "Unavailable", so on any doubt we
     lean toward flagging, never toward silently clearing.
     ============================================================= */
  var STATUS = {
    SUSPENDED: "SUSPENDED", NOT_SUSPENDED: "NOT_SUSPENDED",
    PARTIALLY_AFFECTED: "PARTIALLY_AFFECTED", PENDING: "PENDING", UNKNOWN: "UNKNOWN"
  };

  // Broad multi-phrasing detector (English + Filipino), title AND body.
  // `suspen[ds]\w*` deliberately covers BOTH stems — the verb (suspend /
  // suspended / suspends) and the noun (suspension / suspensions). Matching only
  // "suspend" silently missed the way QC actually titles most notices
  // ("Suspension of Afternoon Face-to-Face Classes", "Class Suspension"), which
  // rendered a confident "no suspension" on days classes were in fact called
  // off — the one failure this engine exists to prevent. The two generic
  // alternatives read in both directions (suspension…class, class…suspension)
  // and `[^.!?]` keeps a match inside a single sentence so unrelated
  // announcements ("Suspension of Water Service …") do not trip it.
  var SUSP_RE = /(walang\s+pasok|walang\s+klase|holiday\s+for\s+all\s+school|cancellation\s+of\s+class|classes?\s+cancel|no\s+class(?:es)?|suspen[ds]\w*\b[^.!?]{0,40}?\bclass|\bclass(?:es)?\b[^.!?]{0,25}?\bsuspen[ds])/i;
  function looksLikeSuspension(text) { return SUSP_RE.test(String(text || "")); }

  // Period → which window (in minutes) the suspension covers.
  function detectPeriod(text) {
    var t = String(text || "").toLowerCase(), w = CFG.windows;
    var out = function (name, key) { return { period: name, startMin: toMin(w[key].start), endMin: toMin(w[key].end) }; };
    if (/\b(all[-\s]?day|whole\s+day|entire\s+day|buong\s+araw|full\s+day)\b/.test(t))
      return { period: "ALL_DAY", startMin: 0, endMin: 1439 };
    var morning = /\b(morning|a\.?m\.?|umaga|ngayong\s+umaga)\b/.test(t);
    var afternoon = /\b(afternoon|p\.?m\.?|hapon|ngayong\s+hapon|noon\s+onwards?|12\s*(?:noon|nn))\b/.test(t);
    var evening = /\b(evening|night|gabi)\b/.test(t);
    if (afternoon && !morning) return out("AFTERNOON", "AFTERNOON");
    if (morning && !afternoon && !evening) return out("MORNING", "MORNING");
    if (evening && !morning && !afternoon) return out("EVENING", "EVENING");
    // Unspecified period → assume ALL_DAY (safer: never under-report). Confidence lowered elsewhere.
    return { period: "UNKNOWN", startMin: 0, endMin: 1439 };
  }

  // Modality: a face-to-face suspension does NOT stop online classes.
  function detectModality(text) {
    var t = String(text || "").toLowerCase();
    if (/(face-?to-?face|f2f|in-?person|on-?site|onsite|physical\s+class)/.test(t)) return "FACE_TO_FACE";
    if (/(online|distance\s+learning|modular|asynchronous|remote)\s+class(?:es)?\s+(?:are\s+)?suspend/.test(t)) return "ONLINE";
    return "ALL"; // No modality qualifier → all modalities affected.
  }

  // Education levels present in the text.
  function detectLevels(text) {
    var t = String(text || "").toLowerCase();
    return {
      qcu: /\bqcu\b|quezon\s+city\s+university/.test(t),
      kinder: /\bkinder|kindergarten|pre-?school\b/.test(t),
      elem: /\belementary|grade\s*school|grades?\s*[1-6]\b/.test(t),
      jhs: /\bjunior\s+high|jhs|grades?\s*7-?10\b/.test(t),
      shs: /\bsenior\s+high|shs|grades?\s*11-?12\b/.test(t),
      college: /\bcollege|tertiary|university|universities|higher\s+education|\bhei\b/.test(t),
      allK12: /\b(all\s+levels|all\s+school|public\s+and\s+private\s+school|basic\s+education|elementary\s+and\s+(?:junior|senior)?\s*high)\b/.test(t),
      all: /\ball\s+levels\b/.test(t)
    };
  }
  // Does this announcement cover QCU (a tertiary/HEI)? → true | false | "maybe"
  function coversQcu(lv) {
    if (lv.qcu) return true;
    if (lv.all || lv.college) return true;
    // K-12-only announcement (elem/jhs/shs/kinder, no college/all) → does NOT cover QCU.
    if ((lv.kinder || lv.elem || lv.jhs || lv.shs || lv.allK12) && !lv.college && !lv.all) return false;
    return "maybe"; // Level unspecified → cannot rule QCU out; verify.
  }
  function levelLabel(lv) {
    if (lv.qcu) return "QCU (named)";
    if (lv.all) return "All levels";
    if (lv.college) return "College / tertiary";
    if (lv.allK12 || lv.kinder || lv.elem || lv.jhs || lv.shs) {
      var parts = [];
      if (lv.kinder) parts.push("Kinder"); if (lv.elem) parts.push("Elementary");
      if (lv.jhs) parts.push("JHS"); if (lv.shs) parts.push("SHS");
      return parts.length ? parts.join(" · ") : "Basic education (K–12)";
    }
    return "Not specified";
  }

  // Resolve when a suspension APPLIES (not when it was posted).
  function resolveEffectiveDate(a, todayStr) {
    if (a && a.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(a.effectiveDate)) return a.effectiveDate;
    if (a && a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) return a.date; // backward-compat
    var fromText = parseDatePhrase((a && a.title || "") + " " + (a && a.body || ""), todayStr);
    if (fromText) return fromText;
    if (a && a.active === true) return todayStr; // hard override implies "today"
    return null; // unknown → handled as low-confidence "today" by caller
  }

  // Normalize a raw feed item into the engine's internal shape.
  function normalizeAnnouncement(a, todayStr) {
    var text = (a.title || "") + "\n" + (a.body || "");
    var per = detectPeriod(text);
    var lv = detectLevels(text);
    var eff = resolveEffectiveDate(a, todayStr);
    return {
      raw: a,
      title: a.title || "Class suspension announcement",
      body: a.body || "",
      text: text,
      effectiveDate: eff,
      publishedAt: (a.publishedAt || a.date || null),
      period: per.period, startMin: per.startMin, endMin: per.endMin,
      modality: detectModality(text),
      levels: lv,
      levelLabel: levelLabel(lv),
      coversQcu: coversQcu(lv),
      reason: a.reason || null,
      source: a.source || "Official announcement",
      sourceUrl: a.sourceUrl || (CFG.officialLinks[0] && CFG.officialLinks[0].url),
      scope: a.scope || (lv.qcu ? "Institution (QCU)" : (a.source && /national|deped|ched|pagasa/i.test(a.source) ? "National" : "Citywide"))
    };
  }
  // Relevance priority for conflict resolution among same-day items:
  // QCU-named > All-levels/HEI/college > unspecified > K-12-only.
  function priority(n) {
    if (n.coversQcu === true && n.levels.qcu) return 4;
    if (n.coversQcu === true) return 3;
    if (n.coversQcu === "maybe") return 2;
    return 1; // K-12-only (does not cover QCU)
  }

  // Choose the governing announcement for today + the nearest upcoming one.
  function pickAnnouncement(list, todayStr) {
    var norm = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || typeof a !== "object") continue;
      var text = (a.title || "") + " " + (a.body || "");
      if (!looksLikeSuspension(text) && a.active !== true) continue; // not a suspension item
      norm.push(normalizeAnnouncement(a, todayStr));
    }
    var active = [], upcoming = [];
    for (var j = 0; j < norm.length; j++) {
      var n = norm[j], eff = n.effectiveDate;
      if (eff == null) { active.push(n); continue; }      // undated but suspension-like → treat as today (verify)
      if (eff === todayStr || n.raw.active === true) active.push(n);
      else if (eff > todayStr) upcoming.push(n);          // future → PENDING
      // eff < todayStr → expired, silently dropped
    }
    active.sort(function (x, y) { return priority(y) - priority(x); });
    upcoming.sort(function (x, y) { return String(x.effectiveDate).localeCompare(String(y.effectiveDate)); });
    return { active: active[0] || null, upcoming: upcoming[0] || null, activeCount: active.length };
  }

  // Decide what one class means under the active notice — time-overlap AND
  // modality aware. Returns { status, note, overlap }:
  //   PROCEEDS     — no time overlap, OR an online-only suspension against a
  //                  physical (face-to-face) class.
  //   ONLINE_ONLY  — a face-to-face suspension overlaps the class: the in-person
  //                  session is off, but online/async work may proceed.
  //   SUSPENDED    — an all-modality (or whole-day) suspension overlaps the class,
  //                  OR an online-only suspension overlaps an online class.
  // Never fabricates a session that isn't scheduled — notes are framed as
  // "may proceed / confirm with your instructor."
  function evaluateClassStatus(cl, n) {
    var oStart = Math.max(cl.start, n.startMin), oEnd = Math.min(cl.end, n.endMin);
    var overlap = oEnd > oStart;
    if (!overlap) return { status: "PROCEEDS", note: null, overlap: false };

    var isPhysical = !!(cl.room || cl.building);
    var partial = !(cl.start >= n.startMin && cl.end <= n.endMin);
    var win = windowWord(n.period);
    var winPhrase = win ? " for the " + win + " period" : "";
    var partWord = partial ? " Your class only partly falls within the suspended window." : "";

    if (n.modality === "ONLINE") {
      // Only online sessions are suspended → a face-to-face class is unaffected.
      if (isPhysical) return { status: "PROCEEDS", note: null, overlap: true };
      return { status: "SUSPENDED", note: "Online sessions are suspended" + winPhrase + "." + partWord, overlap: true };
    }
    if (n.modality === "FACE_TO_FACE") {
      return {
        status: "ONLINE_ONLY",
        note: "In-person (face-to-face) session suspended" + winPhrase +
          " — online/asynchronous work may proceed; confirm with your instructor." + partWord,
        overlap: true
      };
    }
    // ALL modality (or unspecified) → the whole class is suspended.
    return { status: "SUSPENDED", note: "Classes are suspended" + winPhrase + "." + partWord, overlap: true };
  }

  // Match today's real class times against the suspended window.
  // Returns per-class verdicts + aggregate flags. Overlap = affected.
  function matchSchedule(n, schedule, todayStr) {
    var day = manilaWeekday();
    var todays = [];
    if (Array.isArray(schedule)) {
      for (var i = 0; i < schedule.length; i++) {
        var c = schedule[i];
        if (!c || c.day !== day || c.noClasses) continue;
        var s = toMin(c.start), e = toMin(c.end);
        if (s == null || e == null) continue;
        todays.push({
          start: s, end: e, subject: c.subject || c.code || "Class",
          course: c.course || "", code: c.code || "",
          room: c.room || "", building: c.building || ""
        });
      }
    }
    todays.sort(function (a, b) { return a.start - b.start; });
    var classes = [], nSusp = 0, nOnline = 0;
    for (var k = 0; k < todays.length; k++) {
      var cl = todays[k];
      var ev = evaluateClassStatus(cl, n);
      if (ev.status === "SUSPENDED") nSusp++;
      else if (ev.status === "ONLINE_ONLY") nOnline++;
      classes.push({
        subject: cl.subject, course: cl.course, code: cl.code,
        start: cl.start, end: cl.end, room: cl.room, building: cl.building,
        verdict: ev.status, note: ev.note
      });
    }
    return { day: day, classes: classes, total: todays.length, suspended: nSusp, onlineOnly: nOnline, affected: nSusp + nOnline };
  }

  // MAIN: structured suspension status for QCU.
  // list === undefined  → fetch/network failure → UNKNOWN (NEVER not-suspended).
  // list === []         → feed loaded, no items → NOT_SUSPENDED (+ optional weather advisory).
  function getQcuSuspensionStatus(list, schedule, weatherRisk) {
    var today = manilaToday();
    var base = {
      status: STATUS.UNKNOWN, headline: "", scope: null, affectedLevel: null,
      period: null, modality: null, reason: null, publishedAt: null, effectiveDate: null,
      source: null, sourceUrl: (CFG.officialLinks[0] && CFG.officialLinks[0].url),
      confidence: "low", coversQcu: null, classes: null, note: null,
      weatherRisk: weatherRisk || null, checkedAt: today
    };

    if (typeof list === "undefined") {
      base.status = STATUS.UNKNOWN;
      base.note = "Suspension source is temporarily unavailable — this is NOT a confirmation that classes are on. Please verify with the official channels below.";
      dbg("status=UNKNOWN (feed unavailable)");
      return base;
    }
    if (!Array.isArray(list)) list = [];

    var pick = pickAnnouncement(list, today);
    var n = pick.active;

    if (!n) {
      // No active official suspension. Weather may add an ADVISORY, never a status.
      base.status = STATUS.NOT_SUSPENDED;
      base.confidence = "high";
      if (pick.upcoming) {
        base.status = STATUS.PENDING;
        base.headline = "Upcoming suspension announced";
        base.effectiveDate = pick.upcoming.effectiveDate;
        base.scope = pick.upcoming.scope;
        base.affectedLevel = pick.upcoming.levelLabel;
        base.period = pick.upcoming.period;
        base.modality = pick.upcoming.modality;
        base.reason = pick.upcoming.reason;
        base.source = pick.upcoming.source;
        base.sourceUrl = pick.upcoming.sourceUrl;
        base.publishedAt = pick.upcoming.publishedAt;
        base.title = pick.upcoming.title;
        base.levels = pick.upcoming.levels;
        base.confidence = "medium";
      }
      dbg("status=" + base.status + " (no active suspension today)");
      return base;
    }

    // We have an active, suspension-like official item today.
    base.scope = n.scope; base.affectedLevel = n.levelLabel; base.period = n.period;
    base.modality = n.modality; base.reason = n.reason; base.source = n.source;
    base.sourceUrl = n.sourceUrl; base.publishedAt = n.publishedAt;
    base.effectiveDate = n.effectiveDate || today; base.coversQcu = n.coversQcu;
    base.title = n.title; base.levels = n.levels;

    if (n.coversQcu === false) {
      // Real announcement, but K-12 only → QCU classes proceed.
      base.status = STATUS.NOT_SUSPENDED;
      base.headline = "Suspension does not cover QCU";
      base.confidence = "high";
      base.note = "An official suspension is in effect for " + n.levelLabel + ", which does not include QCU (a university). QCU classes are not covered by this notice.";
      dbg("status=NOT_SUSPENDED (K-12 only, QCU not covered)");
      return base;
    }

    // Covers QCU (true) or unspecified ("maybe"). Go schedule-aware.
    var sched = matchSchedule(n, schedule, today);
    base.classes = sched.classes;
    var confMaybe = (n.coversQcu === "maybe");
    base.confidence = confMaybe ? "medium" : (n.period === "UNKNOWN" ? "medium" : "high");

    if (sched.total === 0) {
      base.status = STATUS.SUSPENDED;
      base.headline = "Class suspension in effect";
      base.note = "You have no classes scheduled today (" + sched.day + ")." + (confMaybe ? " Education level was not stated in the announcement — verify QCU coverage below." : "");
    } else if (sched.affected === 0) {
      base.status = STATUS.NOT_SUSPENDED;
      base.headline = "Suspension does not overlap your classes";
      base.note = "A " + windowWord(n.period) + " suspension is in effect, but none of your classes today (" + sched.day + ") fall in that window.";
    } else if (sched.suspended === 0 && sched.onlineOnly > 0) {
      // Only in-person sessions are affected; online/async may proceed.
      base.status = STATUS.PARTIALLY_AFFECTED;
      base.headline = "Face-to-face classes affected";
    } else if (sched.suspended === sched.total) {
      base.status = STATUS.SUSPENDED;
      base.headline = "Class suspension in effect";
    } else {
      base.status = STATUS.PARTIALLY_AFFECTED;
      base.headline = "Some classes affected";
    }
    if (n.modality === "FACE_TO_FACE" && base.status !== STATUS.NOT_SUSPENDED)
      base.note = (base.note ? base.note + " " : "") + "Applies to FACE-TO-FACE classes — online/asynchronous sessions may proceed unless told otherwise.";
    if (confMaybe && base.status !== STATUS.NOT_SUSPENDED)
      base.note = (base.note ? base.note + " " : "") + "Education level not stated — confirm QCU is covered via the official links.";
    dbg("status=" + base.status, "period=" + n.period, "modality=" + n.modality, "coversQcu=" + n.coversQcu, sched);
    return base;
  }
  function windowWord(period) {
    return period === "MORNING" ? "morning" : period === "AFTERNOON" ? "afternoon" :
      period === "EVENING" ? "evening" : period === "ALL_DAY" ? "whole-day" : "";
  }

  /* =============================================================
     USER LOCATION — the home status widget's own "use my location"
     control persists the device's GPS fix to localStorage
     ("qcu:user-location"). Weather + flood advisories center on that
     real location so they reflect where the student actually is. If no
     recent fix exists (never granted, or the reading is stale/invalid),
     fall back to the campus coordinate.
     ============================================================= */
  var LOC_KEY = "qcu:user-location";
  var LOC_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — older fixes are dropped.
  function getUserLocation() {
    try {
      var raw = localStorage.getItem(LOC_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return null;
      if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
      if (p.t && (Date.now() - p.t) > LOC_MAX_AGE_MS) return null; // stale
      return { lat: p.lat, lon: p.lon, live: true };
    } catch (e) { return null; }
  }

  /* =============================================================
     FETCHERS — every remote call fails soft. A failed suspension
     fetch yields `undefined` (→ UNKNOWN), never `[]` (→ not-suspended).
     ============================================================= */
  function fetchWeather(loc) {
    loc = loc || { lat: CFG.lat, lon: CFG.lon };
    // Cache per rounded location (~1km) so moving invalidates stale weather.
    var cacheKey = CACHE_KEY + ":" + loc.lat.toFixed(2) + "," + loc.lon.toFixed(2);
    try {
      var raw = localStorage.getItem(cacheKey);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.t && (Date.now() - c.t) < CFG.weatherTtlMin * 60000 && c.data) {
          dbg("weather from cache"); return Promise.resolve(c.data);
        }
      }
    } catch (e) { /* ignore cache errors */ }
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation" +
      "&hourly=precipitation_probability&timezone=Asia%2FManila&forecast_days=2";
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("weather HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var cur = j.current || {};
      var pop = null;
      try {
        var hrs = j.hourly && j.hourly.time || [], probs = j.hourly && j.hourly.precipitation_probability || [];
        // API timestamps use Asia/Manila. Comparing against UTC ISO time shifts
        // the selected hour and makes rain chance inaccurate by eight hours.
        var apiNow = String(cur.time || "").slice(0, 13);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(apiNow)) {
          apiNow = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false
          }).format(new Date()).replace(" ", "T");
        }
        for (var i = 0; i < hrs.length; i++) {
          if (String(hrs[i]).slice(0, 13) >= apiNow) { pop = probs[i]; break; }
        }
        if (pop == null && probs.length) pop = probs[0];
      } catch (e) { /* ignore */ }
      var data = {
        temp: cur.temperature_2m, feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
        code: cur.weather_code, precip: cur.precipitation, pop: pop
      };
      try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: data })); } catch (e) {}
      return data;
    }).catch(function (e) { dbg("weather failed", e); return null; });
  }
  // Returns array on success, [] for empty feed, undefined on failure.
  // Primary source is the serverless proxy (/api/suspensions) which scrapes the
  // live QC announcements page; if that is unreachable (local file://, function
  // down) we fall back to the static bundled JSON before giving up → UNKNOWN.
  function fetchSuspensions() {
    return fetchSuspFrom(CFG.suspFeed).catch(function (e) {
      dbg("primary suspensions feed failed → trying fallback", e);
      if (!CFG.suspFeedFallback) throw e;
      return fetchSuspFrom(CFG.suspFeedFallback);
    }).catch(function (e) { dbg("suspensions fetch FAILED → UNKNOWN", e); return undefined; });
  }
  function fetchSuspFrom(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("susp HTTP " + r.status);
      return r.json();
    }).then(function (j) { return Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []); });
  }
  function fetchSchedule() {
    return fetch(CFG.scheduleFeed, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("schedule HTTP " + r.status);
      return r.json();
    }).then(function (j) { return Array.isArray(j) ? j : []; })
      .catch(function (e) { dbg("schedule fetch failed", e); return []; });
  }
  // Live flood signal from the Google Flood Forecasting API (the engine behind
  // Google Flood Hub), proxied server-side at /api/flood. Returns a normalized
  // object { provider:"google", severity, trend, issuedAt, gaugeId, km, source,
  // sourceUrl } — or undefined when Google is unavailable (no key configured /
  // empty / upstream error / network failure). A failed fetch NEVER fabricates:
  // deriveFlood then falls back to the honest rainfall-derived estimate.
  function fetchFlood() {
    var primaryUrl = CFG.floodFeed;
    return fetch(primaryUrl, { cache: "no-store" }).catch(function (e) {
      if (!CFG.floodFeedFallback) throw e;
      return fetch(CFG.floodFeedFallback, { cache: "no-store" }).then(function (fallbackResponse) {
        if (!fallbackResponse.ok) throw new Error("scheduled flood HTTP " + fallbackResponse.status);
        return fallbackResponse;
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("flood HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || j.status !== "OK" || !(j.severity || j.riskLevel)) {
        if (primaryUrl !== CFG.floodFeedFallback && CFG.floodFeedFallback) {
          return fetch(CFG.floodFeedFallback, { cache: "no-store" }).then(function (fallbackResponse) {
            if (!fallbackResponse.ok) throw new Error("scheduled flood HTTP " + fallbackResponse.status);
            return fallbackResponse.json();
          }).then(function (fallback) {
            var fallbackSeverity = fallback && (fallback.severity || fallback.riskLevel);
            if (!fallback || fallback.status !== "OK" || !fallbackSeverity || fallbackSeverity === "UNKNOWN") {
              throw new Error("scheduled flood severity unavailable");
            }
            return {
              provider: "google",
              severity: fallbackSeverity,
              trend: fallback.trend || (fallback.waterLevel && fallback.waterLevel.trend) || null,
              issuedAt: fallback.issuedAt || fallback.publishedAt || null,
              gaugeId: fallback.gaugeId || (fallback.gauge && fallback.gauge.id) || null,
              km: typeof fallback.km === "number" ? fallback.km : (fallback.gauge && typeof fallback.gauge.distanceKm === "number" ? fallback.gauge.distanceKm : null),
              source: fallback.source || "Google Flood Hub",
              sourceUrl: fallback.sourceUrl || "https://sites.research.google/floods/"
            };
          });
        }
        return undefined;
      }
      var severity = j.severity || j.riskLevel;
      return {
        provider: "google",
        severity: severity,
        trend: j.trend || (j.waterLevel && j.waterLevel.trend) || null,
        issuedAt: j.issuedAt || j.publishedAt || null,
        gaugeId: j.gaugeId || (j.gauge && j.gauge.id) || null,
        km: typeof j.km === "number" ? j.km : (j.gauge && typeof j.gauge.distanceKm === "number" ? j.gauge.distanceKm : null),
        source: j.source || "Google Flood Forecasting",
        sourceUrl: j.sourceUrl || "https://sites.research.google/floods/"
      };
    }).catch(function (e) { dbg("google flood unavailable → rainfall-derived fallback", e); return undefined; });
  }

  // Combine the flood signal with live rainfall into one advisory object. When
  // Google Flood Forecasting is available its severity/trend is authoritative
  // (it reflects the nearest river gauge to campus). When it is not, we fall
  // back to the rainfall-derived heuristic — an honest computed estimate, NOT an
  // official flood warning:
  //   ≥15 mm → SEVERE (high) · ≥5 mm → ELEVATED (moderate) · else NONE (low).
  // Returns undefined only when BOTH sources are missing → the calm "Monitoring"
  // state (never "unavailable", never a false "no flood risk").
  function deriveFlood(wx, floodApi) {
    if (floodApi && floodApi.provider === "google") {
      var out = {
        provider: "google",
        riskLevel: floodApi.severity,    // EXTREME | SEVERE | ELEVATED | NONE | UNKNOWN
        source: floodApi.source || "Google Flood Forecasting",
        sourceUrl: floodApi.sourceUrl || "https://developers.google.com/flood-forecasting"
      };
      if (floodApi.trend) out.trend = floodApi.trend;
      if (floodApi.issuedAt) out.issuedAt = floodApi.issuedAt;
      if (floodApi.km != null) out.km = floodApi.km;
      if (wx && typeof wx.precip === "number") out.precip = wx.precip; // supporting only
      return out;
    }
    var hasRain = wx && typeof wx.precip === "number";
    if (!hasRain) return undefined;
    var out = { derived: true, source: "Open-Meteo · rainfall-derived", sourceUrl: "https://open-meteo.com/en/docs/flood-api" };
    out.precip = wx.precip;
    out.riskLevel = wx.precip >= 15 ? "SEVERE" : (wx.precip >= 5 ? "ELEVATED" : "NONE");
    return out;
  }

  /* =============================================================
     HTML BUILDERS — Part A: institutional / public-service styling.
     Weather = compact info panel. Suspension = formal notice table.
     ============================================================= */
  // Weather SEGMENT for one location — returns { sevClass, html }. No card
  // wrapper and no flood (the caller composes those). The place name lives in
  // the card head now, so the old " · place" suffix on .wx-sub is dropped.
  function weatherSegmentHTML(wx) {
    if (!wx || wx.temp == null) {
      return {
        sevClass: "wx-unavail",
        html:
          '<div class="wx-lead">' +
            '<div class="wx-primary"><span class="wx-temp">--</span></div>' +
            '<div class="wx-status-wrap"><span class="wx-status">WEATHER UNAVAILABLE</span>' +
            '<span class="wx-sub">Live data could not be loaded.</span></div>' +
          '</div>'
      };
    }
    var w = wmo(wx.code), label = weatherStatusLabel(wx.code, wx.pop);
    var meta = [];
    if (wx.feels != null) meta.push(["Feels like", Math.round(wx.feels) + "°C"]);
    if (wx.humidity != null) meta.push(["Humidity", Math.round(wx.humidity) + "%"]);
    if (wx.pop != null) meta.push(["Rain chance", Math.round(wx.pop) + "%"]);
    if (wx.precip != null) meta.push(["Precip", (Math.round(wx.precip * 10) / 10) + " mm"]);
    var metaHtml = meta.map(function (m) {
      return '<div class="wx-metric"><span class="wx-metric-k">' + esc(m[0]) + '</span><span class="wx-metric-v">' + esc(m[1]) + '</span></div>';
    }).join("");
    return {
      sevClass: weatherSevClass(wx.code),
      html:
        '<div class="wx-lead">' +
          '<div class="wx-primary"><span class="wx-temp">' + Math.round(wx.temp) + '</span><span class="wx-unit">°C</span>' +
            '<i data-lucide="' + w[1] + '" class="wx-icon"></i></div>' +
          '<div class="wx-status-wrap"><span class="wx-indicator" aria-hidden="true"></span>' +
            '<span class="wx-status">' + esc(label) + '</span>' +
            '<span class="wx-sub">' + esc(w[0]) + '</span></div>' +
        '</div>' +
        (metaHtml ? '<div class="wx-metrics">' + metaHtml + '</div>' : '')
    };
  }

  // Flood Advisory sub-widget, rendered INSIDE the weather card. Google Flood
  // Forecasting (via the /api/flood proxy) is authoritative: its risk LEVEL and
  // nearest-gauge trend/issued time come straight from the gauge, with live
  // rainfall shown as supporting context. When Google is unavailable the
  // rainfall-derived estimate stands in — an honest computed level, never a
  // fabricated reading. On a total data outage a calm "Monitoring" state shows,
  // never the word "unavailable" and never a false "no flood risk".
  var FLOOD_META = {
    EXTREME:  { cls: "is-extreme",  label: "EXTREME",  chipCls: "flood-chip--red",    icon: "droplets",     severityIcon: "alert-triangle" },
    SEVERE:   { cls: "is-severe",   label: "SEVERE",   chipCls: "flood-chip--red",    icon: "droplets",     severityIcon: "alert-triangle" },
    ELEVATED: { cls: "is-elevated", label: "ELEVATED", chipCls: "flood-chip--amber",  icon: "droplets",     severityIcon: "trending-up" },
    NONE:     { cls: "is-none",     label: "LOW",      chipCls: "flood-chip--blue",   icon: "droplets",     severityIcon: "waves" },
    // Never "unavailable": on a total data outage we show a calm, honest
    // "Monitoring" state — we don't fabricate a LOW reading, but we never
    // alarm or read as an error either.
    UNKNOWN:  { cls: "is-unknown",  label: "MONITORING", chipCls: "flood-chip--slate", icon: "activity",     severityIcon: "activity" }
  };
  var FLOOD_TIP = {
    EXTREME:  "Extreme flood risk reported — avoid flood-prone roads and low-lying areas. Follow PAGASA / QC DRRMO advisories.",
    SEVERE:   "Severe flood risk reported — avoid flood-prone roads and low-lying areas. Follow PAGASA / QC DRRMO advisories.",
    ELEVATED: "Elevated water levels — localized street flooding possible in low-lying areas. Keep an alternate route ready.",
    NONE:     "No active flood risk reported. Keep normal precautions during heavy rain.",
    UNKNOWN:  "Awaiting live flood data — check PAGASA and QC DRRMO before travelling in heavy rain."
  };
  var FLOOD_TREND = { RISING: "Rising", FALLING: "Falling", STABLE: "Stable" };
  var FLOOD_TREND_ICON = { RISING: "trending-up", FALLING: "trending-down", STABLE: "minus" };
  var FLOOD_TREND_CLS = { RISING: "trend--rising", FALLING: "trend--falling", STABLE: "trend--stable" };
  // Issued timestamp in "HH:MM MMM D" format for gauge data.
  function fmtIssuedTime(d) {
    if (!d) return "";
    try {
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return fmtStamp(d);
      var time = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false
      }).format(dt);
      var date = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric"
      }).format(dt);
      return time + " " + date;
    } catch (e) { return fmtStamp(d); }
  }
  // Metric row — label left, value right, separated by a hairline divider.
  function floodMetricRow(label, value) {
    return '<div class="flood-metric">' +
      '<span class="flood-metric-k">' + esc(label) + '</span>' +
      '<span class="flood-metric-v">' + value + '</span>' +
    '</div>';
  }
  // Trend value with inline color-coded icon + text.
  function floodTrendValue(trend) {
    var t = String(trend || "").toUpperCase();
    var icon = FLOOD_TREND_ICON[t];
    var cls = FLOOD_TREND_CLS[t];
    var label = FLOOD_TREND[t] || String(trend || "");
    return (icon
      ? '<span class="flood-trend ' + esc(cls) + '"><i data-lucide="' + icon + '" aria-hidden="true"></i>' + esc(label) + '</span>'
      : esc(label));
  }

  function floodBlockHTML(flood) {
    var lvl = (flood && flood.riskLevel) ? String(flood.riskLevel).toUpperCase() : "UNKNOWN";
    var m = FLOOD_META[lvl] || FLOOD_META.UNKNOWN;
    var isGoogle = !!(flood && flood.provider === "google");
    var isRainfallOnly = !!(flood && flood.derived);

    // ── Header ──
    var headerIcon = isGoogle ? "gauge" : (isRainfallOnly ? "cloud-rain" : m.icon);
    var headerHtml =
      '<div class="flood-header">' +
        '<div class="flood-title-group">' +
          '<i data-lucide="' + headerIcon + '" class="flood-icon" aria-hidden="true"></i>' +
          '<span class="flood-title">Flood Advisory</span>' +
        '</div>' +
        '<span class="flood-chip ' + m.chipCls + '" aria-live="polite">' + esc(m.label) + '</span>' +
      '</div>';

    // ── Gauge section (Google authoritative) ──
    var gaugeHtml = "";
    if (isGoogle) {
      var gaugeMetrics = [];
      if (flood.km != null)
        gaugeMetrics.push(floodMetricRow("Nearest gauge", Math.round(flood.km) + " km"));
      if (flood.trend && FLOOD_TREND[flood.trend])
        gaugeMetrics.push(floodMetricRow("Water trend", floodTrendValue(flood.trend)));
      if (flood.issuedAt)
        gaugeMetrics.push(floodMetricRow("Issued", esc(fmtIssuedTime(flood.issuedAt))));
      if (gaugeMetrics.length)
        gaugeHtml =
          '<div class="flood-section flood-section--gauge">' +
            '<span class="flood-section-label">Gauge data</span>' +
            gaugeMetrics.join("") +
          '</div>';
    }

    // ── Supporting context section (rainfall/flow) ──
    var supportMetrics = [];
    if (flood && typeof flood.precip === "number")
      supportMetrics.push(floodMetricRow("Rainfall", (Math.round(flood.precip * 10) / 10) + " mm"));
    if (flood && typeof flood.discharge === "number")
      supportMetrics.push(floodMetricRow("River flow", Math.round(flood.discharge) + " m³/s"));
    if (flood && flood.dischargeTrend && FLOOD_TREND[flood.dischargeTrend])
      supportMetrics.push(floodMetricRow("Flow trend", floodTrendValue(flood.dischargeTrend)));
    // For rainfall-only fallback, also show precip as the primary metric.
    if (isRainfallOnly && flood && typeof flood.precip === "number" && !supportMetrics.length)
      supportMetrics.push(floodMetricRow("Rainfall estimate", (Math.round(flood.precip * 10) / 10) + " mm"));
    var supportHtml = "";
    if (supportMetrics.length) {
      var supportLabel = isGoogle ? "Supporting context" : (isRainfallOnly ? "Estimated from rainfall" : "Supporting context");
      supportHtml =
        '<div class="flood-section flood-section--support">' +
          '<span class="flood-section-label">' + esc(supportLabel) + '</span>' +
          supportMetrics.join("") +
        '</div>';
    }

    // ── Guidance tip ──
    var tipIcon = lvl === "NONE" ? "droplets" : (lvl === "UNKNOWN" ? "activity" : "alert-triangle");
    var tip = FLOOD_TIP[lvl] || FLOOD_TIP.UNKNOWN;
    var guidanceHtml =
      '<div class="flood-guidance" role="note">' +
        '<i data-lucide="' + tipIcon + '" class="flood-guidance-icon" aria-hidden="true"></i>' +
        '<p class="flood-tip-text">' + esc(tip) + '</p>' +
      '</div>';

    // ── Attribution ──
    var srcUrl = (flood && flood.sourceUrl) || "https://open-meteo.com/en/docs/flood-api";
    var srcName = (flood && flood.source) || "Open-Meteo";
    var srcIcon = isGoogle ? "gauge" : "cloud-rain";
    var attributionHtml =
      '<div class="flood-attribution">' +
        '<i data-lucide="' + srcIcon + '" class="flood-src-icon" aria-hidden="true"></i>' +
        '<a class="flood-src-link" href="' + esc(srcUrl) + '" target="_blank" rel="noopener noreferrer">' +
          esc(srcName) +
          '<i data-lucide="external-link" aria-hidden="true"></i>' +
        '</a>' +
      '</div>';

    // ── Compose ──
    return '<div class="wx-flood ' + m.cls + '" role="region" aria-label="Flood advisory">' +
      headerHtml +
      gaugeHtml +
      supportHtml +
      guidanceHtml +
      attributionHtml +
    '</div>';
  }

  function statusMeta(status) {
    switch (status) {
      case STATUS.SUSPENDED:           return { cls: "is-suspended", label: "SUSPENDED · WALANG PASOK", icon: "x-octagon" };
      case STATUS.PARTIALLY_AFFECTED:  return { cls: "is-partial", label: "PARTIALLY AFFECTED", icon: "alert-triangle" };
      case STATUS.PENDING:             return { cls: "is-pending", label: "SCHEDULED", icon: "calendar-clock" };
      case STATUS.UNKNOWN:             return { cls: "is-unknown", label: "UNAVAILABLE", icon: "help-circle" };
      default:                         return { cls: "is-clear", label: "NO SUSPENSION", icon: "check-circle" };
    }
  }
  // Live render-time timestamp (truthful — reflects when the panel was drawn).
  function fmtUpdated() {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
      }).format(new Date());
    } catch (e) { return manilaToday(); }
  }
  // Date-only stamp (no fabricated time) for announcement "Posted …" lines.
  // A bare YYYY-MM-DD is formatted from its own parts so no timezone can shift
  // the calendar day; full ISO strings / Date objects fall through to Manila.
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtStamp(d) {
    if (!d) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    if (m) return MONTH_ABBR[(+m[2]) - 1] + " " + (+m[3]) + ", " + m[1];
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric"
      }).format(new Date(d));
    } catch (e) { return String(d); }
  }
  // Long Manila weekday + date ("Wednesday, August 19") — anchors the verdict
  // line to a specific day so "today" is never ambiguous.
  function fmtDayDate() {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric"
      }).format(new Date());
    } catch (e) { return manilaWeekday(); }
  }
  // Short weekday + date for a bare ISO day ("Thu, Aug 20"). Built from the
  // date's own parts so no timezone can shift the calendar day.
  function fmtShortDay(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
    if (!m) return fmtStamp(d);
    try {
      return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })
        .format(new Date(+m[1], (+m[2]) - 1, +m[3]));
    } catch (e) { return fmtStamp(d); }
  }

  function officialLinksHTML() {
    return CFG.officialLinks.map(function (l) {
      return '<a class="notice-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + '<span>' + esc(l.label) + '</span><i data-lucide="external-link" aria-hidden="true"></i></a>';
    }).join("");
  }

  // Concise tag chips extracted from active/pending notice metadata.
  function feedTags(st) {
    var tags = [];
    if (st.affectedLevel && st.affectedLevel !== "Not specified") tags.push(String(st.affectedLevel).toUpperCase());
    if (st.modality === "FACE_TO_FACE") tags.push("FACE-TO-FACE ONLY");
    if (st.levels && st.levels.allK12) tags.push("PUBLIC & PRIVATE");
    return tags;
  }

  /* -------------------------------------------------------------
     VERDICT — the card's one plain-language answer to "do I have
     class today?". The status chip in the head carries the machine
     label ("NO SUSPENSION"); the verdict carries the human meaning
     ("Classes are in session"), so the two never restate each other.
     Copy never overstates: an unreachable feed reads as unknown,
     never as clear.
     ------------------------------------------------------------- */
  var PERIOD_WORD = { ALL_DAY: "Whole day", MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" };
  // The seal glyph speaks about CLASSES; the chip icon speaks about STATUS.
  // Two registers, so the repeated icon never reads as duplication.
  var SEAL_ICON = {};
  SEAL_ICON[STATUS.SUSPENDED]          = "calendar-x";
  SEAL_ICON[STATUS.PARTIALLY_AFFECTED] = "alert-triangle";
  SEAL_ICON[STATUS.PENDING]            = "calendar-clock";
  SEAL_ICON[STATUS.UNKNOWN]            = "help-circle";
  SEAL_ICON[STATUS.NOT_SUSPENDED]      = "calendar-check";

  // Scope line for an active notice: period · scope · when. Only truthful
  // fields are joined, so a sparse announcement yields a shorter line.
  function verdictMeta(st) {
    var parts = [];
    if (st.period && PERIOD_WORD[st.period]) parts.push(PERIOD_WORD[st.period]);
    if (st.scope) parts.push(st.scope);
    if (st.effectiveDate)
      parts.push(st.effectiveDate === manilaToday() ? "Today" : fmtShortDay(st.effectiveDate));
    return parts.join(" · ");
  }
  // → { title, sub, usedNote }. usedNote suppresses the duplicate note
  // paragraph further down the card when the note is already the sub-line.
  function verdictCopy(st) {
    var dayDate = fmtDayDate();
    if (st.status === STATUS.UNKNOWN) return {
      title: "Status unavailable",
      sub: st.note || "The official source could not be reached — this is not a confirmation that classes are on.",
      usedNote: true
    };
    if (st.status === STATUS.SUSPENDED) return {
      title: st.headline || "Class suspension in effect",
      sub: verdictMeta(st) || dayDate
    };
    if (st.status === STATUS.PARTIALLY_AFFECTED) return {
      title: st.headline || "Some classes affected",
      sub: verdictMeta(st) || dayDate
    };
    if (st.status === STATUS.PENDING) return {
      title: "Suspension scheduled",
      sub: (st.effectiveDate ? "Takes effect " + fmtShortDay(st.effectiveDate) : "Announced for an upcoming date") +
        (st.period && PERIOD_WORD[st.period] ? " · " + PERIOD_WORD[st.period] : "")
    };
    // NOT_SUSPENDED — either a plain clear day, or a real announcement that
    // does not reach QCU / does not touch this student's own class times.
    // Prefer the short scope line for the sub so the sub-line stays scannable;
    // the longer explanation then flows into .notice-note, which is built for
    // prose. Only when there is no scope line does the note stand in.
    if (st.headline) {
      var meta = verdictMeta(st);
      return { title: st.headline, sub: meta || st.note || dayDate, usedNote: !meta && !!st.note };
    }
    return {
      title: "Classes are in session",
      sub: "No suspension announced for QCU today, " + dayDate + "."
    };
  }
  function noticeFactsHTML(st) {
    var facts = [];
    if (st.effectiveDate) facts.push({ icon: "calendar-days", label: "Effective", value: st.effectiveDate === manilaToday() ? "Today" : fmtShortDay(st.effectiveDate) });
    if (st.period && PERIOD_WORD[st.period]) facts.push({ icon: "clock-3", label: "Time window", value: PERIOD_WORD[st.period] });
    if (st.modality === "FACE_TO_FACE") facts.push({ icon: "users", label: "Class mode", value: "Face-to-face only" });
    else if (st.modality === "ONLINE") facts.push({ icon: "monitor", label: "Class mode", value: "Online only" });
    else if (st.modality === "ALL") facts.push({ icon: "layers-3", label: "Class mode", value: "All class modes" });
    if (st.affectedLevel && st.affectedLevel !== "Not specified") facts.push({ icon: "graduation-cap", label: "Applies to", value: st.affectedLevel });
    if (!facts.length) return "";
    return '<div class="notice-facts" role="list" aria-label="Suspension notice details">' + facts.map(function (fact) { return '<div class="notice-fact" role="listitem"><span class="notice-fact-icon" aria-hidden="true"><i data-lucide="' + fact.icon + '"></i></span><span class="notice-fact-copy"><span class="notice-fact-label">' + esc(fact.label) + '</span><span class="notice-fact-value">' + esc(fact.value) + '</span></span></div>'; }).join("") + '</div>';
  }

  function verdictHTML(st) {
    var v = verdictCopy(st);
    return {
      usedNote: !!v.usedNote,
      html:
        '<div class="notice-verdict">' +
          '<span class="notice-seal" aria-hidden="true"><i data-lucide="' +
            (SEAL_ICON[st.status] || SEAL_ICON[STATUS.NOT_SUSPENDED]) + '"></i></span>' +
          '<span class="notice-verdict-text">' +
            '<span class="notice-verdict-title">' + esc(v.title) + '</span>' +
            (v.sub ? '<span class="notice-verdict-sub">' + esc(v.sub) + '</span>' : '') +
          '</span>' +
        '</div>'
    };
  }

  // Clear-day assurance row. "No news" is only trustworthy if the reader can
  // see the official source WAS read — on a quiet day that fact IS the content,
  // so it sits in the body rather than buried in the footer.
  function attestHTML() {
    return '<p class="notice-attest">' +
      '<i data-lucide="shield-check" aria-hidden="true"></i>' +
      'Checked against the official Quezon City announcements feed.' +
    '</p>';
  }

  // Quoted OFFICIAL ANNOUNCEMENT block — the source's own title, posting date,
  // reason and scope tags, held in its own surface so the announcement's words
  // are never mistaken for our reading of them above.
  function noticeDocHTML(st) {
    if (!st.title) return "";
    var tags = feedTags(st);
    var stampSrc = st.publishedAt || st.effectiveDate;
    return '<div class="notice-doc">' +
      '<div class="notice-doc-head"><span class="notice-doc-label"><i data-lucide="file-check-2" aria-hidden="true"></i>Official announcement</span>' +
        (st.source ? '<span class="notice-source"><i data-lucide="landmark" aria-hidden="true"></i>' + esc(st.source) + '</span>' : '') +
      '</div>' +
      '<p class="feed-title">' + esc(st.title) + '</p>' +
      (stampSrc ? '<p class="feed-time"><i data-lucide="clock" aria-hidden="true"></i>Posted ' + esc(fmtStamp(stampSrc)) + '</p>' : '') +
      (st.reason ? '<p class="notice-reason"><i data-lucide="cloud-rain" aria-hidden="true"></i><span>' + esc(st.reason) + '</span></p>' : '') +
      (tags.length ? '<div class="feed-tags">' + tags.map(function (t) {
        return '<span class="feed-tag">' + esc(t) + '</span>';
      }).join("") + '</div>' : '') +
      (st.sourceUrl ? '<a class="feed-cta" href="' + esc(st.sourceUrl) + '" target="_blank" rel="noopener">' +
        '<span>Open official notice</span><i data-lucide="external-link" aria-hidden="true"></i></a>' : '') +
    '</div>';
  }

  // Suspension notice card — three stacked layers, driven entirely by
  // feed-presence semantics. NEVER fabricates:
  //   • active/pending suspension → verdict + quoted official announcement
  //   • announcement that misses QCU → verdict explaining why + the quote
  //   • feed present, nothing active → confident all-clear + source attestation
  //   • feed failure (UNKNOWN)     → honest unavailable, never "may pasok"
  function announcementFeedHTML(st) {
    // A verified quiet day does not need an alarm-style notice. Keep genuine
    // announcements that do not cover QCU visible so the explanation remains
    // available to the student.
    if (st.status === STATUS.NOT_SUSPENDED && !st.title) return "";
    var m = statusMeta(st.status);
    var v = verdictHTML(st);
    return '' +
      '<div class="notice ' + m.cls + '">' +
        '<div class="notice-main">' +
          '<div class="notice-head">' +
            '<span class="notice-kicker"><i data-lucide="megaphone" aria-hidden="true"></i>Class Suspension Notice</span>' +
            '<span class="notice-status"><i data-lucide="' + m.icon + '" aria-hidden="true"></i>' + esc(m.label) + '</span>' +
          '</div>' +
          v.html +
          noticeFactsHTML(st) +
          noticeDocHTML(st) +
          (st.status === STATUS.NOT_SUSPENDED ? attestHTML() : '') +
          (!v.usedNote && st.note ? '<p class="notice-note"><i data-lucide="circle-alert" aria-hidden="true"></i><span>' + esc(st.note) + '</span></p>' : '') +
          '<div class="notice-foot">' +
            '<span class="notice-updated"><i data-lucide="refresh-cw" aria-hidden="true"></i>Updated ' + esc(fmtUpdated()) + '</span>' +
            '<nav class="notice-links" aria-label="Official suspension verification links">' +
              '<span class="notice-links-label"><i data-lucide="shield-check" aria-hidden="true"></i>Verify with</span>' +
              '<span class="notice-link-list">' + officialLinksHTML() + '</span>' +
            '</nav>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* =============================================================
     COMPOSE + RENDER
     ============================================================= */
  function paint(html) { root.innerHTML = html; iconify(); }

  // Geolocation UI state, held in the IIFE closure so it SURVIVES the
  // paint()-driven innerHTML replacement between renders.
  var geoState = "idle"; // idle | requesting | denied | error | unsupported

  // Full-width overall status banner — ALWAYS visible except for the quiet
  // normal state (a plain "no suspension" day needs no alarm banner). Every
  // alert-state status maps to an honest label; UNKNOWN never reads as a
  // normal/clear day.
  function overallBannerHTML(st) {
    if (st.status === STATUS.NOT_SUSPENDED) return "";
    var map = {};
    map[STATUS.SUSPENDED]          = { cls: "is-suspended", icon: "x-octagon",      badge: "WALANG PASOK",       text: "Face-to-Face Classes Suspended" };
    map[STATUS.PARTIALLY_AFFECTED] = { cls: "is-partial",   icon: "alert-triangle", badge: "PARTIALLY AFFECTED", text: "Some Classes Affected Today" };
    map[STATUS.PENDING]            = { cls: "is-pending",   icon: "calendar-clock", badge: "SCHEDULED",          text: "Suspension announced" + (st.effectiveDate ? " for " + fmtStamp(st.effectiveDate) : "") };
    map[STATUS.UNKNOWN]            = { cls: "is-unknown",   icon: "help-circle",    badge: "STATUS UNAVAILABLE", text: "Monitoring — verify with official channels" };
    var b = map[st.status] || map[STATUS.UNKNOWN];
    return '<div class="status-banner ' + b.cls + '" role="alert">' +
      '<i data-lucide="' + b.icon + '" aria-hidden="true"></i>' +
      '<span class="status-banner-body">' +
        '<span class="status-banner-badge">' + esc(b.badge) + '</span>' +
        '<span class="status-banner-text">' + esc(b.text) + '</span>' +
      '</span>' +
    '</div>';
  }

  // Campus-specific rain alert — shown only when genuine rain/showers/storm is
  // detected AT QCU San Bartolome (WMO severity ≥ 3, so drizzle never alarms).
  function campusRainAlertHTML(campusWx) {
    if (!campusWx || campusWx.code == null) return "";
    var sev = wmo(campusWx.code)[2];
    if (sev < 3) return "";
    var label = weatherStatusLabel(campusWx.code, campusWx.pop);
    return '<div class="campus-rain-alert' + (sev >= 4 ? " sev-severe" : "") + '" role="status">' +
      '<i data-lucide="cloud-rain" aria-hidden="true"></i>' +
      '<span>Rain reported at QCU San Bartolome — ' + esc(label) + '.</span>' +
    '</div>';
  }

  // My-Location card body when there is no cached GPS fix — branches on geoState.
  function geoBodyHTML(state) {
    if (state === "unsupported")
      return '<div class="loc-off"><i data-lucide="map-pin-off"></i><span>Location unavailable on this device.</span></div>';
    if (state === "requesting")
      return '<div class="loc-enable"><button class="loc-enable-btn" type="button" disabled><i data-lucide="loader"></i>Locating…</button></div>';
    if (state === "denied" || state === "error")
      return '<div class="loc-enable">' +
        '<p class="loc-off-msg"><i data-lucide="map-pin-off"></i>Location off — tap to enable.</p>' +
        '<button class="loc-enable-btn" type="button" data-action="use-location"><i data-lucide="navigation"></i>Use my location</button></div>';
    // idle
    return '<div class="loc-enable">' +
      '<p class="loc-hint">See live weather &amp; flood for where you are.</p>' +
      '<button class="loc-enable-btn" type="button" data-action="use-location"><i data-lucide="navigation"></i>Use my location</button></div>';
  }

  // One location micro-card. `opts.geo` renders the geolocation body (My
  // Location, no fix); otherwise the weather segment + flood advisory.
  function microCardHTML(title, sub, view, opts) {
    opts = opts || {};
    var sevClass = "", inner;
    if (opts.geo) {
      inner = geoBodyHTML(opts.geoState);
    } else {
      var seg = weatherSegmentHTML(view && view.wx);
      sevClass = seg.sevClass;
      inner = seg.html + floodBlockHTML(view && view.flood);
    }
    return '<div class="wx-panel loc-card ' + sevClass + '">' +
      '<div class="loc-card-head">' +
        '<span class="loc-title"><i data-lucide="' + esc(opts.icon || "map-pin") + '"></i>' + esc(title) + '</span>' +
        (sub ? '<span class="loc-sub">' + esc(sub) + '</span>' : '') +
      '</div>' +
      inner +
    '</div>';
  }

  function locationsGridHTML(views) {
    var isUser = weatherView === "user";
    var selectedCard = isUser
      ? (views.hasUserFix
        ? microCardHTML("My Location", null, views.user, { icon: "navigation" })
        : microCardHTML("My Location", null, null, { geo: true, geoState: geoState, icon: "navigation" }))
      : microCardHTML("QCU Campus", "San Bartolome", views.campus, { icon: "school" });
    return '<div class="weather-module">' +
      '<div class="weather-module-head">' +
        '<div><span class="weather-module-kicker">Live conditions</span><h2 class="weather-module-title">Weather</h2></div>' +
        '<div class="weather-switch" role="tablist" aria-label="Choose weather location">' +
          '<button class="weather-switch-btn' + (isUser ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (isUser ? 'true' : 'false') + '" data-weather-view="user"><i data-lucide="navigation" aria-hidden="true"></i><span>My Location</span></button>' +
          '<button class="weather-switch-btn' + (!isUser ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (!isUser ? 'true' : 'false') + '" data-weather-view="campus"><i data-lucide="school" aria-hidden="true"></i><span>QCU Campus</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="weather-module-body">' + selectedCard + '</div>' +
    '</div>';
  }

  function compose(st, views) {
    return '' +
      overallBannerHTML(st) +
      campusRainAlertHTML(views.campus && views.campus.wx) +
      '<div class="status-grid">' +
        locationsGridHTML(views) +
        announcementFeedHTML(st) +
      '</div>';
  }

  // Per-location view: weather + derived flood + advisory risk. Kept isolated so
  // one location's outage never blanks the other card.
  function buildLocationView(wx, floodApi) {
    return {
      wx: wx || null,
      flood: deriveFlood(wx, floodApi),
      risk: wx ? computeRisk(wx.code, wx.pop) : null
    };
  }

  // On-demand geolocation — fires ONLY from a user tap (never auto-prompts).
  function requestUserLocation() {
    if (!navigator.geolocation) { geoState = "unsupported"; refresh(); return; }
    geoState = "requesting"; refresh();
    navigator.geolocation.getCurrentPosition(function (pos) {
      try {
        localStorage.setItem(LOC_KEY, JSON.stringify({
          lat: pos.coords.latitude, lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy, t: Date.now()
        }));
      } catch (e) { /* storage may be unavailable — fall through to refresh */ }
      geoState = "idle"; refresh();
    }, function (err) {
      geoState = (err && err.code === 1) ? "denied" : "error"; refresh();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  var lastStatus = null, lastViews = null;

  // ONE delegated handler on the root (root.innerHTML is replaced every paint).
  root.addEventListener("click", function (e) {
    var weatherButton = e.target && e.target.closest && e.target.closest("[data-weather-view]");
    if (weatherButton) {
      e.preventDefault();
      var nextView = weatherButton.getAttribute("data-weather-view");
      if (nextView === "user" || nextView === "campus") {
        weatherView = nextView;
        try { localStorage.setItem(WEATHER_VIEW_KEY, weatherView); } catch (err) { /* ignore */ }
        if (lastStatus && lastViews) paint(compose(lastStatus, lastViews));
      }
      return;
    }
    var btn = e.target && e.target.closest && e.target.closest("[data-action='use-location']");
    if (btn) { e.preventDefault(); requestUserLocation(); }
  });

  function refresh() {
    var userLoc = getUserLocation();               // cached fix only — no auto-prompt
    var hasUserFix = !!userLoc;
    var campusLoc = { lat: CFG.lat, lon: CFG.lon };
    Promise.all([
      fetchWeather(campusLoc), fetchFlood(),                       // campus: always (flood proxy is QCU-centric)
      fetchSuspensions(), fetchSchedule(),                         // location-independent
      hasUserFix ? fetchWeather(userLoc) : Promise.resolve(null)   // user: only with a fix
    ]).then(function (res) {
      var campus = buildLocationView(res[0], res[1]);
      var list = res[2], schedule = res[3];
      // Flood is QCU-anchored by the server proxy, so both cards share it.
      var user = hasUserFix ? buildLocationView(res[4], res[1]) : null;
      // Institution-centric: campus weather is the advisory input (advisory only —
      // it can never flip the official status).
      var st = getQcuSuspensionStatus(list, schedule, campus.risk);
      lastStatus = st;
      lastViews = { user: user, campus: campus, hasUserFix: hasUserFix };
      paint(compose(lastStatus, lastViews));
    }).catch(function (e) {
      dbg("refresh error", e);
      // Even total failure must read as honest UNKNOWN — never "no suspension".
      var st = getQcuSuspensionStatus(undefined, [], null);
      lastStatus = st;
      lastViews = { user: null, campus: { wx: null, flood: undefined, risk: null }, hasUserFix: hasUserFix };
      paint(compose(lastStatus, lastViews));
    });
  }

  // Loading skeleton, then first paint. Mirrors the real layout so the panel
  // settles instead of jumping while the feeds resolve.
  paint('<div class="status-grid">' +
        '<div class="loc-grid">' +
          '<div class="wx-panel wx-loading"><span class="wx-status">Loading…</span></div>' +
          '<div class="wx-panel wx-loading"><span class="wx-status">Loading…</span></div>' +
        '</div>' +
        '<div class="notice is-unknown"><div class="notice-main">' +
          '<div class="notice-head">' +
            '<span class="notice-kicker"><i data-lucide="megaphone" aria-hidden="true"></i>Class Suspension Notice</span>' +
            '<span class="notice-status"><i data-lucide="loader" aria-hidden="true"></i>CHECKING</span>' +
          '</div>' +
          '<div class="notice-verdict">' +
            '<span class="notice-seal" aria-hidden="true"><i data-lucide="scan-search"></i></span>' +
            '<span class="notice-verdict-text">' +
              '<span class="notice-verdict-title">Checking official sources…</span>' +
              '<span class="notice-verdict-sub">Reading the Quezon City announcements feed.</span>' +
            '</span>' +
          '</div>' +
        '</div></div></div>');
  refresh();

  // Refresh on tab re-focus (cheap, respects weather TTL cache).
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });

  // Expose the engine for reuse/testing (e.g., ETA page or console).
  window.getQcuSuspensionStatus = function (list, schedule, weatherRisk) {
    return getQcuSuspensionStatus(list, schedule, weatherRisk);
  };
})();
