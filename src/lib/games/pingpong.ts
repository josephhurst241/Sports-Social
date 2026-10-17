import { Vector3 } from "three";
import { PLAYER_NAMES, type PlayerSlot } from "@/lib/net/protocol";
import { useGameStore } from "@/store/gameStore";

// Table layout, meters. Origin is the table center on the floor, the long
// axis along Z. Player 1 stands at +Z facing -Z, the opponent at -Z facing +Z.
export const TABLE = {
  length: 2.74,
  width: 1.525,
  height: 0.76,
  topThickness: 0.04,
  netHeight: 0.1525,
  netOverhang: 0.15,
} as const;
export const BALL_RADIUS = 0.032; // 1.6x a real ball, so it reads on screen
export const PLAYER_Z = 1.85;

// Ping pong rules state shared by the table/ball logic, the paddles and the
// CPU. Plain module state: it changes every frame and no React tree reads it.

export type Phase = "idle" | "play" | "dead";

export const G = 9.81;
const TOP_Y = TABLE.height;
const HALF_L = TABLE.length / 2;
const HALF_W = TABLE.width / 2;
const TABLE_E = 0.875; // ball-on-table restitution (ITTF: 30 cm drop -> ~23 cm bounce)
export const POINTS_TO_WIN = 11;

export const game = {
  phase: "idle" as Phase,
  server: 0 as PlayerSlot,
  phaseAt: 0,
  /** Who touched the ball last. */
  lastHitter: null as PlayerSlot | null,
  lastHitAt: 0,
  /** Since the last hit: bounces on the receiver's half, and whether it touched the net. */
  farBounces: 0,
  touchedNet: false,
  /** A paddle hit waiting for the assist to shape the ball's arc (next physics step). */
  pendingAssist: null as PlayerSlot | null,
  /** Points played this game, for switching serve every two. */
  pointsPlayed: 0,
  /** Ball state copied out of physics each frame (world space). */
  ballPos: new Vector3(0, 1, 0),
  ballVel: new Vector3(),
};

/** A paddle met the ball, by contact or by the swing's near-miss allowance. */
export function onPaddleHit(slot: PlayerSlot) {
  const now = performance.now();
  // One swing can produce several contact events; count it once.
  if (game.phase !== "play" || (game.lastHitter === slot && now - game.lastHitAt < 400)) return;
  game.lastHitter = slot;
  game.lastHitAt = now;
  game.farBounces = 0;
  game.touchedNet = false;
  game.pendingAssist = slot;
  const pp = useGameStore.getState().pingpong;
  useGameStore.setState({ pingpong: { ...pp, rally: pp.rally + 1 } });
}

/** Called when the ball touches the table top or the net. */
export function onBallTouch(what: "table" | "net", z: number) {
  if (what === "net") {
    game.touchedNet = true;
    return;
  }
  // Player 1's half is +Z. Count bounces on the half opposite the hitter.
  if (game.lastHitter !== null && Math.sign(z) === (game.lastHitter === 0 ? -1 : 1)) game.farBounces++;
}

/** Ends the rally: scores it, sets the callout and the next server. */
export function endRally(winner: PlayerSlot, reason: string) {
  const pp = useGameStore.getState().pingpong;
  const score = [...pp.score] as [number, number];
  score[winner]++;
  const name = (slot: PlayerSlot) => (slot === 1 && pp.cpu ? "CPU" : PLAYER_NAMES[slot]);
  const lead = Math.abs(score[0] - score[1]);
  const over = Math.max(...score) >= POINTS_TO_WIN && lead >= 2;
  const text = over
    ? `${name(winner)} wins ${Math.max(...score)}–${Math.min(...score)}`
    : `${reason} · ${name(winner)} scores`;
  game.pointsPlayed++;
  if (game.pointsPlayed % 2 === 0) game.server = (1 - game.server) as PlayerSlot;
  if (over) game.pointsPlayed = 0;
  useGameStore.setState({
    pingpong: { ...pp, score: over ? [0, 0] : score },
    callout: { text, at: performance.now() },
  });
}

/**
 * Velocity that carries the ball from `from` to land at (x, z) on the table
 * with the given horizontal speed, slowed down as needed so it clears the net.
 */
export function solveArc(from: Vector3, x: number, z: number, speed: number, out: Vector3) {
  const dx = x - from.x;
  const dz = z - from.z;
  const dist = Math.hypot(dx, dz);
  let T = dist / speed;
  const y1 = TOP_Y + BALL_RADIUS;
  const netTop = TOP_Y + TABLE.netHeight + BALL_RADIUS + 0.06;
  for (let i = 0; i < 12; i++) {
    const vy = (y1 - from.y + 0.5 * G * T * T) / T;
    const tn = -from.z / (dz / T); // time to reach the net plane (z = 0)
    if (tn <= 0 || tn >= T || from.y + vy * tn - 0.5 * G * tn * tn >= netTop) {
      return out.set(dx / T, vy, dz / T);
    }
    T *= 1.12;
  }
  return out.set(dx / T, (y1 - from.y + 0.5 * G * T * T) / T, dz / T);
}

/**
 * Where the ball will be when it reaches the plane z = planeZ, following
 * gravity and table bounces. Returns false if it never gets there.
 */
export function predictAtPlane(pos: Vector3, vel: Vector3, planeZ: number, out: Vector3): boolean {
  let x = pos.x, y = pos.y, z = pos.z;
  const vx = vel.x, vz = vel.z;
  let vy = vel.y;
  const dt = 1 / 120;
  for (let i = 0; i < 300; i++) {
    const nz = z + vz * dt;
    if ((z - planeZ) * (nz - planeZ) <= 0) {
      out.set(x, y, planeZ);
      return true;
    }
    x += vx * dt;
    z = nz;
    vy -= G * dt;
    y += vy * dt;
    if (vy < 0 && y - BALL_RADIUS <= TOP_Y && y > TOP_Y - 0.05 && Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_L) {
      y = TOP_Y + BALL_RADIUS;
      vy = -vy * TABLE_E;
    }
    if (y < 0.2) return false;
  }
  return false;
}
