import type { RapierRigidBody } from "@react-three/rapier";
import { NEUTRAL_SENSITIVITY, type CalGame, type GameCal, type Sensitivity } from "./calibration";
import { Quaternion, Vector3 } from "three";
import type { PlayerSlot } from "@/lib/net/protocol";

// Per-player pose and game hooks, shared by the avatar (which writes the
// hand) and the scenes and games (which place the player and read the hand).
// Plain mutable objects: they change every frame and no React tree reads them.

/**
 * How the phone moves the hand.
 * - "pointer": the phone is the forearm, pivoting at the elbow, along the
 *   phone's top edge. Hold it like a remote. Used for pointing in the hub.
 * - "paddle": the hand swings around the shoulder, turned by the phone's
 *   facing (the back of the phone is the paddle face). A forehand sweeps the
 *   hand forward across the body. Used for ping pong.
 * - "pendulum": the arm hangs from the shoulder along the phone's bottom
 *   edge, so holding the phone upright lets the arm hang and swinging the
 *   phone swings the arm. Used for bowling and golf.
 */
export type ArmMode = "pointer" | "paddle" | "pendulum";

// Paddle arm, avatar-local (facing -Z, +X = the player's right)
export const SHOULDER = new Vector3(0.15, 1.3, 0);
export const ARM = new Vector3(0.4, -0.3, -0.25);
/** The putter's shaft, hanging from the hand along the phone's bottom edge (golf and its calibration). */
export const PUTTER_SHAFT = 0.74;
/** Paddle blade center above the hand, along the handle (the phone's top axis). */
export const BLADE_OFFSET = 0.13;
/** Paddle blade radius, m: larger than a real one (7.5 cm), so hits are forgiving. */
export const BLADE_RADIUS = 0.13;
/** Blade center at a straight-on hit (swing 0, no height assist), avatar-local. */
export const CONTACT = new Vector3().copy(SHOULDER).add(ARM).add(new Vector3(0, BLADE_OFFSET, 0));

export interface Rig {
  /** Feet position and facing (yaw; forward = (-sin, 0, -cos)), set by the scene. */
  root: Vector3;
  facing: number;
  /** Bumped when a scene places the player somewhere new: snap instead of sweeping. */
  placed: number;
  arm: ArmMode;

  // Written by the avatar every frame (world space)
  handPos: Vector3;
  handQuat: Quaternion;
  /** Hand velocity, m/s, lightly smoothed. */
  handVel: Vector3;
  /** Phone heading relative to facing, radians (+ = turned left). The aim in bowling and golf. */
  heading: number;
  live: boolean;
  grip: boolean;
  /** Speed of the acceleration-driven push (m/s): how hard the phone is being swung. */
  swing: number;

  // Ping pong (paddle arm)
  /** Slide along the baseline toward targetX, and raise the hand by assistY (set by the game). */
  targetX: number;
  slide: boolean;
  assistY: number;
  bladePos: Vector3;
  bladeQuat: Quaternion;
  bladeVel: Vector3;
  /** Paddle arm angle around the shoulder, radians (+ = across the body). */
  paddleSwing: number;
  servePoint: Vector3;
  /** The physics body holding hand and paddle, for exact per-step contact checks. */
  paddleBody: RapierRigidBody | null;
  /**
   * Bumped to capture the player's rest pose for the swing arm (bowling,
   * golf): however they hold the phone at that moment counts as "arm hanging,
   * aimed straight". The scenes bump it when the player lines up a shot.
   */
  neutralSeq: number;
  /**
   * Bumped when calibration finds the player's forward swings playing
   * backward: the phone's compass zero was taken from the face pointing away
   * from the laptop, so the avatar turns its world frame half a turn.
   */
  aboutFaceSeq: number;
  /** This player's motion calibration per game (calibration.ts): swing scale and aim zero; none until measured. */
  games: Partial<Record<CalGame, GameCal>>;
  /** Their own Aim and Swing sensitivity from the phone's Settings, multiplied in on top (1 = as calibrated). */
  sens: Sensitivity;
  /** -1..1, biases where hits land (CPU aim). */
  aim: number;
}

const makeRig = (): Rig => ({
  root: new Vector3(),
  facing: 0,
  placed: 1,
  arm: "pointer",
  handPos: new Vector3(),
  handQuat: new Quaternion(),
  handVel: new Vector3(),
  heading: 0,
  live: false,
  grip: false,
  swing: 0,
  targetX: 0,
  slide: false,
  assistY: 0,
  bladePos: new Vector3(),
  bladeQuat: new Quaternion(),
  bladeVel: new Vector3(),
  paddleSwing: 0,
  servePoint: new Vector3(),
  paddleBody: null,
  aim: 0,
  games: {},
  sens: { ...NEUTRAL_SENSITIVITY },
  neutralSeq: 0,
  aboutFaceSeq: 0,
});

export const rigs: [Rig, Rig] = [makeRig(), makeRig()];

/** Puts a player somewhere new (snapping, not sweeping), with the given arm model. */
export function placeRig(slot: PlayerSlot, x: number, y: number, z: number, facing: number, arm: ArmMode) {
  const r = rigs[slot];
  r.root.set(x, y, z);
  r.facing = facing;
  r.arm = arm;
  r.targetX = x;
  r.slide = false;
  r.assistY = 0;
  r.placed++;
}

/** The player's right-hand direction along X (+1 when facing -Z). */
export const rightX = (slot: PlayerSlot) => Math.cos(rigs[slot].facing);
/** Which way along Z a player faces (-1 when facing -Z). */
export const forwardZ = (slot: PlayerSlot) => -Math.cos(rigs[slot].facing);
