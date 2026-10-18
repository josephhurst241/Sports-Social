import type { GameResult } from "../net/protocol.ts";
import { totalScore } from "./bowling.ts";

// A player's record for this session only: kept in the laptop's memory while
// their phone is connected, never stored, and wiped when they leave. Guests
// get one too. (Signed-in players' games are also saved to their career.)

export interface SessionStats {
  games: number;
  wins: number;
  /** Best this session: bowling's highest total, golf's lowest full round vs par. */
  best: { bowling?: number; golf?: number };
}

export const emptySession = (): SessionStats => ({ games: 0, wins: 0, best: {} });

/** The record after one more finished game. */
export function addToSession(s: SessionStats, r: GameResult): SessionStats {
  const best = { ...s.best };
  let won = false;
  if (r.game === "bowling") {
    const total = totalScore(r.rolls);
    best.bowling = Math.max(best.bowling ?? 0, total);
    won = r.won ?? false;
  } else if (r.game === "golf") {
    if (r.strokes.length === r.holes) {
      const vsPar = r.strokes.reduce((a, b) => a + b, 0) - r.par.reduce((a, b) => a + b, 0);
      best.golf = Math.min(best.golf ?? Infinity, vsPar);
    }
    won = r.won ?? false;
  } else {
    won = r.score[0] > r.score[1];
  }
  return { games: s.games + 1, wins: s.wins + (won ? 1 : 0), best };
}
