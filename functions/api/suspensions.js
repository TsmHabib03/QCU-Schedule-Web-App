/**
 * Cloudflare Pages Function — GET /api/suspensions
 *
 * Server-side proxy + scraper for Quezon City class-suspension notices.
 * The browser cannot fetch quezoncity.gov.ph directly (CORS), so this
 * function fetches the public announcements page, keyword-filters the
 * headlines for genuine suspension notices, and returns an ENVELOPE:
 *
 *   { status, checkedAt, source, sourceUrl, items: [ … ] }
 *
 * where each item is { title, body, effectiveDate, publishedAt, reason,
 * source, sourceUrl } — the same object shape as data/suspensions.json.
 *
 * SAFETY — the single most important property of this endpoint:
 * a failure MUST NOT look like "no suspension". On any upstream error we
 * return HTTP 503 with status:"ERROR" so the client's !res.ok branch fires
 * and the UI shows UNKNOWN. Returning 200 + [] here would tell every
 * student "classes are normal" during a QC-site outage, which is the worst
 * failure this app can produce. We also never fabricate a notice.
 *
 * CACHING — two independent layers, deliberately different:
 *   • Our response  → `no-store`. Every client read is fresh. (Note: the
 *     repo's _headers file does NOT apply to Pages Functions responses,
 *     so this header has to be set here.)
 *   • The upstream subrequest → edge-cached 120s via `cf.cacheTtl`. This
 *     caps quezoncity.gov.ph at ~720 fetches/day no matter how many
 *     students have the page open, while keeping client data ≤2min old.
 */

const SOURCE_NAME = "Quezon City Government";
const ANNOUNCE_URL = "https://quezoncity.gov.ph/news-and-media/announcements/";

// Upstream edge-cache window (seconds). Protects the QC site from our traffic.
const UPSTREAM_TTL_S = 120;

/* Canonical suspension detector — kept BYTE-IDENTICAL in three places:
   this file, scripts/fetch-suspensions.mjs, and assets/js/status.js.
   If you change one, change all three.

   Every alternative requires a suspension/cancellation VERB. A bare
   "face-to-face" is deliberately NOT a trigger — the previous version
   matched it alone, so "Face-to-Face Job Fair" surfaced as a walang-pasok. */
const SUSP_RE = /(walang\s+pasok|walang\s+klase|class(?:es)?\s+(?:are\s+)?suspend|suspension\s+of\s+class|cancellation\s+of\s+class|classes?\s+cancel|no\s+class(?:es)?\b|face-?to-?face\s+class(?:es)?\s+(?:are\s+)?suspend|suspend\w*\s+.{0,30}?class|holiday\s+for\s+all\s+school)/i;

// Second gate: the headline must also read as being about school/classes.
const CONTEXT = /(class|pasok|klase|student|school|grade|level|academic|university|college)/i;

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      // Never let a browser or the edge hand this back as "current".
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }, extraHeaders || {})
  });
}

// Today's date in Asia/Manila as YYYY-MM-DD. All date logic is Manila-local:
// a UTC "today" is 8h behind and would mis-file early-morning notices.
function manilaToday() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

// Strip HTML tags / collapse whitespace / decode the few entities we expect.
function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Very light extraction: pull candidate "cards" from anchor/heading text on
// the listing page. We are tolerant of markup changes — anything that reads
// like a suspension headline is captured, everything else is ignored.
function extractCandidates(html) {
  const out = [];
  const seen = new Set();

  // Headings and links are where announcement titles live. Capture the href
  // too when present so the UI can deep-link to the actual notice.
  const re = /<(?:h[1-4]|a)\b([^>]*)>([\s\S]*?)<\/(?:h[1-4]|a)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    const text = stripHtml(m[2]);
    if (text.length < 12 || text.length > 220) continue;
    if (!SUSP_RE.test(text)) continue;
    if (!CONTEXT.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let url = ANNOUNCE_URL;
    const href = /href=["']([^"']+)["']/i.exec(attrs);
    if (href) {
      try { url = new URL(href[1], ANNOUNCE_URL).href; } catch (e) { /* keep default */ }
    }
    out.push({ title: text, url: url });
    if (out.length >= 8) break;
  }
  return out;
}

/* Read a date out of the headline. Month names are matched explicitly and
   \b-anchored — the previous /([A-Za-z]{3,9})\s+(\d{1,2})/ was unanchored,
   so a month name embedded in another word could match. */
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
const DATE_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function pad(n) { return n < 10 ? "0" + n : "" + n; }

function parseEffectiveDate(text, todayStr) {
  const isoHit = ISO_RE.exec(String(text || ""));
  if (isoHit) return isoHit[0];

  const m = DATE_RE.exec(String(text || ""));
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const day = parseInt(m[2], 10);
  if (!day || day > 31) return null;
  // No year in the headline → assume the Manila-current year, not the UTC one.
  const year = m[3] ? parseInt(m[3], 10) : parseInt(todayStr.slice(0, 4), 10);
  return year + "-" + pad(mon) + "-" + pad(day);
}

function toNotice(cand, todayStr, nowIso) {
  return {
    title: cand.title,
    body: "",
    effectiveDate: parseEffectiveDate(cand.title, todayStr),
    publishedAt: todayStr,
    reason: /rain|typhoon|weather|storm|bagyo|flood|habagat/i.test(cand.title) ? "Inclement weather" : "",
    source: SOURCE_NAME,
    sourceUrl: cand.url || ANNOUNCE_URL,
    fetchedAt: nowIso
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet() {
  const nowIso = new Date().toISOString();
  const today = manilaToday();

  try {
    const res = await fetch(ANNOUNCE_URL, {
      headers: {
        "User-Agent": "QCU-Student-Portal/1.0 (+https://quezoncity.gov.ph)",
        "Accept": "text/html,application/xhtml+xml"
      },
      // Edge-cache the UPSTREAM read only. Our own response stays no-store.
      cf: { cacheTtl: UPSTREAM_TTL_S, cacheEverything: true }
    });
    if (!res.ok) throw new Error("upstream HTTP " + res.status);

    const html = await res.text();
    const items = extractCandidates(html)
      .map(function (c) { return toNotice(c, today, nowIso); })
      // Drop clearly-expired notices here as well as on the client. Undated
      // items are kept — the client treats them as today-but-unverified.
      .filter(function (n) { return !n.effectiveDate || n.effectiveDate >= today; });

    return jsonResponse({
      status: "OK",
      checkedAt: nowIso,
      source: SOURCE_NAME,
      sourceUrl: ANNOUNCE_URL,
      items: items
    }, 200);
  } catch (err) {
    /* HTTP 503, NOT 200. A scrape failure means "we don't know", and the
       client must render UNKNOWN rather than a clear day. This is the whole
       reason the endpoint returns an envelope with a status field. */
    return jsonResponse({
      status: "ERROR",
      checkedAt: nowIso,
      source: SOURCE_NAME,
      sourceUrl: ANNOUNCE_URL,
      error: String((err && err.message) || err).slice(0, 160),
      items: []
    }, 503);
  }
}
