import { test } from "node:test";
import assert from "node:assert";
import {
  TIMING_DESIGN,
  TIMING_FAB,
  STD_SPLIT,
  TIMING_PROJECTS,
  TIMING_CALIB,
  resampleTiming,
  expectedBurn,
  interpTiming,
} from "../src/timing";

test("templates are 9 steps summing to 100", () => {
  for (const tpl of [TIMING_DESIGN, TIMING_FAB]) {
    assert.equal(tpl.length, 9);
    assert.ok(Math.abs(tpl.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  }
});

test("derived values match the 2026-07-07 8-project calibration", () => {
  // Guards against accidental data edits — update alongside TIMING_VERSION
  // when deliberately recalibrating.
  assert.equal(STD_SPLIT, 51);
  assert.equal(TIMING_CALIB.length, 8);
  assert.ok(Math.abs(TIMING_DESIGN[0] - 6.0) < 0.1);
  assert.ok(Math.abs(TIMING_FAB[8] - 30.4) < 0.1);
});

test("fab crests at the install month", () => {
  assert.equal(Math.max(...TIMING_FAB), TIMING_FAB[8]);
});

test("resampleTiming normalises to 1 for any length", () => {
  for (const len of [1, 2, 5, 9, 16, 30]) {
    const r = resampleTiming(TIMING_FAB, len);
    assert.equal(r.length, Math.max(1, len));
    assert.ok(Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});

test("expectedBurn runs 0→1 and is monotonic", () => {
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = expectedBurn(i / 20, null);
    assert.ok(v >= prev);
    prev = v;
  }
  assert.ok(Math.abs(expectedBurn(0, null)) < 0.02);
  assert.ok(Math.abs(expectedBurn(1, null) - 1) < 1e-9);
});

test("every calibration project has 9+9 steps", () => {
  for (const p of TIMING_PROJECTS) {
    assert.equal(p.d9.length, 9, p.n);
    assert.equal(p.f9.length, 9, p.n);
  }
});

test("interpTiming hits step centres", () => {
  assert.ok(Math.abs(interpTiming(TIMING_DESIGN, 0.5 / 9) - TIMING_DESIGN[0]) < 1e-9);
});
