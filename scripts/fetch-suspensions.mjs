#!/usr/bin/env node
/* =============================================================
   scripts/fetch-suspensions.mjs
   Out-of-band updater for data/suspensions.json.

   Runs in GitHub Actions (Node 20+, global fetch). A static browser
   frontend cannot read quezoncity.gov.ph directly (server-rendered
   HTML, no JSON API/RSS, CORS-blocked), so this job reads the OFFICIAL
   public announcements page server-side and writes NORMALIZED objects
   the frontend consumes. Nothing is fabricated: every item carries the
   source title + URL.

   THE IMPORTANT DISTINCTION (this was the bug):
   "we couldn't check" and "we checked, there is nothing" are different
   answers and must be handled differently.

     • fetch failed / non-OK / page looks unparseable
         → PRESERVE the existing file. Absence of an update must never
           be read as "no suspension".
     • fetch succeeded and the page parsed cleanly, zero suspensions
         → WRITE an empty item list. This is the normal case on a normal
           day, and it is the ONLY way the feed can ever return to
           "no suspension".

   The previous version preserved the file on an empty parse too, which
   meant the feed pinned the last notice it had ever seen forever — a
   suspension from weeks ago stayed in the file indefinitely.
   ============================================================= */
import { readFile, writeFile } from "node:fs/promises";

const SRC = "https://quezoncity.gov.ph/news-and-media/announcements/";
const OUT = new URL("../data/suspensions.json", import.meta.url);
const SOURCE_NAME = "Quezon City Government";

/* Canonical suspension detector — kept BYTE-IDENTICAL in three places:
   this file, functions/api/suspensions.js, and assets/js/status.js.
   If you change one, change all three. */
const SUSP_RE = /(walang\s+pasok|walang\s+klase|class(?:es)?\s+(?:are\s+)?suspend|suspension\s+of\s+class|cancellation\s+of\s+class|classes?\s+cancel|no\s+class(?:es)?\b|face-?to-?face\s+class(?:es)?\s+(?:are\s+)?suspend|suspend\w*\s+.{0,30}?class|holiday\s+for\s+all\s+school)/i;

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const DATE_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/* Sanity thresholds for "did we actually get the announcements page?".
   An error page, a Cloudflare challenge, or a markup redesign would all
   parse to zero suspensions — and we must not treat those as a clean
   "no suspension today". */
const MIN_HTML_BYTES = 2000;
const MIN_ANCHORS = 10;

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}
function pad(n){ return n < 10 ? "0"+n : ""+n; }

function parseDate(text, todayStr) {
  const s = String(text || "");
  const isoHit = ISO_RE.exec(s);
  if (isoHit) return isoHit[0];
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const day = parseInt(m[2], 10);
  if (!day || day > 31) return null;
  // No year in the headline → assume the Manila-current year.
  const year = m[3] ? parseInt(m[3], 10) : parseInt(todayStr.slice(0, 4), 10);
  return `${year}-${pad(mon)}-${pad(day)}`;
}

function decode(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g,"&").replace(/&#8211;|&ndash;/g,"–").replace(/&#8217;|&rsquo;/g,"’")
    .replace(/&nbsp;/g," ").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/\s+/g," ").trim();
}

// Extract candidate announcements as {title, url} from anchor + heading text.
function extractCandidates(html) {
  const out = [];
  const seen = new Set();

  // Anchors (most announcement titles are links).
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) !== null) {
    const href = m[1], title = decode(m[2]);
    if (title.length < 8 || !SUSP_RE.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let url = SRC;
    try { url = href.startsWith("http") ? href : new URL(href, SRC).href; } catch { /* keep default */ }
    out.push({ title, url });
  }

  // Headings (fallback if titles are not linked).
  const hRe = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  while ((m = hRe.exec(html)) !== null) {
    const title = decode(m[1]);
    if (title.length < 8 || !SUSP_RE.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url: SRC });
  }
  return out;
}

// Does the fetched HTML actually look like the announcements listing?
function looksLikePage(html) {
  if (!html || html.length < MIN_HTML_BYTES) return false;
  const anchors = (html.match(/<a\b/gi) || []).length;
  return anchors >= MIN_ANCHORS;
}

async function main() {
  const today = manilaToday();
  const nowIso = new Date().toISOString();

  let html;
  try {
    const res = await fetch(SRC, {
      headers: { "User-Agent": "QCU-Portal-SuspensionBot/1.0 (+public announcements reader)" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
  } catch (e) {
    // COULD NOT CHECK → preserve. Never wipe to empty on a transport failure.
    console.error("Fetch failed — PRESERVING existing feed (absence of update ≠ no suspension):", e.message);
    process.exit(0);
  }

  if (!looksLikePage(html)) {
    // Reached something, but it isn't the announcements page (error page,
    // bot challenge, or a redesign). Treat as "could not check".
    console.error(`Response does not look like the announcements page (${html.length} bytes) — PRESERVING existing feed.`);
    process.exit(0);
  }

  const candidates = extractCandidates(html);
  console.log(`Page parsed OK. Found ${candidates.length} suspension-like candidate(s).`);

  const items = [];
  for (const c of candidates) {
    const eff = parseDate(c.title, today);
    if (eff && eff < today) continue; // drop clearly-expired
    items.push({
      title: c.title,
      body: "",
      effectiveDate: eff,              // null = undated; the client verifies
      publishedAt: today,
      reason: /rain|typhoon|weather|storm|bagyo|flood|habagat/i.test(c.title) ? "Inclement weather" : "",
      source: SOURCE_NAME,
      sourceUrl: c.url || SRC
    });
  }

  /* We checked successfully — write the answer, INCLUDING an empty list.
     This is what lets the feed go back to "no suspension" once a notice
     stops appearing on the official page. */
  const out = {
    status: "OK",
    checkedAt: nowIso,
    source: SOURCE_NAME,
    sourceUrl: SRC,
    items
  };

  let prev = "";
  try { prev = await readFile(OUT, "utf8"); } catch { /* first run */ }
  const next = JSON.stringify(out, null, 2) + "\n";

  // Compare ignoring the volatile checkedAt so we don't churn a commit every run.
  const strip = (t) => t.replace(/"checkedAt":\s*"[^"]*"/, "");
  if (strip(prev.trim()) === strip(next.trim())) {
    console.log("No change (feed unchanged).");
    process.exit(0);
  }

  await writeFile(OUT, next, "utf8");
  console.log(`Wrote ${items.length} item(s) to data/suspensions.json`);
}

main().catch((e) => { console.error("Unexpected error — not modifying feed:", e); process.exit(0); });
