"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CapsuleCollider, CylinderCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  MathUtils,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ARM, BLADE_OFFSET, BLADE_RADIUS, CONTACT, SHOULDER, rigs } from "@/lib/game/rig";
import { P, PLAYER_COLORS, type PlayerSlot } from "@/lib/net/protocol";
import { useGameStore } from "@/store/gameStore";
import { Glass } from "./Glass";
import { useKinematicFollow } from "./useKinematicFollow";

// A Rayman-style avatar: floating head, torso and hands, no limbs, built from
// R3F primitives inside kinematic Rapier bodies. The scene places it (its
// rig's root and facing); the dominant (right) hand follows the player's
// phone, through one of two arm models (see ArmMode in rig.ts):
//
// - pointer: the phone is the forearm, pivoting at the elbow. Phones report
//   orientation, not position (integrating the accelerometer twice drifts
//   within a second), so this lever turns rotation into reach.
// - paddle: the hand swings around the shoulder, turned by the phone's
//   facing, so a forehand sweeps the paddle forward across the body.
//
// In both, the phone's linear acceleration adds a short-lived push (a leaky
// integral that springs back), and the rotation and position are smoothed
// toward the network pose with Quaternion.slerp and MathUtils.lerp.

const UP = new Vector3(0, 1, 0);

// Layout above the root, avatar facing -Z, +X = the player's right
const TORSO = { y: 1.02, r: 0.2, len: 0.38 };
const HEAD = { y: 1.62, r: 0.17 };
const HAND_R = 0.085;
const ELBOW = new Vector3(0.3, 1.0, -0.1);
const FOREARM = 0.36;
/** Pendulum arm: from the right shoulder, this long, along the phone's bottom edge. */
const PENDULUM_SHOULDER = new Vector3(0.24, 1.36, -0.05);
const PENDULUM_ARM = 0.6;
const LEFT_HAND = new Vector3(-0.38, 0.86, -0.08);
const PHONE = { w: 0.108, h: 0.225, d: 0.016 };
/** Putter, hanging from the hand along the phone's bottom edge: its head rests just above the grass. */
export const PUTTER = { shaft: 0.74, head: [0.14, 0.035, 0.045] as const };

const ROT_RATE = 24;
const POS_RATE = 30;
const ASSIST_RATE = 10;
const SLIDE_SPEED = 2.6;
const MAX_SWING = 2.3;
const ACCEL_VEL_DECAY = 7;
const ACCEL_POS_DECAY = 3.5;
const ACCEL_MAX = 0.3;
const STALE_MS = 500;
const SERVE_LIFT = 0.32;
const SERVE_AHEAD = 0.05;

const wrapPi = (a: number) => MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;
/** Half a turn about vertical: the phone's screen faces forward instead of back at you. */
const SCREEN_FORWARD = new Quaternion().setFromAxisAngle(UP, Math.PI);

// Geometry and plain materials shared by every avatar, created once.
let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  return {
    torso: new CapsuleGeometry(TORSO.r, TORSO.len, 8, 32),
    head: new SphereGeometry(HEAD.r, 40, 28),
    hand: new SphereGeometry(HAND_R, 32, 20),
    phone: new RoundedBoxGeometry(PHONE.w, PHONE.h, PHONE.d, 3, 0.007),
    screen: new PlaneGeometry(PHONE.w - 0.01, PHONE.h - 0.014),
    blade: new CylinderGeometry(BLADE_RADIUS, BLADE_RADIUS, 0.014, 48).rotateX(Math.PI / 2),
    shaft: new CylinderGeometry(0.012, 0.012, PUTTER.shaft, 12),
    putterHead: new BoxGeometry(...PUTTER.head),
    white: new MeshStandardMaterial({ color: "#f5f5f7", roughness: 0.3 }),
    screenMat: new MeshStandardMaterial({ color: "#1c1c1e", roughness: 0.2 }),
    steel: new MeshStandardMaterial({ color: "#d9dde3", roughness: 0.25, metalness: 0.8 }),
  };
}
const resources = () => (shared ??= makeShared());

export default function Avatar({ slot, tint = PLAYER_COLORS[slot] }: { slot: PlayerSlot; tint?: string }) {
  const r = resources();
  const rig = rigs[slot];
  const scene = useGameStore((s) => s.scene);
  const torso = useRef<RapierRigidBody>(null);
  const head = useRef<RapierRigidBody>(null);
  const left = useRef<RapierRigidBody>(null);
  const right = useRef<RapierRigidBody>(null);
  const fTorso = useKinematicFollow(torso);
  const fHead = useKinematicFollow(head);
  const fLeft = useKinematicFollow(left);
  const fRight = useKinematicFollow(right);

  useEffect(() => {
    rig.paddleBody = right.current;
    return () => {
      rig.paddleBody = null;
    };
  }, [rig]);

  // Scratch objects, reused every frame (no allocation in the loop).
  const s = useRef({
    faceQ: new Quaternion(),
    calQ: new Quaternion(),
    calibrated: false,
    seenRecenter: 0,
    placed: 0,
    netQ: new Quaternion(),
    handQ: new Quaternion(),
    handPos: new Vector3(),
    prevHand: new Vector3(),
    prevBlade: new Vector3(),
    target: new Vector3(),
    assistY: 0,
    accel: new Vector3(),
    accelVel: new Vector3(),
    accelOff: new Vector3(),
    v: new Vector3(),
    e: new Euler(),
    first: true,
  }).current;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const facing = rig.facing;
    s.faceQ.setFromAxisAngle(UP, facing);
    if (rig.placed !== s.placed) {
      // The scene moved this avatar: snap every part instead of sweeping there.
      s.placed = rig.placed;
      s.first = true;
      for (const f of [fTorso, fHead, fLeft, fRight]) f.primed = false;
    }
    const tel = useGameStore.getState().telemetry[slot];
    const p = tel.packet;
    // Which side of the phone does the work: its screen (+Z) when it is a
    // paddle, held screen-forward like a real bat; its back (-Z) otherwise,
    // held screen toward you.
    const faceAxis = rig.arm === "paddle" ? 1 : -1;
    const live = tel.receivedAt > 0 && performance.now() - tel.receivedAt < STALE_MS;
    rig.live = live;
    rig.grip = live && p[P.GRIP] > 0.5;

    // --- Phone orientation -> world orientation
    if (live) {
      s.netQ.set(p[P.QX], p[P.QY], p[P.QZ], p[P.QW]).normalize();
      // Zero the compass heading on the first packet and on every recenter, so
      // the phone's working face pointing at the laptop faces the way the
      // avatar does. The working face is the back of the phone, except in
      // ping pong where the screen is the paddle face (see faceAxis).
      if (tel.source === "local" || tel.virtual) {
        s.calQ.identity(); // CPU and Buttons-mode packets are already in the player's frame
      } else if (!s.calibrated || tel.recenterSeq !== s.seenRecenter) {
        s.seenRecenter = tel.recenterSeq;
        s.calibrated = true;
        let d = s.v.set(0, 0, faceAxis).applyQuaternion(s.netQ);
        if (Math.hypot(d.x, d.z) < 0.5) d = s.v.set(0, 1, 0).applyQuaternion(s.netQ); // lying flat: its top
        s.calQ.setFromAxisAngle(UP, -Math.atan2(-d.x, -d.z));
      }
      s.netQ.premultiply(s.calQ).premultiply(s.faceQ);
    } else {
      s.calibrated = false;
      // Rest: phone upright with its working face forward.
      s.netQ.copy(s.faceQ);
      if (faceAxis > 0) s.netQ.multiply(SCREEN_FORWARD);
    }
    if (s.first) s.handQ.copy(s.netQ);
    s.handQ.slerp(s.netQ, 1 - Math.exp(-dt * ROT_RATE));

    // Heading of the working face, relative to facing: the paddle swing and the aim.
    let b = s.v.set(0, 0, faceAxis).applyQuaternion(s.handQ);
    if (Math.hypot(b.x, b.z) < 0.3) b = s.v.set(0, 1, 0).applyQuaternion(s.handQ);
    rig.heading = wrapPi(Math.atan2(-b.x, -b.z) - facing);

    // Leaky integral of linear acceleration (phone frame -> world frame first)
    if (live) s.accel.set(p[P.AX], p[P.AY], p[P.AZ]).applyQuaternion(s.handQ);
    else s.accel.set(0, 0, 0);
    s.accelVel.addScaledVector(s.accel, dt).multiplyScalar(Math.exp(-dt * ACCEL_VEL_DECAY));
    s.accelOff.addScaledVector(s.accelVel, dt).multiplyScalar(Math.exp(-dt * ACCEL_POS_DECAY));
    s.accelOff.clampLength(0, ACCEL_MAX);
    rig.swing = s.accelVel.length();

    // --- Where the hand goes
    if (rig.slide) rig.root.x += MathUtils.clamp(rig.targetX - rig.root.x, -SLIDE_SPEED * dt, SLIDE_SPEED * dt);
    s.assistY += (rig.assistY - s.assistY) * (1 - Math.exp(-dt * ASSIST_RATE));
    if (rig.arm === "paddle") {
      rig.paddleSwing = MathUtils.clamp(rig.heading, -MAX_SWING, MAX_SWING);
      s.target.copy(ARM).applyAxisAngle(UP, rig.paddleSwing).add(SHOULDER).applyAxisAngle(UP, facing).add(rig.root);
      s.target.y += s.assistY;
    } else if (rig.arm === "pendulum") {
      s.target
        .copy(PENDULUM_SHOULDER)
        .applyAxisAngle(UP, facing)
        .add(rig.root)
        .addScaledVector(s.v.set(0, -1, 0).applyQuaternion(s.handQ), PENDULUM_ARM);
    } else {
      s.target
        .copy(ELBOW)
        .applyAxisAngle(UP, facing)
        .add(rig.root)
        .addScaledVector(s.v.set(0, 1, 0).applyQuaternion(s.handQ), FOREARM);
    }
    s.target.add(s.accelOff);
    if (s.first) {
      s.handPos.copy(s.target);
      s.prevHand.copy(s.target);
      s.first = false;
    }
    const k = 1 - Math.exp(-dt * POS_RATE);
    s.handPos.set(
      MathUtils.lerp(s.handPos.x, s.target.x, k),
      MathUtils.lerp(s.handPos.y, s.target.y, k),
      MathUtils.lerp(s.handPos.z, s.target.z, k),
    );
    rig.handVel.lerp(s.v.subVectors(s.handPos, s.prevHand).divideScalar(Math.max(dt, 1e-3)), 0.5);
    s.prevHand.copy(s.handPos);
    rig.handPos.copy(s.handPos);
    rig.handQuat.copy(s.handQ);
    fRight.targetPos.copy(s.handPos);
    fRight.targetQuat.copy(s.handQ);

    // Paddle extras for ping pong
    s.prevBlade.copy(rig.bladePos);
    rig.bladeQuat.copy(s.handQ);
    rig.bladePos.copy(s.handPos).addScaledVector(s.v.set(0, 1, 0).applyQuaternion(s.handQ), BLADE_OFFSET);
    rig.bladeVel.lerp(s.v.subVectors(rig.bladePos, s.prevBlade).divideScalar(Math.max(dt, 1e-3)), 0.5);
    rig.servePoint.copy(CONTACT).add(s.v.set(0, SERVE_LIFT, -SERVE_AHEAD)).applyAxisAngle(UP, facing).add(rig.root);

    // --- Idle body: a slow breath, a slight turn with the arm
    const t = state.clock.elapsedTime + slot * 1.3;
    const breath = Math.sin(t * 1.8) * 0.012;
    const twist = rig.arm === "paddle" ? rig.paddleSwing * 0.25 : MathUtils.clamp(rig.heading * 0.2, -0.3, 0.3);
    const y0 = rig.root.y;
    fTorso.targetPos.set(rig.root.x, y0 + TORSO.y + breath, rig.root.z);
    fTorso.targetQuat.setFromEuler(s.e.set(0, facing + twist, 0));
    fHead.targetPos.set(rig.root.x, y0 + HEAD.y + breath * 1.4, rig.root.z);
    fHead.targetQuat.setFromEuler(s.e.set(0, facing + twist * 1.4, 0));
    fLeft.targetPos
      .copy(LEFT_HAND)
      .add(s.v.set(0, Math.sin(t * 1.8 + 1) * 0.02, 0))
      .applyAxisAngle(UP, facing + twist)
      .add(rig.root);
    fLeft.targetQuat.copy(s.faceQ);

    fTorso.commit(delta);
    fHead.commit(delta);
    fLeft.commit(delta);
    fRight.commit(delta);
  });

  return (
    <group>
      <RigidBody ref={torso} type="kinematicPosition" colliders={false}>
        <CapsuleCollider args={[TORSO.len / 2, TORSO.r]} />
        <mesh geometry={r.torso} castShadow>
          <Glass tint={tint} />
        </mesh>
      </RigidBody>

      <RigidBody ref={head} type="kinematicPosition" colliders={false}>
        <BallCollider args={[HEAD.r]} />
        <mesh geometry={r.head} castShadow>
          <Glass tint={tint} />
        </mesh>
      </RigidBody>

      <RigidBody ref={left} type="kinematicPosition" colliders={false}>
        <BallCollider args={[HAND_R]} />
        <mesh geometry={r.hand} castShadow>
          <Glass tint={tint} />
        </mesh>
      </RigidBody>

      {/* Dominant hand, holding whatever the scene calls for. */}
      <RigidBody ref={right} type="kinematicPosition" colliders={false} userData={{ kind: "paddle", slot }}>
        <BallCollider args={[HAND_R]} />
        <mesh geometry={r.hand} castShadow>
          <Glass tint={tint} />
        </mesh>

        {scene === "hub" && (
          <group position={[0, 0.09, 0]}>
            <mesh geometry={r.phone} material={r.white} castShadow />
            <mesh geometry={r.screen} material={r.screenMat} position={[0, 0, PHONE.d / 2 + 0.0005]} />
          </group>
        )}

        {scene === "pingpong" && (
          <>
            {/* Blade: a disc whose face normal is the phone's screen normal */}
            <CylinderCollider
              args={[0.018, BLADE_RADIUS]}
              position={[0, BLADE_OFFSET, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              restitution={0.6}
              friction={0.6}
            />
            <mesh geometry={r.blade} position={[0, BLADE_OFFSET, 0]} castShadow>
              <Glass tint={tint} />
            </mesh>
          </>
        )}

        {scene === "golf" && (
          // The putter hangs along the phone's bottom edge, like the grip in your hand.
          <group>
            <mesh geometry={r.shaft} material={r.steel} position={[0, -PUTTER.shaft / 2, 0]} castShadow />
            <mesh geometry={r.putterHead} material={r.steel} position={[0.03, -PUTTER.shaft, 0]} castShadow />
          </group>
        )}
      </RigidBody>
    </group>
  );
}
