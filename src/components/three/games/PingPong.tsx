"use client";

import { Box, RoundedBox, Sphere } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  RigidBody,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, CylinderGeometry, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLADE_OFFSET, CONTACT, forwardZ, rightX, rigs } from "@/lib/game/rig";
import {
  BALL_RADIUS,
  TABLE,
  endRally,
  game,
  onBallTouch,
  onPaddleHit,
  predictAtPlane,
  solveArc,
} from "@/lib/games/pingpong";
import type { PlayerSlot } from "@/lib/net/protocol";
import { playSound } from "@/lib/audio/audioManager";
import { useGameStore } from "@/store/gameStore";
import { Glass } from "../Glass";
import { PHYSICS_STEP } from "../useKinematicFollow";

// Neon Ping Pong: a glass table, a glass ball, and the rules loop. The table
// stands in the hub at the world origin; the rules only run once players
// have stepped up to it (scene "pingpong").
//
// Phases: idle (ball floats in front of the server's paddle) -> swing key /
// grip tosses it -> play -> dead (fell below the table, left the area, or
// bounced twice) -> idle after a beat. Points go to 11, win by 2.
//
// Hits: the paddle is a kinematic body, so Rapier bounces the ball off it.
// Two allowances make that playable on a flat screen:
// - Near miss: a paddle swinging forward within MAGNET of an incoming ball
//   counts as a hit, even if the thin disc and the small ball never touched.
// - Assist: every hit keeps the swing's pace (paddle speed) and direction
//   (swing timing + aim) but solves the arc so it clears the net and lands
//   on the far half.

const TOP_Y = TABLE.height;
const HALF_L = TABLE.length / 2;
const HALF_W = TABLE.width / 2;
/**
 * The serve toss floats: it rises gently and drifts down at a third of
 * gravity until it is hit, leaving about a second to swing. (A real-gravity
 * toss falls past the paddle in under a tenth of a second, which nobody hits
 * from a phone.)
 */
const TOSS_SPEED = 1.2;
const TOSS_GRAVITY = 0.35;
const DEAD_MS = 1300;
const MAGNET = 0.22;
/** Paddle forward speed (m/s) that counts as swinging, for the near-miss allowance. */
const SWING_MIN = 0.8;
/** Aim assist for people (not the CPU): a wider near-miss reach, and a gentler swing still counts. */
const MAGNET_PLAYER = 0.4;
const SWING_MIN_PLAYER = 0.5;
/** Assisted hit pace range, m/s (horizontal). */
const HIT_MIN = 3.0;
const HIT_MAX = 7.5;

export function TableModel() {
  const [legs, lines] = useMemo(() => {
    const h = TOP_Y - TABLE.topThickness;
    const legParts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const g = new CylinderGeometry(0.028, 0.028, h, 20);
        g.translate(sx * (HALF_W - 0.12), h / 2, sz * (HALF_L - 0.25));
        legParts.push(g);
      }
    }
    // White glass edge lines and the center line, just proud of the top.
    const y = TOP_Y + 0.002;
    const w = 0.02;
    const lineParts = [
      new BoxGeometry(TABLE.width, 0.004, w).translate(0, y, HALF_L - w / 2),
      new BoxGeometry(TABLE.width, 0.004, w).translate(0, y, -HALF_L + w / 2),
      new BoxGeometry(w, 0.004, TABLE.length).translate(HALF_W - w / 2, y, 0),
      new BoxGeometry(w, 0.004, TABLE.length).translate(-HALF_W + w / 2, y, 0),
      new BoxGeometry(0.006, 0.004, TABLE.length).translate(0, y, 0),
    ];
    return [mergeGeometries(legParts)!, mergeGeometries(lineParts)!];
  }, []);
  useEffect(
    () => () => {
      legs.dispose();
      lines.dispose();
    },
    [legs, lines],
  );

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: "table" }}>
      <CuboidCollider
        name="tabletop"
        args={[HALF_W, TABLE.topThickness / 2, HALF_L]}
        position={[0, TOP_Y - TABLE.topThickness / 2, 0]}
        restitution={0.85}
        friction={0.25}
      />
      <CuboidCollider
        name="net"
        args={[HALF_W + TABLE.netOverhang, TABLE.netHeight / 2, 0.006]}
        position={[0, TOP_Y + TABLE.netHeight / 2, 0]}
        restitution={0.1}
        friction={0.6}
      />
      <RoundedBox
        args={[TABLE.width, TABLE.topThickness, TABLE.length]}
        radius={0.016}
        smoothness={4}
        position={[0, TOP_Y - TABLE.topThickness / 2, 0]}
        castShadow
        receiveShadow
      >
        <Glass tint="#9fd8ff" />
      </RoundedBox>
      <mesh geometry={lines}>
        <meshStandardMaterial color="#ffffff" roughness={0.4} />
      </mesh>
      <Box
        args={[TABLE.width + TABLE.netOverhang * 2, TABLE.netHeight, 0.012]}
        position={[0, TOP_Y + TABLE.netHeight / 2, 0]}
        castShadow
      >
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.35} roughness={0.1} />
      </Box>
      <mesh geometry={legs} castShadow>
        <Glass tint="#d6ecff" />
      </mesh>
    </RigidBody>
  );
}

export default function PingPong() {
  const ball = useRef<RapierRigidBody>(null);
  const s = useRef({
    prevGrip: [false, false],
    stillSince: 0,
    park: new Vector3(),
    pred: new Vector3(),
    vel: new Vector3(),
    v: new Vector3(),
    blade: [new Vector3(), new Vector3()],
    bladeVel: [new Vector3(), new Vector3()],
    quat: new Quaternion(),
    pos: new Vector3(),
  }).current;



  function setPhase(phase: typeof game.phase) {
    game.phase = phase;
    game.phaseAt = performance.now();
  }

  function serve(slot: PlayerSlot) {
    const rb = ball.current;
    if (!rb || game.phase !== "idle" || slot !== game.server) return;
    if (useGameStore.getState().scene !== "pingpong") return;
    // No serving (by anyone, the CPU included) while a player is calibrating.
    if (useGameStore.getState().calibration.some(Boolean)) return;
    game.lastHitter = null;
    game.farBounces = 0;
    game.touchedNet = false;
    const pp = useGameStore.getState().pingpong;
    useGameStore.setState({ pingpong: { ...pp, rally: 0 } });
    rb.setGravityScale(TOSS_GRAVITY, true);
    rb.setLinvel({ x: 0, y: TOSS_SPEED, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    s.stillSince = 0;
    setPhase("play");
    playSound("serve");
  }

  function end(winner: PlayerSlot, reason: string) {
    endRally(winner, reason);
    setPhase("dead");
  }

  // Near-miss allowance, checked every physics step against the paddle body's
  // exact pose, so a fast swing cannot skip past the ball between frames.
  useAfterPhysicsStep(() => {
    const rb = ball.current;
    if (!rb) return;
    const bt = rb.translation();
    const bv = rb.linvel();
    for (const slot of [0, 1] as PlayerSlot[]) {
      const r = rigs[slot];
      const body = r.paddleBody;
      if (!body || !r.live) continue;
      const t = body.translation();
      const q = body.rotation();
      s.quat.set(q.x, q.y, q.z, q.w);
      const blade = s.v.set(0, BLADE_OFFSET, 0).applyQuaternion(s.quat).add(s.pos.set(t.x, t.y, t.z));
      s.bladeVel[slot].subVectors(blade, s.blade[slot]).divideScalar(PHYSICS_STEP);
      s.blade[slot].copy(blade);
      if (game.phase !== "play") continue;
      if (game.lastHitter === slot) continue;
      const fz = forwardZ(slot);
      const serving = game.lastHitter === null && slot === game.server;
      const incoming = serving || bv.z * fz < 0;
      if (!incoming) continue;
      const fx = -Math.sin(r.facing);
      const forward = s.bladeVel[slot].x * fx + s.bladeVel[slot].z * fz;
      const dist = Math.hypot(blade.x - bt.x, blade.y - bt.y, blade.z - bt.z);
      const cpu = slot === 1 && useGameStore.getState().pingpong.cpu;
      if (dist < (cpu ? MAGNET : MAGNET_PLAYER) && forward > (cpu ? SWING_MIN : SWING_MIN_PLAYER)) onPaddleHit(slot);
    }
  });

  // Shape a fresh hit (see the header comment) before the next step.
  useBeforePhysicsStep(() => {
    const slot = game.pendingAssist;
    const rb = ball.current;
    if (slot === null || !rb) return;
    game.pendingAssist = null;
    const r = rigs[slot];
    const t = rb.translation();
    s.park.set(t.x, t.y, t.z);
    const fz = forwardZ(slot);
    const fx = -Math.sin(r.facing);
    const forward = Math.max(0, s.bladeVel[slot].x * fx + s.bladeVel[slot].z * fz);
    const pace = Math.min(HIT_MAX, Math.max(HIT_MIN, 1 + forward * 1.15));
    const depth = 0.3 + ((pace - HIT_MIN) / (HIT_MAX - HIT_MIN)) * (HALF_L - 0.45);
    const z = fz * depth;
    // Timing aims: a late swing (paddle still facing right) goes right, an early one left.
    const rx = rightX(slot);
    const x = t.x - Math.sin(r.swing) * 0.55 * rx + r.aim * 0.45 * rx;
    const lim = HALF_W - 0.12;
    solveArc(s.park, Math.max(-lim, Math.min(lim, x)), z, pace, s.vel);
    rb.setGravityScale(1, true); // a struck serve flies at full gravity
    rb.setLinvel(s.vel, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });

  useFrame((state) => {
    const rb = ball.current;
    if (!rb) return;
    const now = performance.now();
    const scene = useGameStore.getState().scene;
    const t = rb.translation();
    const lv = rb.linvel();
    game.ballPos.set(t.x, t.y, t.z);
    game.ballVel.set(lv.x, lv.y, lv.z);

    // Grip / swing key rising edge serves.
    for (const slot of [0, 1] as PlayerSlot[]) {
      const g = rigs[slot].grip;
      if (g && !s.prevGrip[slot]) serve(slot);
      s.prevGrip[slot] = g;
    }

    if (scene !== "pingpong" || game.phase === "idle") {
      if (scene !== "pingpong") game.phase = "idle";
      const server = rigs[game.server];
      const park =
        scene === "pingpong" && server.live
          ? s.park.copy(server.servePoint)
          : s.park.set(0, TOP_Y + 0.4 + Math.sin(state.clock.elapsedTime * 1.6) * 0.05, 0);
      rb.setGravityScale(0, true);
      rb.setTranslation(park, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    } else if (game.phase === "play") {
      if (game.ballVel.length() < 0.08) s.stillSince ||= now;
      else s.stillSince = 0;
      const fell = t.y < TOP_Y - 0.25 || Math.abs(t.x) > 3.5 || Math.abs(t.z) > 4.5;
      const stuck = s.stillSince > 0 && now - s.stillSince > 1500;
      const hitter = game.lastHitter;
      if (hitter !== null && game.farBounces >= 2) {
        end(hitter, "Double bounce");
      } else if (fell || stuck) {
        if (hitter === null) end((1 - game.server) as PlayerSlot, "Missed serve");
        else if (game.farBounces >= 1) end(hitter, "Clean winner");
        else end((1 - hitter) as PlayerSlot, game.touchedNet ? "Net" : "Out");
      }
    } else if (game.phase === "dead" && now - game.phaseAt > DEAD_MS) {
      setPhase("idle");
    }

    // Each player slides along the baseline to meet the ball, and the hand
    // rises or drops to the height the ball will have when it gets there.
    if (scene !== "pingpong") return;
    for (const slot of [0, 1] as PlayerSlot[]) {
      const r = rigs[slot];
      const fz = forwardZ(slot);
      const rx = rightX(slot);
      let x = -CONTACT.x * rx * 0.5; // paddle a little right of center
      let y = 0;
      const incoming = game.phase === "play" && lv.z * fz < -0.3;
      const tossing = game.phase === "play" && game.lastHitter === null && slot === game.server;
      if (incoming && predictAtPlane(game.ballPos, game.ballVel, r.root.z - CONTACT.z * fz, s.pred)) {
        x = s.pred.x - CONTACT.x * rx;
        y = Math.max(-0.45, Math.min(0.4, s.pred.y - CONTACT.y));
      } else if (tossing) {
        // Serving: stay put, and let the paddle ride up and down with the
        // tossed ball, so the serve is about when you swing, not how high.
        x = r.targetX;
        y = Math.max(-0.45, Math.min(0.4, game.ballPos.y - r.root.y - CONTACT.y));
      }
      r.targetX = Math.max(-1.3, Math.min(1.3, x));
      r.assistY = y;
    }
  });

  return (
    <>
      {/* The table itself is rendered by Stage, inside the static caustics. */}
      <RigidBody
        ref={ball}
        colliders={false}
        ccd
        gravityScale={0}
        linearDamping={0.05}
        angularDamping={0.6}
        position={[0, TOP_Y + 0.4, 0]}
        userData={{ kind: "ball" }}
        onCollisionEnter={({ other, target }) => {
          const name = other.colliderObject?.name;
          if (name === "tabletop" || name === "net") {
            onBallTouch(name === "net" ? "net" : "table", target.rigidBody?.translation().z ?? 0);
          }
          if ((other.rigidBodyObject?.userData as { kind?: string } | undefined)?.kind === "paddle") {
            onPaddleHit((other.rigidBodyObject!.userData as { slot: PlayerSlot }).slot);
          }
        }}
      >
        <BallCollider args={[BALL_RADIUS]} mass={0.0027} restitution={0.9} friction={0.2} />
        {/* Regulation orange: a yellow ball washed out against the pale glass table and white floor. */}
        <Sphere args={[BALL_RADIUS, 32, 32]} castShadow>
          <meshStandardMaterial color="#ff7a00" roughness={0.3} />
        </Sphere>
      </RigidBody>
    </>
  );
}
