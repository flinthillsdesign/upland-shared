import { test } from "node:test";
import assert from "node:assert";
import {
  absMonth,
  splitMonth,
  monthKeyStr,
  monthKeyIso,
  monthKeyDate,
  ymToKey,
  addMonthsYm,
  monthPretty,
  spanFrac,
} from "../src/months";

test("absMonth/splitMonth round-trip, 0-indexed months", () => {
  assert.equal(absMonth(2026, 4), 24316); // May 2026 (the Germans install month)
  assert.deepEqual(splitMonth(24316), { y: 2026, m: 4 });
  assert.deepEqual(splitMonth(absMonth(2025, 0)), { y: 2025, m: 0 });
});

test("string forms agree", () => {
  assert.equal(monthKeyStr(24316), "2026-05");
  assert.equal(monthKeyIso(24316), "2026-05-01");
  assert.equal(ymToKey("2026-05"), 24316);
  assert.equal(ymToKey("2026-05-14"), 24316);
  assert.equal(addMonthsYm("2026-05", -12), "2025-05");
  assert.equal(addMonthsYm("2026-01", -1), "2025-12");
  assert.equal(monthPretty("2026-05"), "May 2026");
});

test("monthKeyDate is local first-of-month", () => {
  const d = monthKeyDate(24316);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 1);
});

test("spanFrac treats the end month as inclusive", () => {
  const start = absMonth(2026, 0); // Jan
  const end = absMonth(2026, 11); // Dec (install month, inclusive)
  assert.ok(Math.abs(spanFrac(new Date(2026, 0, 1), start, end)) < 0.01);
  assert.ok(spanFrac(new Date(2026, 11, 31), start, end) > 0.99);
  assert.ok(Math.abs(spanFrac(new Date(2026, 6, 1), start, end) - 0.5) < 0.05);
});
