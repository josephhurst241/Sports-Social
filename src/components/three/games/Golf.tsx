"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { MathUtils, Vector3, type Mesh } from "three";
import { placeRig, rigs } from "@/lib/game/rig";
import { setView } from "@/lib/game/view";
import { BALL_R, CUP_R, CUP_SPEED, HOLES, scoreName } from "@/lib/games/golf";
import { callout, useGameStore } from "@/store/gameStore";
import { PUTTER } from "../Avatar";
import { BackgroundGlass, Glass } from "../Glass";

// Mini golf: hold the phone screen, swing it like a putter, let go to strike.
// The putter head's forward speed at release sets the power; where the back
// of the phone points aims the putt (the line on the green shows it).
// Player 1 putts; the avatar is placed beside the ball for every stroke.

const RAIL_H = 0.12;
/** Ball speed = putter-head speed at release x this, within [MIN, MAX] m/s. */
const PUTT_GAIN = 1.7;
const PUTT_MIN = 0.35;
const PUTT_MAX = 6;
/** How far the phone's heading turns the aim (full), and the most it can. */
const AIM_MAX = 1.2;
const STOP_SPEED = 0.05;
/** Rolling resistance of the turf, m/s² (on top of light damping): a 4 m/s putt rolls about 6 m. */
export const ROLL_DECEL = 1.1;
const NEXT_HOLE_MS = 2600;

export const golfState = {
  phase: "aim" as "aim" | "address" | "rolling" | "holed" | "next" | "over",
  phaseAt: 0,
  /** Where the next stroke is taken from (and where an out-of-bounds ball returns). */
  lie: new Vector3(),
  /** Direction from the lie to the cup when this stroke began (the avatar faces it). */
  baseYaw: 0,
  history: [] as { t: number; v: number }[],
  prevGrip: false,
  prevHead: new Vector3(),
  stillSince: 0,
  lastSpeed: 0,
};

const yawTo = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(-(toX - fromX), -(toZ - fromZ));

function Green({ hole }: { hole: number }) {
  const h = HOLES[hole];
  const [w, d] = h.size;
  return (
    <RigidBody type="fixed" colliders={false} key={hole}>
      {/* Turf, top at y = 0 */}
      <CuboidCollider args={[w / 2, 0.05, d / 2]} position={[0, -0.05, 0]} friction={0.6} restitution={0.1} />
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color="#7ee0a0" roughness={0.6} />
      </mesh>
      {/* Rails */}
      {[
        [0, -d / 2 - 0.04, w + 0.16, 0.08],
        [0, d / 2 + 0.04, w + 0.16, 0.08],
        [-w / 2 - 0.04, 0, 0.08, d],
        [w / 2 + 0.04, 0, 0.08, d],
      ].map(([x, z, rw, rd], i) => (
        <group key={i}>
          <CuboidCollider args={[rw / 2, RAIL_H / 2, rd / 2]} position={[x, RAIL_H / 2, z]} restitution={0.55} friction={0.2} />
          <mesh position={[x, RAIL_H / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[rw, RAIL_H, rd]} />
            <BackgroundGlass tint="#eafff2" />
          </mesh>
        </group>
      ))}
      {/* Glass blocks in the way */}
      {h.blocks.map(([x, z, bw, bd], i) => (
        <group key={`b${i}`}>
          <CuboidCollider args={[bw / 2, 0.11, bd / 2]} position={[x, 0.11, z]} restitution={0.5} friction={0.2} />
          <mesh position={[x, 0.11, z]} castShadow>
            <boxGeometry args={[bw, 0.22, bd]} />
            <Glass tint="#a6e7ff" />
          </mesh>
        </group>
      ))}
      {/* Cup and flag */}
      <mesh position={[h.cup[0], 0.002, h.cup[1]]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[CUP_R, 40]} />
        <meshBasicMaterial color="#1c2a22" />
      </mesh>
      <mesh position={[h.cup[0], 0.6, h.cup[1]]}>
        <cylinderGeometry args={[0.01, 0.01, 1.2, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[h.cup[0] + 0.16, 1.08, h.cup[1]]}>
        <boxGeometry args={[0.3, 0.2, 0.01]} />
        <Glass tint="#ff8fc7" />
      </mesh>
      {/* Tee marker */}
      <mesh position={[h.tee[0], 0.001, h.tee[1]]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.06, 0.08, 32]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </RigidBody>
  );
}

export default function Golf() {
  const { rapier } = useRapier();
  const ball = useRef<RapierRigidBody>(null);
  const aimLine = useRef<Mesh>(null);
  const hole = useGameStore((s) => s.golf.hole);
  const s = useRef({ head: new Vector3(), down: new Vector3(), fwd: new Vector3(), tmp: new Vector3() }).current;

  const setPhase = (p: typeof golfState.phase) => {
    golfState.phase = p;
    golfState.phaseAt = performance.now();
  };

  /** Ball at rest on the lie; the player stands beside it facing the cup. */
  const address = () => {
    const rb = ball.current;
    const h = HOLES[useGameStore.getState().golf.hole];
    if (!rb) return;
    const lie = golfState.lie;
    rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
    rb.setTranslation({ x: lie.x, y: BALL_R, z: lie.z }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    golfState.baseYaw = yawTo(lie.x, lie.z, h.cup[0], h.cup[1]);
    // Stand so the putter head hangs just behind the ball (it hangs 0.24 m to
    // the player's right and slightly ahead of the feet).
    const f = golfState.baseYaw;
    const back = 0.16, side = 0.24;
    const x = lie.x - (-Math.sin(f)) * back - Math.cos(f) * side;
    const z = lie.z - (-Math.cos(f)) * back + Math.sin(f) * side;
    placeRig(0, x, 0, z, f, "pendulum");
    placeRig(1, x - Math.cos(f) * 1.6, 0, z + Math.sin(f) * 1.6, f, "pendulum");
    golfState.prevGrip = rigs[0].grip;
    setPhase("aim");
  };

  // New hole: ball on the tee.
  useEffect(() => {
    const h = HOLES[hole];
    golfState.lie.set(h.tee[0], 0, h.tee[1]);
    const id = requestAnimationFrame(address);
    return () => cancelAnimationFrame(id);
  }, [hole]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const rb = ball.current;
    if (!rb) return;
    const now = performance.now();
    const r0 = rigs[0];
    const grip = r0.live && r0.grip;
    const pressed = grip && !golfState.prevGrip;
    const released = !grip && golfState.prevGrip;
    golfState.prevGrip = grip;
    const g = useGameStore.getState().golf;
    const h = HOLES[g.hole];
    const t = rb.translation();

    // Aim: straight at the cup, turned by the phone's heading.
    const aimYaw = golfState.baseYaw + MathUtils.clamp(r0.heading, -AIM_MAX, AIM_MAX);
    s.fwd.set(-Math.sin(aimYaw), 0, -Math.cos(aimYaw));

    // Putter head: hangs from the hand along the phone's bottom edge.
    s.down.set(0, -1, 0).applyQuaternion(r0.handQuat);
    s.head.copy(r0.handPos).addScaledVector(s.down, PUTTER.shaft);
    const headSpeed = s.tmp.subVectors(s.head, golfState.prevHead).dot(s.fwd) / Math.max(delta, 1e-3);
    golfState.prevHead.copy(s.head);

    if (golfState.phase === "aim" || golfState.phase === "address") {
      if (golfState.phase === "aim" && pressed) {
        golfState.history.length = 0;
        setPhase("address");
      }
      if (golfState.phase === "address") {
        golfState.history.push({ t: now, v: headSpeed });
        while (golfState.history.length && now - golfState.history[0].t > 300) golfState.history.shift();
        if (released) {
          const peak = Math.max(0, ...golfState.history.map((e) => e.v));
          const speed = peak * PUTT_GAIN;
          golfState.lastSpeed = speed;
          if (speed < PUTT_MIN) {
            callout("Swing the putter forward, then let go");
            setPhase("aim");
          } else {
            const v = Math.min(PUTT_MAX, speed);
            rb.setBodyType(rapier.RigidBodyType.Dynamic, true);
            rb.setLinvel({ x: s.fwd.x * v, y: 0, z: s.fwd.z * v }, true);
            // Topspin to match, so it rolls from the start instead of skidding:
            // spin axis = up x direction, rate v / r.
            rb.setAngvel({ x: s.fwd.z * (v / BALL_R), y: 0, z: -s.fwd.x * (v / BALL_R) }, true);
            useGameStore.setState({ golf: { ...g, strokes: g.strokes + 1 } });
            golfState.stillSince = 0;
            setPhase("rolling");
          }
        }
      }
    } else if (golfState.phase === "rolling") {
      const lv = rb.linvel();
      const speed = Math.hypot(lv.x, lv.z);
      // Turf friction: slow the roll at a steady rate, like a real green.
      if (speed > 0 && t.y > -0.1) {
        const k = Math.max(0, speed - ROLL_DECEL * Math.min(delta, 0.05)) / speed;
        rb.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
      }
      const toCup = Math.hypot(t.x - h.cup[0], t.z - h.cup[1]);
      if (toCup < CUP_R && speed < CUP_SPEED) {
        // In the cup.
        rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
        rb.setTranslation({ x: h.cup[0], y: -0.06, z: h.cup[1] }, true);
        const strokes = g.strokes;
        callout(`${scoreName(strokes, h.par)} · ${strokes} stroke${strokes === 1 ? "" : "s"}`);
        const card = [...g.card, strokes];
        useGameStore.setState({ golf: { ...g, card, over: card.length === HOLES.length } });
        setPhase(card.length === HOLES.length ? "over" : "holed");
      } else if (t.y < -0.5) {
        callout("Out of bounds · +1 stroke");
        useGameStore.setState({ golf: { ...g, strokes: g.strokes + 1 } });
        address();
      } else {
        if (speed < STOP_SPEED) golfState.stillSince ||= now;
        else golfState.stillSince = 0;
        if (golfState.stillSince && now - golfState.stillSince > 400) {
          golfState.lie.set(t.x, 0, t.z);
          address();
        }
      }
    } else if (golfState.phase === "holed" && now - golfState.phaseAt > NEXT_HOLE_MS) {
      // Advance exactly once; the new hole's effect tees the ball up and sets "aim".
      setPhase("next");
      useGameStore.setState({ golf: { hole: g.hole + 1, strokes: 0, card: g.card, over: false } });
    } else if (golfState.phase === "over" && pressed) {
      // Play again from hole 1 (the hole change re-tees the ball).
      setPhase("next");
      useGameStore.setState({ golf: { hole: 0, strokes: 0, card: [], over: false } });
    }

    // Aim line on the green while lining up a stroke.
    const line = aimLine.current;
    if (line) {
      line.visible = golfState.phase === "aim" || golfState.phase === "address";
      line.position.set(t.x + s.fwd.x * 0.6, 0.004, t.z + s.fwd.z * 0.6);
      line.rotation.set(-Math.PI / 2, 0, aimYaw);
    }

    // Camera behind the ball, looking along the stroke toward the cup.
    const f = golfState.baseYaw;
    const bx = golfState.phase === "rolling" ? t.x : golfState.lie.x;
    const bz = golfState.phase === "rolling" ? t.z : golfState.lie.z;
    // Behind the ball, high and to the right, so the golfer (left of the ball) never blocks the line.
    const back = 4.4, right = 1.1;
    setView(
      bx + Math.sin(f) * back + Math.cos(f) * right,
      2.8,
      bz + Math.cos(f) * back - Math.sin(f) * right,
      bx - Math.sin(f) * 1.8,
      0,
      bz - Math.cos(f) * 1.8,
      42,
    );
  });

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#ffffff" roughness={1} toneMapped={false} />
      </mesh>
      <Green hole={hole} />
      <mesh ref={aimLine} visible={false}>
        <planeGeometry args={[0.025, 1.2]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <RigidBody
        ref={ball}
        type="kinematicPosition"
        colliders={false}
        ccd
        linearDamping={0.2}
        angularDamping={0.1}
        position={[HOLES[0].tee[0], BALL_R, HOLES[0].tee[1]]}
      >
        <BallCollider args={[BALL_R]} mass={0.046} restitution={0.4} friction={0.5} />
        <mesh castShadow>
          <sphereGeometry args={[BALL_R, 32, 20]} />
          <meshStandardMaterial color="#ffffff" roughness={0.25} />
        </mesh>
      </RigidBody>
    </>
  );
}
