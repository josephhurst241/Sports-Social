import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AIM_ZERO_MAX,
  REPS_MAX,
  SENSITIVITY_LIMITS,
  SWING_LIMITS,
  TARGET_SWING,
  cleanSensitivity,
  gameCal,
  percentile,
  repsDone,
} from "./calibration.ts";

// Per-game motion calibration. Run with `npm test`.

test("fewer than three reps is never enough", () => {
  assert.equal(repsDone([]), false);
  assert.equal(repsDone([1.4, 1.5]), false);
});

test("three consistent reps are enough", () => {
  assert.equal(repsDone([1.4, 1.5, 1.45]), true);
});

test("inconsistent reps keep going, until the last three agree", () => {
  assert.equal(repsDone([0.5, 2.5, 1.4]), false);
  assert.equal(repsDone([0.5, 2.5, 1.4, 1.5, 1.45]), true); // the last three agree
});

test("it stops waiting after six reps, agreeing or not", () => {
  assert.equal(repsDone(Array.from({ length: REPS_MAX }, (_, i) => (i % 2 ? 0.5 : 2.5))), true);
});

test("a natural swing at the target needs no change; gentle swings get help", () => {
  assert.equal(gameCal("bowling", [TARGET_SWING.bowling, TARGET_SWING.bowling, TARGET_SWING.bowling], []).swing, 1);
  assert.ok(gameCal("golf", [1.0, 1.0, 1.0], []).swing > 1);
  assert.equal(gameCal("golf", [0.2, 0.2, 0.2], []).swing, SWING_LIMITS[1]);
});

test("the swing uses the median of the last three, so one odd rep cannot skew it", () => {
  const t = TARGET_SWING.bowling;
  assert.equal(gameCal("bowling", [9, 9, t, t, 6], []).swing, 1);
});

test("the aim zero is where they naturally point at release, within limits", () => {
  assert.ok(Math.abs(gameCal("golf", [1.47, 1.47, 1.47], [0.1, 0.12, 0.08]).aimZero - 0.1) < 1e-9);
  assert.equal(gameCal("golf", [1.47, 1.47, 1.47], [1, 1, 1]).aimZero, AIM_ZERO_MAX);
  // Ping pong aims by timing, not a release direction: no zero.
  assert.equal(gameCal("pingpong", [3.6, 3.6, 3.6], [0.3, 0.3, 0.3]).aimZero, 0);
});

test("percentile picks the value that share of the way up the samples", () => {
  assert.equal(percentile([5, 1, 3], 0.5), 3);
  assert.equal(percentile([], 0.5), 0);
});

test("a sensitivity from a phone is kept within 0.5x to 2x, and junk is ignored", () => {
  assert.equal(cleanSensitivity(1.25), 1.25);
  assert.equal(cleanSensitivity(9), SENSITIVITY_LIMITS[1]);
  assert.equal(cleanSensitivity(0.1), SENSITIVITY_LIMITS[0]);
  assert.equal(cleanSensitivity("2"), 1);
  assert.equal(cleanSensitivity(Number.NaN), 1);
});
