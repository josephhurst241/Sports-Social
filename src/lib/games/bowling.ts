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

// Pins are numbered row by row from the headpin: 0 | 1 2 | 3 4 5 | 6 7 8 9.
const ROW_OF = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3];
const ROW_START = [0, 1, 3, 6];

/** Pins touching each other in the rack: beside each other in a row, or diagonal between rows. */
function adjacent(a: number, b: number) {
  const [ra, rb] = [ROW_OF[a], ROW_OF[b]];
  const [ia, ib] = [a - ROW_START[ra], b - ROW_START[rb]];
  if (ra === rb) return Math.abs(ia - ib) === 1;
  if (Math.abs(ra - rb) !== 1) return false;
  // The pin in the row behind sits between two in front: (r, i) touches (r + 1, i) and (r + 1, i + 1).
  const [front, back] = ra < rb ? [ia, ib] : [ib, ia];
  return back === front || back === front + 1;
}

/**
 * A split: the headpin is down and the pins still standing (two or more)
 * fall into separate groups with no pin between them, which makes the spare hard.
 */
export function isSplit(standing: readonly boolean[]) {
  if (standing[0]) return false;
  const up = standing.flatMap((s, i) => (s ? [i] : []));
  if (up.length < 2) return false;
  // Flood one group from the first standing pin; a split leaves some unreached.
  const seen = new Set([up[0]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of up) {
      if (!seen.has(p) && [...seen].some((q) => adjacent(p, q))) {
        seen.add(p);
        grew = true;
      }
    }
  }
  return seen.size < up.length;
}

/** Strikes in a row at the end of these rolls (the current streak; 0 if the last ball was not a strike). */
export function strikeStreak(rolls: number[]) {
  // Walk frame by frame so a 10 that is the second ball of a frame (a spare) is not a strike.
  const strikes: boolean[] = [];
  let i = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (f < 9) {
      strikes.push(rolls[i] === 10);
      i += rolls[i] === 10 ? 1 : 2;
    } else {
      // Tenth frame: every ball that knocks down a fresh rack of ten is a strike.
      const [a, b, c] = [rolls[i], rolls[i + 1], rolls[i + 2]];
      strikes.push(a === 10);
      if (b !== undefined) strikes.push(a === 10 ? b === 10 : false);
      // The third ball meets a fresh rack after two strikes or a spare; otherwise it is a spare attempt.
      if (c !== undefined) strikes.push(((a === 10 && b === 10) || (a !== 10 && a + b === 10)) && c === 10);
      i = rolls.length;
    }
  }
  let n = 0;
  for (let k = strikes.length - 1; k >= 0 && strikes[k]; k--) n++;
  return n;
}
