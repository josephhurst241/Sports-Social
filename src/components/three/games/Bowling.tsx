"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, CylinderCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { LatheGeometry, MathUtils, Vector2, Vector3 } from "three";
import { rigs } from "@/lib/game/rig";
import { setView } from "@/lib/game/view";
import { PINS, position, totalScore } from "@/lib/games/bowling";
import { callout, useGameStore } from "@/store/gameStore";
import { BackgroundGlass, Glass } from "../Glass";

// Bowling: hold the phone screen to pick up the ball, swing underhand, let
// go to bowl. The swing's forward speed sets the pace; the phone's heading
// (where its back points) angles the shot. Ten frames, standard scoring.
//
// Player 1 bowls. The lane runs from the foul line at z = 0 toward -Z.

const LANE = { halfW: 0.525, start: 1.4, headPin: -14.5, end: -15.9 };
const GUTTER = { inner: 0.525, outer: 0.78, depth: 0.06 };
const BALL_R = 0.11;
const RACK = new Vector3(0.95, 0.52, 0.85); // the ball waits on a pedestal beside the bowler
const SETTLE_MS = 2200;
const ROLL_TIMEOUT_MS = 9000;
/** Ball speed = forward hand speed at release x this, within [MIN, MAX] m/s. */
const BOWL_GAIN = 4.2;
const BOWL_MIN = 2.2;
const BOWL_MAX = 10;
/** The phone's heading turns the shot this much (a quarter), up to MAX_ANGLE. */
const AIM_GAIN = 0.25;
const MAX_ANGLE = 0.07;

const PIN_SPOTS: [number, number][] = (() => {
  const spots: [number, number][] = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) spots.push([(i - row / 2) * 0.305, LANE.headPin - row * 0.264]);
  }
  return spots;
})();

/** Ball and rules state, plain module state (read by the end-to-end check too). */
export const bowl = {
  phase: "ready" as "ready" | "holding" | "rolling" | "settling" | "over",
  phaseAt: 0,
  /** Pins still in play this frame (fallen ones are cleared after the first ball). */
  standing: Array(PINS).fill(true) as boolean[],
  history: [] as { t: number; v: number }[],
  stillSince: 0,
  prevGrip: false,
  lastSpeed: 0,
};

function pinGeometry() {
  // Tenpin profile (radius, height), 38 cm tall
  const profile: [number, number][] = [
    [0, 0], [0.026, 0], [0.034, 0.01], [0.048, 0.05], [0.06, 0.1], [0.061, 0.13], [0.055, 0.17],
    [0.04, 0.215], [0.028, 0.25], [0.025, 0.27], [0.03, 0.3], [0.034, 0.33], [0.03, 0.36], [0.018, 0.377], [0, 0.38],
  ];
  return new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), 40);
}

function Lane() {
  const len = LANE.start - LANE.end;
  const mid = (LANE.start + LANE.end) / 2;
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Lane surface, top at y = 0; oiled, so low friction */}
      <CuboidCollider args={[LANE.halfW, 0.05, len / 2]} position={[0, -0.05, mid]} friction={0.04} />
      <mesh position={[0, -0.01, mid]} receiveShadow>
        <boxGeometry args={[LANE.halfW * 2, 0.02, len]} />
        <meshStandardMaterial color="#f3e2c7" roughness={0.35} />
      </mesh>
      {/* Gutters, a little lower, with outer lips */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <CuboidCollider
            args={[(GUTTER.outer - GUTTER.inner) / 2, 0.05, len / 2]}
            position={[side * (GUTTER.inner + GUTTER.outer) / 2, -GUTTER.depth - 0.05, mid]}
          />
          <CuboidCollider args={[0.02, 0.06, len / 2]} position={[side * (GUTTER.outer + 0.02), 0, mid]} />
          <mesh position={[side * (GUTTER.inner + GUTTER.outer) / 2, -GUTTER.depth, mid]} receiveShadow>
            <boxGeometry args={[GUTTER.outer - GUTTER.inner, 0.01, len]} />
            <meshStandardMaterial color="#e3e7ee" roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* Pit: a lower floor past the pins, side kickbacks and a back cushion */}
      <CuboidCollider args={[1.0, 0.05, 0.6]} position={[0, -0.4, LANE.end - 0.6]} />
      <CuboidCollider args={[1.0, 0.5, 0.05]} position={[0, 0.1, LANE.end - 1.2]} restitution={0.05} />
      {[-1, 1].map((side) => (
        <CuboidCollider key={side} args={[0.03, 0.4, 1.7]} position={[side * 0.95, 0.1, LANE.end + 0.5]} />
      ))}
      <mesh position={[0, 0.1, LANE.end - 1.2]} receiveShadow>
        <boxGeometry args={[2, 1, 0.1]} />
        <BackgroundGlass tint="#e8e2ff" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.95, 0.1, LANE.end + 0.5]}>
          <boxGeometry args={[0.06, 0.8, 3.4]} />
          <BackgroundGlass tint="#f0f4ff" />
        </mesh>
      ))}
      {/* Foul line */}
      <mesh position={[0, 0.001, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[LANE.halfW * 2, 0.02]} />
        <meshBasicMaterial color="#ff4d6d" />
      </mesh>
      {/* Ball pedestal */}
      <mesh position={[RACK.x, RACK.y / 2 - 0.06, RACK.z]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.17, RACK.y - 0.12, 32]} />
        <BackgroundGlass tint="#f2fbff" />
      </mesh>
    </RigidBody>
  );
}

export default function Bowling() {
  const { rapier } = useRapier();
  const ball = useRef<RapierRigidBody>(null);
  const pins = useRef<(RapierRigidBody | null)[]>([]);
  const pinGeo = useMemo(() => pinGeometry(), []);
  useEffect(() => () => pinGeo.dispose(), [pinGeo]);
  const s = useRef({ v: new Vector3(), down: new Vector3() }).current;

  const setPhase = (p: typeof bowl.phase) => {
    bowl.phase = p;
    bowl.phaseAt = performance.now();
  };

  const rack = (which: boolean[]) => {
    pins.current.forEach((rb, i) => {
      if (!rb) return;
      if (which[i]) {
        rb.setEnabled(true);
        rb.setTranslation({ x: PIN_SPOTS[i][0], y: 0, z: PIN_SPOTS[i][1] }, true);
        rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        rb.setTranslation({ x: PIN_SPOTS[i][0], y: -20, z: PIN_SPOTS[i][1] }, false);
        rb.setEnabled(false);
      }
    });
  };

  const parkBall = () => {
    const rb = ball.current;
    if (!rb) return;
    rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
    rb.setTranslation({ x: RACK.x, y: RACK.y, z: RACK.z }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };

  // A fresh game whenever the lane opens.
  useEffect(() => {
    bowl.standing.fill(true);
    bowl.prevGrip = rigs[0].grip;
    setPhase("ready");
    const id = requestAnimationFrame(() => {
      rack(bowl.standing);
      parkBall();
    });
    return () => cancelAnimationFrame(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fallen = (i: number) => {
    const rb = pins.current[i];
    if (!rb) return true;
    const t = rb.translation();
    const q = rb.rotation();
    const upright = 1 - 2 * (q.x * q.x + q.z * q.z); // local up . world up
    return upright < 0.85 || Math.hypot(t.x - PIN_SPOTS[i][0], t.z - PIN_SPOTS[i][1]) > 0.12 || t.y < -0.2;
  };

  /** Count the roll, call it, and set up the next ball (or end the game). */
  const finishRoll = () => {
    const knocked = bowl.standing.filter((up, i) => up && fallen(i)).length;
    const before = position(useGameStore.getState().bowling.rolls);
    const rolls = [...useGameStore.getState().bowling.rolls, knocked];
    const after = position(rolls);
    const cleared = knocked === before.standing;
    callout(
      cleared && before.standing === 10 ? "Strike!" : cleared ? "Spare!" : knocked === 0 ? "Gutter ball" : `${knocked} pin${knocked === 1 ? "" : "s"}`,
    );
    useGameStore.setState({ bowling: { rolls, over: after.over } });
    if (after.over) {
      callout(`Game over · ${totalScore(rolls)}`);
      setPhase("over");
    } else {
      if (after.standing === 10) bowl.standing.fill(true);
      else bowl.standing.forEach((up, i) => (bowl.standing[i] = up && !fallen(i)));
      setPhase("ready");
    }
    rack(bowl.standing);
    parkBall();
  };

  useFrame(() => {
    const rb = ball.current;
    if (!rb) return;
    const now = performance.now();
    const r0 = rigs[0];
    const grip = r0.live && r0.grip;
    const pressed = grip && !bowl.prevGrip;
    const released = !grip && bowl.prevGrip;
    bowl.prevGrip = grip;
    const t = rb.translation();

    if (bowl.phase === "ready" || bowl.phase === "over") {
      if (pressed) {
        if (bowl.phase === "over") {
          useGameStore.setState({ bowling: { rolls: [], over: false } });
          bowl.standing.fill(true);
          rack(bowl.standing);
        }
        bowl.history.length = 0;
        setPhase("holding");
      }
    } else if (bowl.phase === "holding") {
      // The ball rides in the hand, just below it along the phone's bottom edge.
      s.down.set(0, -1, 0).applyQuaternion(r0.handQuat);
      s.v.copy(r0.handPos).addScaledVector(s.down, BALL_R + 0.03);
      rb.setNextKinematicTranslation(s.v);
      bowl.history.push({ t: now, v: -r0.handVel.z });
      while (bowl.history.length && now - bowl.history[0].t > 350) bowl.history.shift();
      if (released) {
        const peak = Math.max(0, ...bowl.history.map((h) => h.v));
        const speed = peak * BOWL_GAIN;
        bowl.lastSpeed = speed;
        if (speed < BOWL_MIN) {
          callout("Swing forward, then let go");
          parkBall();
          setPhase("ready");
        } else {
          const v = Math.min(BOWL_MAX, speed);
          const angle = MathUtils.clamp(r0.heading * AIM_GAIN, -MAX_ANGLE, MAX_ANGLE);
          rb.setBodyType(rapier.RigidBodyType.Dynamic, true);
          rb.setTranslation({ x: MathUtils.clamp(r0.handPos.x, -0.42, 0.42), y: BALL_R + 0.003, z: -0.25 }, true);
          rb.setLinvel({ x: -Math.sin(angle) * v, y: 0, z: -Math.cos(angle) * v }, true);
          rb.setAngvel({ x: -v / BALL_R, y: 0, z: 0 }, true);
          bowl.stillSince = 0;
          setPhase("rolling");
        }
      }
    } else if (bowl.phase === "rolling") {
      const lv = rb.linvel();
      if (Math.hypot(lv.x, lv.z) < 0.1) bowl.stillSince ||= now;
      else bowl.stillSince = 0;
      const done =
        t.z < LANE.end - 0.3 || t.y < -0.6 || (bowl.stillSince > 0 && now - bowl.stillSince > 800) || now - bowl.phaseAt > ROLL_TIMEOUT_MS;
      if (done) setPhase("settling");
    } else if (bowl.phase === "settling" && now - bowl.phaseAt > SETTLE_MS) {
      finishRoll();
    }

    // Camera: behind the bowler, then down the lane with the ball.
    if (bowl.phase === "rolling" || bowl.phase === "settling") {
      const z = MathUtils.clamp(t.z + 4.4, -10.4, 3.9);
      setView(0.5, 1.8, z, 0, 0.2, Math.min(t.z - 4, LANE.headPin), 40);
    } else {
      // Behind and right of the bowler, high enough to see the whole lane.
      setView(1.1, 2.5, 5.0, 0, 0.2, -10, 40);
    }
  });

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, -5]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#ffffff" roughness={1} toneMapped={false} />
      </mesh>
      <Lane />
      {PIN_SPOTS.map(([x, z], i) => (
        <RigidBody
          key={i}
          ref={(rb) => {
            pins.current[i] = rb;
          }}
          position={[x, 0, z]}
          colliders={false}
          linearDamping={0.1}
          angularDamping={0.2}
        >
          <CylinderCollider args={[0.17, 0.058]} position={[0, 0.19, 0]} mass={1.5} restitution={0.4} friction={0.4} />
          {/* Solid gloss white with a red neck band: glass pins vanished against the lane at 15 m. */}
          <mesh geometry={pinGeo} castShadow>
            <meshPhysicalMaterial color="#ffffff" roughness={0.15} clearcoat={1} clearcoatRoughness={0.05} />
          </mesh>
          <mesh position={[0, 0.255, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.027, 0.006, 8, 24]} />
            <meshStandardMaterial color="#ff3b5c" roughness={0.3} />
          </mesh>
        </RigidBody>
      ))}
      <RigidBody ref={ball} type="kinematicPosition" colliders={false} ccd position={[RACK.x, RACK.y, RACK.z]}>
        <BallCollider args={[BALL_R]} mass={6} restitution={0.05} friction={0.2} />
        <mesh castShadow>
          <sphereGeometry args={[BALL_R, 48, 32]} />
          <Glass tint="#b38cff" />
        </mesh>
      </RigidBody>
    </>
  );
}
