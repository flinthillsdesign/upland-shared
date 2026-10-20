import { test } from "node:test";
import assert from "node:assert";
import { decide, watchFresh, type FreshState } from "../src/fresh";

const T0 = 1_760_000_000_000;
const MIN = 60_000;
const base: FreshState = {
  build: "2026-10-19T15:00:00Z",
  stamp: "a",
  hiddenSince: null,
  lastRefresh: T0 - 60 * MIN,
  dirty: false,
  hasStamp: true,
};

test("a new build reloads the page, unless the page is dirty", () => {
  const reading = { build: "2026-10-19T16:00:00Z", stamp: "a", now: T0 };
  assert.equal(decide(base, reading), "reload");
  assert.equal(decide({ ...base, dirty: true }, reading), "wait");
});

test("the build check comes before the data check", () => {
  const reading = { build: "2026-10-19T16:00:00Z", stamp: "b", now: T0 };
  assert.equal(decide(base, reading), "reload");
});

test("a moved stamp refreshes in place, unless dirty", () => {
  const reading = { build: base.build, stamp: "b", now: T0 };
  assert.equal(decide(base, reading), "refresh");
  assert.equal(decide({ ...base, dirty: true }, reading), "wait");
});

test("same build, same stamp: nothing", () => {
  assert.equal(decide(base, { build: base.build, stamp: "a", now: T0 }), "none");
});

test("an unreadable build or stamp never triggers anything", () => {
  assert.equal(decide(base, { build: null, stamp: null, now: T0 }), "none");
  assert.equal(decide({ ...base, build: null }, { build: "x", stamp: "a", now: T0 }), "none");
});

test("without a stamp, a page hidden long enough reloads on return", () => {
  const noStamp: FreshState = { ...base, hasStamp: false, stamp: null };
  const reading = { build: base.build, stamp: null, now: T0 };
  assert.equal(decide({ ...noStamp, hiddenSince: T0 - 11 * MIN }, reading), "reload");
  assert.equal(decide({ ...noStamp, hiddenSince: T0 - 2 * MIN }, reading), "none");
  assert.equal(decide({ ...noStamp, hiddenSince: null }, reading), "none");
  assert.equal(decide({ ...noStamp, hiddenSince: T0 - 11 * MIN, dirty: true }, reading), "wait");
  // Freshly loaded pages don't count as stale however long the window was hidden.
  assert.equal(
    decide({ ...noStamp, hiddenSince: T0 - 11 * MIN, lastRefresh: T0 - MIN }, reading),
    "none",
  );
});

test("a custom idle window is honored", () => {
  const noStamp: FreshState = { ...base, hasStamp: false, stamp: null, hiddenSince: T0 - 3 * MIN };
  const reading = { build: base.build, stamp: null, now: T0 };
  assert.equal(decide(noStamp, reading, 2 * MIN), "reload");
  assert.equal(decide(noStamp, reading, 5 * MIN), "none");
});

test("watchFresh is a no-op outside a browser", async () => {
  const h = watchFresh();
  assert.equal(h.build, null);
  await h.check();
  h.markDirty();
  h.markClean();
  h.configure({});
});
