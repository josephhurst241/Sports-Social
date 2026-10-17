import { P } from "@/lib/net/protocol";

// A one-button paddle: hold to wind up, release to swing. Used by the
// keyboard and the CPU player. It writes the same telemetry packet a phone
// sends (see protocol.ts), so the avatar, physics and rules cannot tell
// which input is driving a slot. When a phone joins the slot it takes over.

/** Paddle heading in radians (0 = face toward the opponent, + = turned to the player's left). */
const READY = -0.35;
const WINDUP = -1.25;
const FOLLOW = 1.15;
/** Wind-up approach rate (1/s), swing duration (s) and recovery rate (1/s). */
const WINDUP_RATE = 14;
export const SWING_TIME = 0.34;
const RECOVER_RATE = 6;

export interface SwingPaddle {
  phase: "ready" | "windup" | "swing";
  heading: number;
  swingFrom: number;
  swingT: number;
  held: boolean;
  aim: number;
}

export const makeSwingPaddle = (): SwingPaddle => ({
  phase: "ready",
  heading: READY,
  swingFrom: READY,
  swingT: 0,
  held: false,
  aim: 0,
});

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Advances the paddle by dt and writes its packet: a yaw-only quaternion plus the grip. */
export function stepSwingPaddle(k: SwingPaddle, held: boolean, aimTarget: number, dt: number, packet: Float32Array) {
  if (held && !k.held) k.phase = "windup";
  if (!held && k.held && k.phase === "windup") {
    k.phase = "swing";
    k.swingFrom = k.heading;
    k.swingT = 0;
  }
  k.held = held;

  if (k.phase === "windup") {
    k.heading += (WINDUP - k.heading) * (1 - Math.exp(-dt * WINDUP_RATE));
  } else if (k.phase === "swing") {
    k.swingT += dt / SWING_TIME;
    k.heading = k.swingFrom + (FOLLOW - k.swingFrom) * smooth(Math.min(1, k.swingT));
    if (k.swingT >= 1) k.phase = "ready";
  } else {
    k.heading += (READY - k.heading) * (1 - Math.exp(-dt * RECOVER_RATE));
  }
  k.aim += (aimTarget - k.aim) * (1 - Math.exp(-dt * 10));

  packet[P.TIME] = performance.now();
  packet[P.AX] = packet[P.AY] = packet[P.AZ] = 0;
  // Yaw about +Y: the paddle stands upright, its face (the phone's screen, as
  // a player holds it) turned by `heading`, hence the extra half turn.
  const yaw = k.heading + Math.PI;
  packet[P.QX] = 0;
  packet[P.QY] = Math.sin(yaw / 2);
  packet[P.QZ] = 0;
  packet[P.QW] = Math.cos(yaw / 2);
  packet[P.GRIP] = held ? 1 : 0;
}
