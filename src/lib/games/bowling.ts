// Ten-pin bowling rules: where the game stands after a list of rolls, and
// the scorecard. Pure functions of the rolls (pins knocked per ball).

export const PINS = 10;

export interface Position {
  frame: number; // 0..9
  ball: number; // 0, 1, or 2 (tenth frame only)
  /** Pins standing before this ball: 10 means a fresh rack. */
  standing: number;
  over: boolean;
}

export function position(rolls: number[]): Position {
  let i = 0;
  for (let frame = 0; frame < 9; frame++) {
    if (rolls[i] === undefined) return { frame, ball: 0, standing: 10, over: false };
    if (rolls[i] === 10) {
      i += 1;
      continue;
    }
    if (rolls[i + 1] === undefined) return { frame, ball: 1, standing: 10 - rolls[i], over: false };
    i += 2;
  }
  // Tenth frame: up to three balls, re-racked after a strike or spare
  const [a, b, c] = [rolls[i], rolls[i + 1], rolls[i + 2]];
  if (a === undefined) return { frame: 9, ball: 0, standing: 10, over: false };
  if (b === undefined) return { frame: 9, ball: 1, standing: a === 10 ? 10 : 10 - a, over: false };
  if (a + b < 10) return { frame: 9, ball: 2, standing: 0, over: true };
  if (c === undefined) {
    const standing = a === 10 && b < 10 ? 10 - b : 10;
    return { frame: 9, ball: 2, standing, over: false };
  }
  return { frame: 9, ball: 3, standing: 0, over: true };
}

export interface FrameCard {
  marks: string[];
  /** Running total once the frame can be scored, else null. */
  total: number | null;
}

/** Scorecard marks (X strike, / spare, - miss) and running totals, standard scoring. */
export function scorecard(rolls: number[]): FrameCard[] {
  const frames: FrameCard[] = [];
  let i = 0;
  let total = 0;
  const mark = (n: number) => (n === 0 ? "-" : String(n));
  for (let f = 0; f < 10; f++) {
    const a = rolls[i], b = rolls[i + 1], c = rolls[i + 2];
    if (a === undefined) {
      frames.push({ marks: [], total: null });
      continue;
    }
    if (f < 9) {
      if (a === 10) {
        const scored = b !== undefined && c !== undefined;
        if (scored) total += 10 + b + c;
        frames.push({ marks: ["X"], total: scored ? total : null });
        i += 1;
      } else if (b === undefined) {
        frames.push({ marks: [mark(a)], total: null });
        i += 1;
      } else if (a + b === 10) {
        const scored = c !== undefined;
        if (scored) total += 10 + c;
        frames.push({ marks: [mark(a), "/"], total: scored ? total : null });
        i += 2;
      } else {
        total += a + b;
        frames.push({ marks: [mark(a), mark(b)], total });
        i += 2;
      }
    } else {
      const marks = [a === 10 ? "X" : mark(a)];
      if (b !== undefined) marks.push(a !== 10 && a + b === 10 ? "/" : b === 10 ? "X" : mark(b));
      if (c !== undefined) {
        const spareC = b !== 10 && a === 10 && b + c === 10;
        marks.push(c === 10 ? "X" : spareC ? "/" : mark(c));
      }
      const done = b !== undefined && (a + b < 10 || c !== undefined);
      if (done) total += a + (b ?? 0) + (c ?? 0);
      frames.push({ marks, total: done ? total : null });
    }
  }
  return frames;
}

/** The final (or running) score: the last scored frame's total. */
export function totalScore(rolls: number[]) {
  const card = scorecard(rolls);
  for (let f = card.length - 1; f >= 0; f--) if (card[f].total !== null) return card[f].total!;
  return 0;
}
