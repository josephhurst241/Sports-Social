// Mini golf: three holes on a putting green. Each hole is drawn on its own,
// centered at the origin: a rectangular green (+Z is the tee end), the tee,
// the cup and glass blocks in the way.

export interface Hole {
  name: string;
  par: number;
  /** Green width (x) and depth (z), meters. */
  size: [number, number];
  tee: [number, number];
  cup: [number, number];
  /** Obstacles as [x, z, width, depth]. */
  blocks: [number, number, number, number][];
}

export const HOLES: Hole[] = [
  { name: "Straight Away", par: 2, size: [2.4, 9], tee: [0, 3.6], cup: [0, -3.4], blocks: [] },
  {
    name: "The Gate",
    par: 2,
    size: [3, 10],
    tee: [0, 4],
    cup: [0.4, -3.8],
    blocks: [
      [-0.95, 0, 1.1, 0.3],
      [0.95, 0, 1.1, 0.3],
    ],
  },
  {
    name: "Slalom",
    par: 3,
    size: [3, 12],
    tee: [-0.8, 5],
    cup: [0.8, -5],
    blocks: [
      [-0.6, 2, 1.8, 0.25],
      [0.6, -1.5, 1.8, 0.25],
    ],
  },
];

export const PAR = HOLES.reduce((n, h) => n + h.par, 0);

export const BALL_R = 0.035;
/** Mini golf's generous cup: 15 cm across (a real one is 10.8 cm). */
export const CUP_R = 0.075;

// The cup edge. A ball whose center crosses the rim loses the turf under it
// and falls for as long as it takes to cross the hole (the chord along its
// line). How far it has sunk when it reaches the far rim decides: deep enough
// and the rim meets it above its middle and it drops; a little and the rim
// grabs its lower half and spins it out; barely and it skims over. So speed
// and line together decide, with no single cutoff.

/** Gravity in the cup model, m/s². */
export const CUP_G = 9.81;
/** Sunk at least this many ball radii at the far rim: it drops (dead center, below about 1.9 m/s). Forgiving: a real cup wants about a full radius. */
export const DROP_DEPTH = 0.85;
/** Sunk less than this many radii: it hops over the hole; in between, a lip-out (dead center, hops above about 3.2 m/s). */
export const LIP_DEPTH = 0.3;
/** The most a lip-out turns the ball, radians: a deep catch on an off-center line curls furthest around the rim. */
export const LIP_TURN = 1.4;
/** Share of its speed a lip-out keeps: a glancing catch keeps the first, a near drop the second. */
export const LIP_KEEP: readonly [number, number] = [0.8, 0.35];
/** Share of its speed a hop keeps. */
export const HOP_KEEP = 0.85;

export interface CupPass {
  /** "miss": the ball's center never passes over the hole. */
  kind: "miss" | "drop" | "lip" | "hop";
  /** Length of the ball's path across the hole, m. */
  chord: number;
  /** How far it has sunk at the far rim, in ball radii. */
  depth: number;
  /** Lip-out only: how far the rim turns it, radians (toward the cup's center side). */
  turn: number;
  /** Share of its speed it leaves with (lip-out, hop). */
  keep: number;
}

/**
 * What the cup does to a ball rolling at `speed` (m/s) whose line passes
 * `offset` meters from the cup's center (either side).
 */
export function cupOutcome(speed: number, offset: number): CupPass {
  const b = Math.abs(offset);
  if (b >= CUP_R) return { kind: "miss", chord: 0, depth: 0, turn: 0, keep: 1 };
  const chord = 2 * Math.sqrt(CUP_R * CUP_R - b * b);
  const t = speed > 0 ? chord / speed : Infinity;
  const depth = (0.5 * CUP_G * t * t) / BALL_R;
  if (depth >= DROP_DEPTH) return { kind: "drop", chord, depth, turn: 0, keep: 0 };
  if (depth < LIP_DEPTH) return { kind: "hop", chord, depth, turn: 0, keep: HOP_KEEP };
  const grip = (depth - LIP_DEPTH) / (DROP_DEPTH - LIP_DEPTH); // 0 glancing, 1 nearly in
  return {
    kind: "lip",
    chord,
    depth,
    turn: LIP_TURN * grip * (b / CUP_R),
    keep: LIP_KEEP[0] + (LIP_KEEP[1] - LIP_KEEP[0]) * grip,
  };
}

/** The fastest a ball can be going and still drop, on a line `offset` from the center. */
export function dropSpeed(offset: number) {
  const b = Math.min(Math.abs(offset), CUP_R);
  return (2 * Math.sqrt(CUP_R * CUP_R - b * b)) / Math.sqrt((2 * DROP_DEPTH * BALL_R) / CUP_G);
}

export function scoreName(strokes: number, par: number) {
  const d = strokes - par;
  if (strokes === 1) return "Hole in one!";
  return d <= -2 ? "Eagle" : d === -1 ? "Birdie" : d === 0 ? "Par" : d === 1 ? "Bogey" : `+${d}`;
}
