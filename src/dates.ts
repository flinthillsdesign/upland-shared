// ── Upland days are Kansas days ──────────────────────────────────────────
// The servers run in UTC; the shop is in Newton, Kansas. "Today", a signing
// date, a due date — any calendar day a person reads — is the day it is in
// America/Chicago. Taking it from a UTC timestamp (`toISOString().slice(0,
// 10)`) gives tomorrow's date after about 7 pm Central, which is how a
// contract signed in the evening got the next day as its effective date.
//
// Each app had its own copy of these helpers (ODIN had five); this is the one.

export const UPLAND_ZONE = "America/Chicago";

// en-CA formats a date as YYYY-MM-DD.
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: UPLAND_ZONE });

// A stored timestamp → Date. SQLite's datetime('now') writes
// "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker; `new Date()` reads that
// as LOCAL time, hours off. Anything that already names its zone (a trailing
// Z or an offset) is taken as written. A bare date ("2026-10-01") is that
// calendar day, read as noon UTC so no zone shift can move it to a neighbor.
export function parseStamp(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00Z");
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(" ", "T") + "Z");
}

// The Kansas calendar day of a moment, as YYYY-MM-DD. No argument: today.
// A bare date string comes back unchanged — it already is a day.
export function centralDay(when: string | number | Date = new Date()): string {
  if (typeof when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(when.trim())) return when.trim();
  return DAY.format(parseStamp(when));
}

// Today in Kansas, YYYY-MM-DD.
export function centralToday(now: Date = new Date()): string {
  return DAY.format(now);
}

// A Kansas day some days from another (default: from today). Calendar
// arithmetic on the day itself, so daylight-saving changes can't skip or
// repeat one.
export function centralDayPlus(days: number, from: string | number | Date = new Date()): string {
  const [y, m, d] = centralDay(from).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return t.toISOString().slice(0, 10);
}

// A moment or a day, written for a person in Kansas time. Defaults to
// "Oct 1, 2026"; pass Intl options for anything else (they are applied in
// Kansas time unless they name another zone).
export function formatCentral(
  when: string | number | Date,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: UPLAND_ZONE, ...options }).format(
    parseStamp(when),
  );
}
