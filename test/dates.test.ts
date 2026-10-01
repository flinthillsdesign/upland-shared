import { test } from "node:test";
import assert from "node:assert";
import { parseStamp, centralDay, centralToday, centralDayPlus, formatCentral } from "../src/dates";

test("an evening in Kansas is still that day, not tomorrow (UTC)", () => {
  // 8:30 pm CDT on Oct 1 is 01:30 UTC on Oct 2.
  const evening = new Date("2026-10-02T01:30:00Z");
  assert.equal(evening.toISOString().slice(0, 10), "2026-10-02"); // the old bug
  assert.equal(centralToday(evening), "2026-10-01");
  assert.equal(centralDay(evening), "2026-10-01");
  // Winter (CST, UTC-6): 11:30 pm on Jan 14.
  assert.equal(centralDay("2027-01-15T05:30:00Z"), "2027-01-14");
});

test("a SQLite timestamp with no zone is UTC, not local time", () => {
  assert.equal(parseStamp("2026-10-02 01:30:00").toISOString(), "2026-10-02T01:30:00.000Z");
  assert.equal(centralDay("2026-10-02 01:30:00"), "2026-10-01");
  assert.equal(parseStamp("2026-10-02T01:30:00").toISOString(), "2026-10-02T01:30:00.000Z");
});

test("a timestamp that names its zone is taken as written", () => {
  assert.equal(parseStamp("2026-10-01T20:30:00-05:00").toISOString(), "2026-10-02T01:30:00.000Z");
  assert.equal(parseStamp("2026-10-02T01:30:00.000Z").toISOString(), "2026-10-02T01:30:00.000Z");
});

test("a bare date is that calendar day everywhere", () => {
  assert.equal(centralDay("2026-10-01"), "2026-10-01");
  assert.equal(formatCentral("2026-10-01"), "Oct 1, 2026");
  assert.equal(formatCentral("2026-01-01", { month: "long", day: "numeric", year: "numeric" }), "January 1, 2026");
});

test("day arithmetic crosses months and daylight-saving changes cleanly", () => {
  assert.equal(centralDayPlus(30, "2026-10-01"), "2026-10-31");
  assert.equal(centralDayPlus(1, "2026-10-31"), "2026-11-01");
  assert.equal(centralDayPlus(1, "2026-11-01"), "2026-11-02"); // fall back
  assert.equal(centralDayPlus(1, "2027-03-14"), "2027-03-15"); // spring forward
  assert.equal(centralDayPlus(-1, "2027-01-01"), "2026-12-31");
  assert.equal(centralDayPlus(30, new Date("2026-10-02T01:30:00Z")), "2026-10-31"); // from Oct 1 in Kansas
});

test("formatCentral writes moments in Kansas time", () => {
  assert.equal(formatCentral("2026-10-02 01:30:00"), "Oct 1, 2026");
  assert.equal(
    formatCentral("2026-10-02 01:30:00", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
    "8:30 PM CDT",
  );
});
