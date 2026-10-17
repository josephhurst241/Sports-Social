import assert from "node:assert/strict";
import { test } from "node:test";
import { isSplit, position, scorecard, strikeStreak, totalScore } from "./bowling.ts";

// Ten-pin rules. Run with `npm test`.

const pins = (...up: number[]) => Array.from({ length: 10 }, (_, i) => up.includes(i));

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

test("splits: headpin down, standing pins in separate groups", () => {
  assert.equal(isSplit(pins(6, 9)), true); // 7-10
  assert.equal(isSplit(pins(3, 5)), true); // 4-6
  assert.equal(isSplit(pins(4, 6, 9)), true); // 5-7-10
  assert.equal(isSplit(pins(1, 3)), false); // 2-4: touching
  assert.equal(isSplit(pins(3, 6)), false); // 4-7: touching
  assert.equal(isSplit(pins(0, 6, 9)), false); // headpin still up
  assert.equal(isSplit(pins(9)), false); // one pin is not a split
});

test("strike streaks count frames in a row, not spares that end on a ten", () => {
  assert.equal(strikeStreak([10, 10, 10]), 3);
  assert.equal(strikeStreak([10, 10, 3]), 0);
  assert.equal(strikeStreak([0, 10]), 0); // a spare
  assert.equal(strikeStreak([0, 10, 10]), 1);
  assert.equal(strikeStreak(Array(12).fill(10)), 12);
  // Tenth frame: strike, then a spare attempt that knocks down the rest is not a strike
  assert.equal(strikeStreak([...Array(18).fill(0), 10, 4, 6]), 0);
  assert.equal(strikeStreak([...Array(18).fill(0), 7, 3, 10]), 1);
});
