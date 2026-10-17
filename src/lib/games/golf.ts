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
export const CUP_R = 0.075;
/** A ball over the cup at or below this speed drops in (faster ones lip out). */
export const CUP_SPEED = 1.3;

export function scoreName(strokes: number, par: number) {
  const d = strokes - par;
  if (strokes === 1) return "Hole in one!";
  return d <= -2 ? "Eagle" : d === -1 ? "Birdie" : d === 0 ? "Par" : d === 1 ? "Bogey" : `+${d}`;
}
