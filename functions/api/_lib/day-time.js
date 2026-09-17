// Canonical day-of-week and clock-time normalisation.
//
// Why this exists: the COR import stored numeric days (0 = Sunday … 6 = Saturday,
// see cor/confirm.js DAY_MAP) while the manual class editor wrote "MONDAY" and
// "08:00". Everything that compared the two silently mismatched: conflict
// detection never fired when a class was moved onto a busy day, and the edit
// form's Day dropdown never preselected the entry's real day (so it fell back to
// the first option, Monday). Normalising at the edges — every row read from the
// sheet, every value accepted from a request body — keeps one representation in
// the system: "MONDAY" and "HH:mm".

export const DAY_NAMES = [
  "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
];

/** Monday-first order, which is how the UI lists the week. */
export const DAY_ORDER = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const DAY_ALIASES = {
  MON: "MONDAY", MONDAY: "MONDAY",
  TUE: "TUESDAY", TUES: "TUESDAY", TUESDAY: "TUESDAY",
  WED: "WEDNESDAY", WEDS: "WEDNESDAY", WEDNESDAY: "WEDNESDAY",
  THU: "THURSDAY", THUR: "THURSDAY", THURS: "THURSDAY", THURSDAY: "THURSDAY",
  FRI: "FRIDAY", FRIDAY: "FRIDAY",
  SAT: "SATURDAY", SATURDAY: "SATURDAY",
  SUN: "SUNDAY", SUNDAY: "SUNDAY",
};

/**
 * Anything a day can arrive as -> "MONDAY" | null.
 * Accepts "MONDAY", "Monday", "mon", 0-6 (0 = Sunday), 7 (Sunday), "Mon (Monday)".
 */
export function normalizeDayOfWeek(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return null;
    if (value >= 0 && value <= 6) return DAY_NAMES[value];
    if (value === 7) return "SUNDAY";
    return null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 0 && n <= 6) return DAY_NAMES[n];
    if (n === 7) return "SUNDAY";
    return null;
  }

  // The editor labels options "Mon (MONDAY)".
  const head = raw.toUpperCase().replace(/[^A-Z]/g, " ").trim().split(/\s+/)[0] || "";
  return DAY_ALIASES[head] || null;
}

/**
 * Anything a clock time can arrive as -> "HH:mm" | null.
 * Accepts "08:00", "8:00", "08:00:00", "8:00 AM", ISO datetimes
 * ("1899-12-30T00:00:00.000Z" from Sheets time cells), and day fractions
 * (0.354166… = 08:30) from Sheets numeric time cells.
 */
export function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const minutesInDay = Math.round((value % 1) * 24 * 60);
    if (minutesInDay < 0 || minutesInDay >= 24 * 60) return null;
    const h = Math.floor(minutesInDay / 60);
    const m = minutesInDay % 60;
    return `${pad(h)}:${pad(m)}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // 12-hour with a meridiem, e.g. "1:00 PM", "1.30pm"
  const meridiem = raw.match(/^(\d{1,2})[:.](\d{2})\s*([AP])\.?M\.?$/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "P") hour += 12;
    const minute = Number(meridiem[2]);
    if (hour > 23 || minute > 59) return null;
    return `${pad(hour)}:${pad(minute)}`;
  }

  // 24-hour, optionally with seconds: "08:00", "8:00", "08:00:00"
  const clock = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return null;
    return `${pad(hour)}:${pad(minute)}`;
  }

  // 4-digit block on the 24-hour clock: "0900" … "1330"
  const compact = raw.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const hour = Number(compact[1]);
    const minute = Number(compact[2]);
    if (hour > 23 || minute > 59) return null;
    return `${pad(hour)}:${pad(minute)}`;
  }

  // ISO datetime: keep the clock part. Time-of-day columns are repaired to
  // "HH:mm" in Apps Script (formatTimeCell) before they reach us, so this is
  // the last-resort path for legacy rows.
  const iso = raw.match(/T(\d{2}):(\d{2})(?::\d{2})?/);
  if (iso) return `${iso[1]}:${iso[2]}`;

  return null;
}

/** True when a string is already a canonical "HH:mm". */
export function isClockTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Minutes since midnight for `a`-`b` overlap maths; null when unparseable. */
export function minutesOfDay(value) {
  const t = normalizeTime(value);
  if (!t) return null;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// The day column of a COR is a compressed run of day initials — "M", "MW",
// "M/W/F", "TTh", "TThS", "MWF", "MON WED FRI" — and every reader of it must
// agree, because a schedule built from misread days is worse than no schedule.
// Two private parsers used to disagree here: one chunked the letters two at a
// time after upper-casing (so "MWF" became Friday alone, "MW"/"TTh" became
// nothing, "Th" became Tuesday), the other only understood separated tokens
// (so "MW"/"TTh" became nothing). Both now call this.
//
// Longest token wins at each position, compared case-insensitively so "Th"
// stays Thursday while a lone "T" stays Tuesday.
const DAY_TOKENS = [
  ["SUNDAY", "SUNDAY"], ["SUN", "SUNDAY"], ["SU", "SUNDAY"],
  ["MONDAY", "MONDAY"], ["MON", "MONDAY"], ["MO", "MONDAY"],
  ["TUESDAY", "TUESDAY"], ["TUES", "TUESDAY"], ["TUE", "TUESDAY"], ["TU", "TUESDAY"],
  ["WEDNESDAY", "WEDNESDAY"], ["WEDS", "WEDNESDAY"], ["WED", "WEDNESDAY"], ["WE", "WEDNESDAY"],
  ["THURSDAY", "THURSDAY"], ["THURS", "THURSDAY"], ["THUR", "THURSDAY"], ["THU", "THURSDAY"], ["TH", "THURSDAY"],
  ["FRIDAY", "FRIDAY"], ["FRI", "FRIDAY"], ["FR", "FRIDAY"],
  ["SATURDAY", "SATURDAY"], ["SAT", "SATURDAY"], ["SA", "SATURDAY"],
  ["M", "MONDAY"], ["T", "TUESDAY"], ["W", "WEDNESDAY"], ["F", "FRIDAY"], ["S", "SATURDAY"],
];

/**
 * Read a COR day column into canonical day names, deduplicated in week order.
 *
 * Returns [] when nothing recognisable is present, so callers can report the
 * subject instead of inventing a day for it.
 */
export function parseDayTokens(input) {
  const raw = String(input || "")
    // "TBA"/"TBD" are not days, and the "T" would otherwise import as Tuesday.
    .replace(/\b(tba|tbd|tbc|to\s+be\s+(?:announced|determined|confirmed))\b/gi, " ")
    // Clock times and AM/PM are not days either ("MW 8:00 AM" must not gain a
    // Monday from the "M" in AM, or another from the "M" in PM).
    .replace(/\d{1,2}[:.]\d{2}\s*(am|pm)?/gi, " ")
    .replace(/\b\d{1,2}\s*(am|pm)\b/gi, " ");
  const found = new Set();
  let i = 0;
  while (i < raw.length) {
    if (!/[A-Za-z]/.test(raw[i])) { i++; continue; }
    let matched = null;
    for (const [token, dayName] of DAY_TOKENS) {
      const slice = raw.slice(i, i + token.length);
      if (slice.length === token.length && slice.toUpperCase() === token) {
        matched = { token, dayName };
        break;
      }
    }
    if (matched) {
      found.add(matched.dayName);
      i += matched.token.length;
    } else {
      i++;
    }
  }
  return DAY_ORDER.filter((day) => found.has(day));
}

/**
 * Same input, Monday-first 1-7 indexes (the form the legacy OCR path and older
 * sheet rows use).
 */
export function parseDayIndexes(input) {
  return parseDayTokens(input).map((day) => DAY_ORDER.indexOf(day) + 1);
}

// ---------------------------------------------------------------------------
// Class times — a printed time is not a clock time until AM/PM is known
// ---------------------------------------------------------------------------
// Why this exists: every COR of a QCU class prints its times in 12-hour form,
// and a cell very often carries the AM/PM marker ONCE for the whole window
// ("1:00-2:30 PM" — the marker belongs to the range, not to the second time).
// Resolving each value on its own left the bare side at its 12-hour face value:
// an afternoon class was stored as 01:00-14:30, a 13.5-hour window that also
// dragged phantom conflicts through every overlap check, marked the class live
// at 1 AM and inflated the day's hour total. The pipeline spec is explicit —
// "require explicit or reliably shared meridiem context for 12-hour values" and
// "do not infer AM/PM solely because a time appears typical for classes" — so a
// window with no marker anywhere is reported, never guessed.

const MERIDIEM = /([ap])\s*\.?\s*m/i;

/**
 * Read one printed time WITHOUT deciding AM or PM.
 *
 * Returns { text, time, printedHour, meridiem, unambiguous } or null.
 * `printedHour` is the hour exactly as printed (1-12 for 12-hour clocks), which
 * is what makes "1:00" and "13:00" different inputs even though both normalise
 * to a clock time. `unambiguous` is true only when the text itself settles the
 * question: an explicit marker, a 24-hour hour (13 and up), a 4-digit 24-hour
 * block, seconds, or a value that arrived as a number (a Sheets time cell).
 */
export function parsePrintedTime(value) {
  const time = normalizeTime(value);
  if (!time) return null;
  if (typeof value === "number") {
    return { text: String(value), time, printedHour: Number(time.slice(0, 2)), meridiem: null, unambiguous: true };
  }
  const raw = String(value).trim();
  const marker = raw.match(MERIDIEM);
  const meridiem = marker ? `${marker[1].toLowerCase()}m` : null;
  const printed = raw.match(/(\d{1,2})(?:[:.](\d{2}))?/);
  const printedHour = printed ? Number(printed[1]) : Number(time.slice(0, 2));
  const unambiguous = Boolean(meridiem)
    || printedHour > 12
    || /^\d{4}$/.test(raw)
    || /\d{1,2}:\d{2}:\d{2}/.test(raw);
  return { text: raw, time, printedHour, meridiem, unambiguous };
}

/**
 * Read a class window from the two printed times a COR shows.
 *
 * Resolves the meridiem the way the page prints it — a marker written once for
 * the window applies to both times — and falls back to the other half of the day
 * only when that is the only reading that runs forward ("11:00-1:00 PM" is
 * 11:00-13:00, not 23:00-13:00). A window that cannot be read from the printed
 * text comes back with `unresolved: true` and NO times, so the caller can ask
 * instead of inventing an hour.
 *
 * Returns { start: "HH:mm"|null, end: "HH:mm"|null, sourceText, unresolved }.
 */
export function readTimeRange(startRaw, endRaw) {
  const start = parsePrintedTime(startRaw);
  const end = parsePrintedTime(endRaw);
  const printed = [startRaw, endRaw]
    .filter((v) => v !== null && v !== undefined && String(v).trim())
    .map((v) => String(v).trim());
  const sourceText = printed.join(" - ");
  if (!start || !end) return { start: null, end: null, sourceText, unresolved: Boolean(sourceText) };

  // The period a value already carries: an explicit marker, or the 24-hour
  // notation the COR itself chose (09:00 is morning, 13:00 is afternoon).
  const periodOf = (p) => p.meridiem || (p.unambiguous ? (Number(p.time.slice(0, 2)) < 12 ? "am" : "pm") : null);
  const withPeriod = (p, period) => {
    if (p.meridiem) return p.time;
    const hour = (p.printedHour % 12) + (period === "pm" ? 12 : 0);
    return `${pad(hour)}:${p.time.slice(3, 5)}`;
  };

  const startPeriod = periodOf(start);
  const endPeriod = periodOf(end);
  // No marker and no 24-hour shaping anywhere: the printed text cannot say
  // whether "1:00-2:30" is morning or afternoon.
  if (!startPeriod && !endPeriod) return { start: null, end: null, sourceText, unresolved: true };

  let startTime = startPeriod ? start.time : withPeriod(start, endPeriod);
  let endTime = endPeriod ? end.time : withPeriod(end, startPeriod);
  if (minutesOfDay(startTime) >= minutesOfDay(endTime)) {
    // A shared marker can push the bare side past the marked side; the other half
    // of the day is then the only reading that runs forward.
    if (!startPeriod && endPeriod) startTime = withPeriod(start, endPeriod === "pm" ? "am" : "pm");
    else if (startPeriod && !endPeriod) endTime = withPeriod(end, startPeriod === "pm" ? "am" : "pm");
  }
  const from = minutesOfDay(startTime);
  const to = minutesOfDay(endTime);
  if (from === null || to === null || from >= to) return { start: null, end: null, sourceText, unresolved: true };
  return { start: startTime, end: endTime, sourceText, unresolved: false };
}

/**
 * A printed time window still in text form ("1:00-2:30 PM") -> its two parts.
 * Splitting the text is only about the SEPARATOR: which value is the start and
 * which is the end is all this decides.
 */
export function splitTimeRangeText(text) {
  const raw = String(text || "").trim();
  if (!raw) return [null, null];
  const parts = raw.split(/\s*(?:-|–|—|\bto\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [parts[0] || null, null];
}
