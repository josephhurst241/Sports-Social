import assert from "node:assert/strict";
import { test } from "node:test";
import { CUP_R, HOP_KEEP, cupOutcome, dropSpeed } from "./golf.ts";

// The cup edge model: speed and line decide drop / lip-out / hop.
// Run with `npm test` (Node's built-in runner, which strips the types).

test("dead center: slow drops, medium lips out, fast hops", () => {
  assert.equal(cupOutcome(0.5, 0).kind, "drop");
  assert.equal(cupOutcome(1.7, 0).kind, "drop");
  assert.equal(cupOutcome(2.3, 0).kind, "lip");
  assert.equal(cupOutcome(4, 0).kind, "hop");
});

test("a ball that stops over the cup drops", () => {
  assert.equal(cupOutcome(0, 0.05).kind, "drop");
});

test("an edge line drops only when slower than a center line", () => {
  assert.ok(dropSpeed(0.06) < dropSpeed(0.03));
  assert.ok(dropSpeed(0.03) < dropSpeed(0));
  // 1.5 m/s drops dead center but not 6 cm out, where the hole is narrower
  assert.equal(cupOutcome(1.5, 0).kind, "drop");
  assert.notEqual(cupOutcome(1.5, 0.06).kind, "drop");
});

test("a line that never brings the ball's center over the hole is a miss", () => {
  assert.equal(cupOutcome(1, CUP_R).kind, "miss");
  assert.equal(cupOutcome(1, -0.2).kind, "miss");
});

test("either side of the center behaves the same", () => {
  assert.deepEqual(cupOutcome(2.2, 0.04), cupOutcome(2.2, -0.04));
});

test("outcomes go drop, then lip-out, then hop as the ball speeds up", () => {
  const order = ["drop", "lip", "hop"];
  for (const offset of [0, 0.03, 0.06]) {
    let last = 0;
    for (let v = 0.1; v < 6; v += 0.05) {
      const i = order.indexOf(cupOutcome(v, offset).kind);
      assert.ok(i >= last, `offset ${offset}: ${order[i]} after ${order[last]} at ${v.toFixed(2)} m/s`);
      last = i;
    }
    assert.equal(last, 2, `offset ${offset}: a fast enough ball hops`);
  }
});

test("there is no hard cutoff: the drop speed is the boundary", () => {
  for (const offset of [0, 0.04, 0.07]) {
    const v = dropSpeed(offset);
    assert.equal(cupOutcome(v * 0.99, offset).kind, "drop");
    assert.equal(cupOutcome(v * 1.01, offset).kind, "lip");
  }
});

test("a lip-out turns more and keeps less speed the closer it came to dropping", () => {
  const glancing = cupOutcome(2.4, 0.04);
  const deep = cupOutcome(1.7, 0.04);
  assert.equal(glancing.kind, "lip");
  assert.equal(deep.kind, "lip");
  assert.ok(deep.turn > glancing.turn);
  assert.ok(deep.keep < glancing.keep);
  // dead center: the rim pushes straight back, no curl
  assert.equal(cupOutcome(2.3, 0).turn, 0);
});

test("a hop keeps most of its speed", () => {
  assert.equal(cupOutcome(5, 0.02).keep, HOP_KEEP);
});
