import assert from "node:assert/strict";
import { test } from "node:test";
import { AIM_PULL, assistAim } from "./assist.ts";

// Aim assist. Run with `npm test`.

const SNAP = 0.06;

test("near the line, the aim is drawn most of the way to it", () => {
  assert.ok(Math.abs(assistAim(0.04, SNAP) - 0.04 * (1 - AIM_PULL)) < 1e-12);
  assert.ok(Math.abs(assistAim(-0.04, SNAP) + 0.04 * (1 - AIM_PULL)) < 1e-12);
  assert.equal(assistAim(0, SNAP), 0);
  assert.ok(AIM_PULL > 0.5, "stronger than the old halfway pull");
});

test("it never jumps: both sides of the snap edge agree", () => {
  assert.ok(Math.abs(assistAim(SNAP, SNAP) - assistAim(SNAP + 1e-9, SNAP)) < 1e-6);
});

test("a deliberately wide aim stays wide, only nudged by the pull", () => {
  assert.ok(Math.abs(assistAim(0.5, SNAP) - (0.5 - SNAP * AIM_PULL)) < 1e-12);
  assert.ok(Math.abs(assistAim(-0.5, SNAP) - (-0.5 + SNAP * AIM_PULL)) < 1e-12);
});

test("the assist never flips the side you aimed at", () => {
  for (let a = -1; a <= 1; a += 0.01) assert.ok(Math.sign(assistAim(a, SNAP)) === Math.sign(a) || Math.abs(a) < 1e-9);
});
