import assert from "node:assert/strict";
import { test } from "node:test";
import { addToSession, emptySession } from "./session.ts";

// The per-session record. Run with `npm test`.

test("games and wins add up across games", () => {
  let s = emptySession();
  s = addToSession(s, { game: "pingpong", score: [11, 7], opponent: "cpu", opponentName: "CPU" });
  s = addToSession(s, { game: "pingpong", score: [5, 11], opponent: "cpu", opponentName: "CPU" });
  s = addToSession(s, { game: "bowling", rolls: Array(20).fill(4), won: true });
  assert.deepEqual({ games: s.games, wins: s.wins }, { games: 3, wins: 2 });
});

test("bests keep the highest bowling game and the lowest full golf round", () => {
  let s = emptySession();
  s = addToSession(s, { game: "bowling", rolls: Array(20).fill(4) }); // 80
  s = addToSession(s, { game: "bowling", rolls: Array(12).fill(10) }); // 300
  s = addToSession(s, { game: "bowling", rolls: Array(20).fill(1) }); // 20
  s = addToSession(s, { game: "golf", strokes: [3, 3, 4], par: [2, 2, 3], holes: 3 }); // +3
  s = addToSession(s, { game: "golf", strokes: [2, 2, 2], par: [2, 2, 3], holes: 3 }); // -1
  s = addToSession(s, { game: "golf", strokes: [1], par: [2], holes: 3 }); // unfinished: not a best
  assert.deepEqual(s.best, { bowling: 300, golf: -1 });
});

test("a game alone (no 'won') is played, not won", () => {
  const s = addToSession(emptySession(), { game: "golf", strokes: [2, 2, 3], par: [2, 2, 3], holes: 3 });
  assert.deepEqual({ games: s.games, wins: s.wins }, { games: 1, wins: 0 });
});
