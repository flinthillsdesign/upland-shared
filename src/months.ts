// ── The absolute-month-key convention ────────────────────────────────────
// Cross-app schedule contract: a month is `year * 12 + month` with month
// 0-INDEXED (Jan = 0). The scheduler stores project spans this way
// (schedule_start / schedule_end, synced into ODIN's projects table), and
// the END month is the INSTALL month, INCLUSIVE — a span covers
// [start, end + 1). An off-by-one here silently corrupts schedules, which
// is why these one-liners live in the shared package instead of being
// re-derived in every file.

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// (year, monthIndex0) → absolute month key.
export function absMonth(y: number, m: number): number {
  return y * 12 + m;
}

// Absolute month key → { y, m } with m 0-indexed. Handles negatives.
export function splitMonth(a: number): { y: number; m: number } {
  return { y: Math.floor(a / 12), m: ((a % 12) + 12) % 12 };
}

// Absolute month key → "YYYY-MM".
export function monthKeyStr(mk: number): string {
  const { y, m } = splitMonth(mk);
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
}

// Absolute month key → "YYYY-MM-01" (first-of-month ISO date).
export function monthKeyIso(mk: number): string {
  return monthKeyStr(mk) + "-01";
}

// Absolute month key → first day of the month as a LOCAL Date.
export function monthKeyDate(mk: number): Date {
  const { y, m } = splitMonth(mk);
  return new Date(y, m, 1);
}

// "YYYY-MM" (or "YYYY-MM-DD") → absolute month key.
export function ymToKey(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

// "YYYY-MM" + delta months → "YYYY-MM".
export function addMonthsYm(ym: string, delta: number): string {
  return monthKeyStr(ymToKey(ym) + delta);
}

// "YYYY-MM" → "May 2026".
export function monthPretty(ym: string): string {
  return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

// Fraction of a schedule span elapsed at date d (day resolution,
// unclamped; end month inclusive per the convention above).
export function spanFrac(d: Date, startKey: number, endKey: number): number {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const fmk = d.getFullYear() * 12 + d.getMonth() + (d.getDate() - 1) / daysInMonth;
  return (fmk - startKey) / (endKey + 1 - startKey);
}
