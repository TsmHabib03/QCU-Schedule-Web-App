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
