import assert from "node:assert/strict";
import { test } from "node:test";
import { LINES, pickLine, priorityOf } from "./lines.ts";
import { CHATTER_GAP, MIN_GAP, Pacer, type Line } from "./pacer.ts";

// The narrator's lines and pacing. Run with `npm test`.

const line = (type: string, priority: 1 | 2 | 3, at: number, ttl = 3): Line => ({ type, text: type, priority, at, ttl });

test("a line never repeats the last variant for that event", () => {
  const last = new Map<string, number>();
  let prev = "";
  for (let i = 0; i < 50; i++) {
    const text = pickLine({ type: "strike", name: "Ana" }, last);
    assert.notEqual(text, prev);
    prev = text;
  }
});

test("names and fields fill in; no braces are left", () => {
  const last = new Map<string, number>();
  for (let i = 0; i < 10; i++) {
    const t = pickLine({ type: "longRally", name: "Ana", hits: 12 }, last);
    assert.ok(!t.includes("{"), t);
  }
  const hole = pickLine({ type: "hole", name: "Ana", result: "eagle", strokes: 1 }, new Map(), () => 0.99);
  assert.equal(hole, "That's an eagle, Ana.");
  assert.match(pickLine({ type: "matchStart", game: "pingpong", players: "Ana and the CPU" }, new Map()), /ping pong|Ana and the CPU/);
});

test("a tie has no winner in its line", () => {
  const t = pickLine({ type: "matchEnd", game: "bowling", winner: null, score: "120–120" }, new Map());
  assert.ok(!/Nobody|undefined/.test(t), t);
  assert.ok(t.includes("120–120"));
});

test("every event has at least two variants, each short", () => {
  for (const [type, set] of Object.entries(LINES)) {
    assert.ok(set.lines.length >= 2, type);
    // About two seconds at a narrator's pace: roughly 12 words with the fields filled
    for (const l of set.lines) assert.ok(l.split(" ").length <= 12, `${type}: ${l}`);
  }
});

test("one line at a time, with a gap between", () => {
  const p = new Pacer();
  p.push(line("a", 2, 0), 0);
  p.push(line("b", 2, 0), 0);
  const a = p.next(0)!;
  assert.equal(a.type, "a");
  assert.equal(p.next(0.5), null); // still speaking
  p.ended(a, 1);
  assert.equal(p.next(1 + MIN_GAP / 2), null); // the gap
  assert.equal(p.next(1 + MIN_GAP)!.type, "b");
});

test("a big moment interrupts a smaller line; an equal one waits", () => {
  const p = new Pacer();
  p.push(line("spare", 2, 0), 0);
  p.next(0);
  assert.equal(p.push(line("deuce", 2, 0.1), 0.1), "queued");
  assert.equal(p.push(line("strike", 3, 0.2), 0.2), "interrupt");
  assert.equal(p.next(0.2)!.type, "strike"); // at once, no gap
});

test("small talk is dropped while busy or recently spoken", () => {
  const p = new Pacer();
  assert.equal(p.push(line("point", 1, 0), 0), "queued");
  const first = p.next(0)!;
  assert.equal(p.push(line("point", 1, 0.5), 0.5), "dropped"); // speaking
  p.ended(first, 1);
  assert.equal(p.push(line("point", 1, 3), 3), "dropped"); // only 3 s since the last line
  assert.equal(p.push(line("point", 1, CHATTER_GAP + 1), CHATTER_GAP + 1), "queued");
});

test("stale lines are dropped, and the queue keeps the most important", () => {
  const p = new Pacer();
  const now = p.next(0); // nothing
  assert.equal(now, null);
  p.push(line("join", 2, 0, 3), 0);
  assert.equal(p.next(5), null); // waited 5 s, its ttl was 3
  const q = new Pacer();
  q.current = line("talking", 3, 0);
  for (const [i, pr] of ([2, 2, 3, 2] as const).entries()) q.push(line(`l${i}`, pr, i * 0.1), i * 0.1);
  assert.deepEqual(q.queue.map((l) => l.type), ["l2", "l0", "l1"]);
});

test("a one-player result has its own lines (no 'wins')", () => {
  const t = pickLine({ type: "matchEnd", game: "golf", winner: "Ana", score: "8 strokes, 1 over", solo: true }, new Map());
  assert.ok(!/wins/.test(t), t);
  assert.ok(t.includes("Ana") && t.includes("8 strokes"), t);
});

test("a birdie is news, a par is small talk", () => {
  assert.equal(priorityOf({ type: "hole", name: "Ana", result: "birdie", strokes: 2 }), 2);
  assert.equal(priorityOf({ type: "hole", name: "Ana", result: "par", strokes: 3 }), 1);
  assert.equal(priorityOf({ type: "strike", name: "Ana" }), 3);
});
