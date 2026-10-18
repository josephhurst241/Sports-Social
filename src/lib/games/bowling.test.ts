import assert from "node:assert/strict";
import { test } from "node:test";
import { position, scorecard, totalScore } from "./bowling.ts";

// Ten-pin rules. Run with `npm test`.

test("a perfect game is 300", () => {
  const rolls = Array(12).fill(10);
  assert.equal(totalScore(rolls), 300);
  assert.equal(position(rolls).over, true);
});

test("all spares of 5 with a final 5 is 150", () => {
  assert.equal(totalScore(Array(21).fill(5)), 150);
});

test("an open game ends after 20 balls", () => {
  const rolls = Array(20).fill(4);
  assert.equal(totalScore(rolls), 80);
  assert.equal(position(rolls).over, true);
});

test("a strike is not scored until its two bonus balls are in", () => {
  assert.equal(scorecard([10, 3]).at(0)!.total, null);
  assert.equal(scorecard([10, 3, 4])[0].total, 17);
});

test("the tenth frame gives a third ball only after a strike or spare", () => {
  assert.equal(position([...Array(18).fill(0), 3, 4]).over, true);
  assert.equal(position([...Array(18).fill(0), 7, 3]).over, false);
  assert.equal(position([...Array(18).fill(0), 10, 2]).over, false);
});
