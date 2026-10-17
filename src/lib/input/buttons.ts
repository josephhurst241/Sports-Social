import { ISLANDS } from "@/lib/hub/islands";
import { P } from "@/lib/net/protocol";
import { makeSwingPaddle, stepSwingPaddle } from "./paddle";

// Buttons mode: the phone generates the same telemetry packet the motion
// sensors would, from on-screen buttons, so the laptop's games run unchanged.
// Each scene gets an ideal version of its motion:
//
// - hub:      the phone points like a remote at one of the islands; ◀ ▶ hop
//             between them, Select taps the grip.
// - pingpong: one Swing button. Hold to wind up (and toss the serve), release
//             to swing (the one-button paddle the CPU uses).
// - bowling:  hold Bowl to swing the arm back (longer = faster ball), release
//             to swing it through and let go at the bottom. ◀ ▶ aim.
// - golf:     the same with the putter: hold Putt for a longer backswing (more
//             power), release to stroke. ◀ ▶ aim.
//
// Orientation conventions match the sensors (see writeOrientationQuat):
// identity = phone upright, screen toward the player, top up; yaw is about +Y
// with + turning left; pitch is about +X with + swinging the bottom forward.

export type ButtonScene = "hub" | "pingpong" | "bowling" | "golf";

/** Island headings left to right on screen, radians (+ = left). */
const ISLAND_YAWS = [...ISLANDS].sort((a, b) => b.angle - a.angle).map((i) => (i.angle * Math.PI) / 180);
const ISLAND_NAMES = [...ISLANDS].sort((a, b) => b.angle - a.angle).map((i) => i.name);
/** Pointing a little above level reaches the islands floating 2-3 m up. */
const AIM_ELEVATION = (4 * Math.PI) / 180;

/** Swing recipes (radians of pitch, seconds) for the pendulum arm. */
const SWINGS = {
  bowling: { minBack: 0.2, maxBack: 1.2, fullHold: 1.1, through: 1.0, throughTime: 0.42 },
  golf: { minBack: 0.02, maxBack: 0.5, fullHold: 1.5, through: 0.3, throughTime: 0.4 },
} as const;
const AIM_STEP = { bowling: 0.07, golf: 0.06 } as const;
const AIM_LIMIT = { bowling: 0.28, golf: 1.2 } as const;
/** After the stroke, how long the grip stays down past the bottom, and the return to rest. */
const RECOVER_TIME = 0.5;
const SELECT_PULSE = 0.15;

export interface ButtonState {
  scene: ButtonScene;
  island: number;
  aim: number;
  held: boolean;
  holdTime: number;
  phase: "rest" | "back" | "through" | "recover";
  back: number;
  pitch: number;
  t: number;
  selectPulse: number;
  paddle: ReturnType<typeof makeSwingPaddle>;
}

export function createButtonState(): ButtonState {
  return {
    scene: "hub",
    island: 1, // the middle island
    aim: 0,
    held: false,
    holdTime: 0,
    phase: "rest",
    back: 0,
    pitch: 0,
    t: 0,
    selectPulse: 0,
    paddle: makeSwingPaddle(),
  };
}

export const islandName = (s: ButtonState) => ISLAND_NAMES[s.island];

/** 0..1, how far the current backswing has wound (for the power meter). */
export function power(s: ButtonState) {
  if (s.scene !== "bowling" && s.scene !== "golf") return 0;
  const r = SWINGS[s.scene];
  return s.phase === "back" ? (s.back - r.minBack) / (r.maxBack - r.minBack) : 0;
}

export function setScene(s: ButtonState, scene: ButtonScene) {
  if (s.scene === scene) return;
  s.scene = scene;
  s.aim = 0;
  s.held = false;
  s.phase = "rest";
  s.pitch = 0;
}

/** ◀ (-1) or ▶ (+1). */
export function nudge(s: ButtonState, dir: -1 | 1) {
  if (s.scene === "hub") s.island = Math.max(0, Math.min(ISLAND_YAWS.length - 1, s.island + dir));
  else if (s.scene === "bowling" || s.scene === "golf") {
    // ▶ turns the shot right, which is a negative heading.
    s.aim = Math.max(-AIM_LIMIT[s.scene], Math.min(AIM_LIMIT[s.scene], s.aim - dir * AIM_STEP[s.scene]));
  }
}

export function press(s: ButtonState) {
  s.held = true;
  if (s.scene === "hub") s.selectPulse = SELECT_PULSE;
  if ((s.scene === "bowling" || s.scene === "golf") && s.phase === "rest") {
    s.phase = "back";
    s.holdTime = 0;
    s.back = 0;
  }
}

export function release(s: ButtonState) {
  s.held = false;
  if ((s.scene === "bowling" || s.scene === "golf") && s.phase === "back") {
    s.phase = "through";
    s.t = 0;
  }
}

const quat = (out: Float32Array, yaw: number, pitch: number) => {
  // q = yaw(about +Y) * pitch(about +X)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  out[P.QX] = cy * sp;
  out[P.QY] = sy * cp;
  out[P.QZ] = -sy * sp;
  out[P.QW] = cy * cp;
};

/** Advances by dt seconds and writes the packet (time is stamped by the sender). */
export function stepButtons(s: ButtonState, dt: number, packet: Float32Array) {
  packet[P.AX] = packet[P.AY] = packet[P.AZ] = 0;

  if (s.scene === "hub") {
    // Held like a remote: top toward the screen, tipped up a little, turned to the island.
    quat(packet, ISLAND_YAWS[s.island], -Math.PI / 2 + AIM_ELEVATION);
    s.selectPulse = Math.max(0, s.selectPulse - dt);
    packet[P.GRIP] = s.selectPulse > 0 ? 1 : 0;
    return;
  }

  if (s.scene === "pingpong") {
    stepSwingPaddle(s.paddle, s.held, 0, dt, packet);
    return;
  }

  const r = SWINGS[s.scene];
  let grip = 0;
  if (s.phase === "back") {
    s.holdTime += dt;
    const k = Math.min(1, s.holdTime / r.fullHold);
    s.back = r.minBack + (r.maxBack - r.minBack) * k;
    s.pitch += (-s.back - s.pitch) * (1 - Math.exp(-dt * 10));
    grip = 1;
  } else if (s.phase === "through") {
    s.t += dt;
    const k = Math.min(1, s.t / r.throughTime);
    s.pitch = -s.back + (r.through + s.back) * k;
    grip = k < 1 ? 1 : 0; // let go at the end of the swing
    if (k >= 1) {
      s.phase = "recover";
      s.t = 0;
    }
  } else if (s.phase === "recover") {
    s.t += dt;
    s.pitch += (0 - s.pitch) * (1 - Math.exp(-dt * 6));
    if (s.t > RECOVER_TIME) s.phase = "rest";
  } else {
    s.pitch += (0 - s.pitch) * (1 - Math.exp(-dt * 6));
  }
  quat(packet, s.aim, s.pitch);
  packet[P.GRIP] = grip;
}
