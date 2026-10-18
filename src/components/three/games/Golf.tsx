"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef, type RefObject } from "react";
import { MathUtils, Vector3, type Group, type Mesh } from "three";
import { placeRig, rigs } from "@/lib/game/rig";
import { assistAim } from "@/lib/game/assist";
import { setView } from "@/lib/game/view";
import { BALL_R, CUP_G, CUP_R, HOLES, cupOutcome, scoreName, type CupPass } from "@/lib/games/golf";
import type { PlayerSlot } from "@/lib/net/protocol";
import { sendResult } from "@/lib/net/host";
import { callout, feedback, nextTurn, playerName, useGameStore } from "@/store/gameStore";
import { PUTTER } from "../Avatar";
import Floor from "../Floor";
import { BackgroundGlass, Glass } from "../Glass";

// Mini golf: hold the phone screen, swing it like a putter, let go to strike.
// The putter head's forward speed at release sets the power; where the back
// of the phone points aims the putt (the line on the green shows it).
// With two phones in, each player plays a whole hole, then the other plays
// it from the tee. Whoever's turn it is stands beside the ball for every
// stroke; the other watches from the side.

const RAIL_H = 0.12;
/** Ball speed = putter-head speed at release x this, within [MIN, MAX] m/s. */
const PUTT_GAIN = 1.7;
const PUTT_MIN = 0.25;
/** The putt's pace is the putter head's fastest moment in this long before letting go. */
const SWING_WINDOW_MS = 450;
const PUTT_MAX = 6;
/** How far the phone's heading turns the aim (full), and the most it can. */
const AIM_MAX = 1.2;
/** Aim assist: within this of straight at the cup (radians, about 8.5°), the aim is drawn most of the way to it. */
const AIM_SNAP = 0.15;
const STOP_SPEED = 0.05;
/** Rolling resistance of the turf, m/s² (on top of light damping): a 4 m/s putt rolls about 6 m. */
export const ROLL_DECEL = 1.1;
const NEXT_HOLE_MS = 2600;
/** After crossing the hole: how long the ball takes to sink, ride the rim, or come down from a hop, s. */
const CUP_AFTER = { drop: 0.25, lip: 0.2, hop: 0.14 };
/** How high a hop lifts the ball above the turf, m. */
const HOP_H = 0.025;
const UP = new Vector3(0, 1, 0);

export const golfState = {
  // "cup": the ball is crossing the hole (see cupOutcome), played out along a scripted path.
  phase: "aim" as "aim" | "address" | "rolling" | "cup" | "holed" | "next" | "over",
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
  /** The ball's center last frame: a fast ball can cross the whole hole between two frames. */
  prevBall: new Vector3(),
  /** Off from a lip-out or hop until the ball is clear of the rim, so one pass over the cup counts once. */
  cupArmed: true,
  /** The pass over the cup being played out (phase "cup"). */
  cup: { kind: "drop" as CupPass["kind"], t0: 0, entry: new Vector3(), dir: new Vector3(), speed: 0, cross: 0, turn: 0, keep: 0 },
  /** The last pass over the cup, for the headless check. */
  lastCup: null as { kind: CupPass["kind"]; speed: number; offset: number } | null,
  /** When the ball last met the rim: the flag wobbles. */
  flagHitAt: -Infinity,
  /** Rolls the ball from (x, z) at (vx, vz) m/s, for scripts/check.mjs. Set while the green is mounted. */
  launch: null as ((x: number, z: number, vx: number, vz: number) => void) | null,
};

const yawTo = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(-(toX - fromX), -(toZ - fromZ));

function Green({ hole, flag }: { hole: number; flag: RefObject<Group | null> }) {
  const h = HOLES[hole];
  const [w, d] = h.size;
  return (
    <RigidBody type="fixed" colliders={false} key={hole}>
      {/* Turf, top at y = 0 */}
      <CuboidCollider args={[w / 2, 0.05, d / 2]} position={[0, -0.05, 0]} friction={0.6} restitution={0.1} />
      {/* Matte turf with a dim reflection: a glossier top mirrored the white studio
          sky at this low camera angle and washed the green out, hiding the white ball. */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color="#2e9a57" roughness={1} envMapIntensity={0.35} />
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
      {/* Pivots at its foot, so a ball meeting the rim can make it wobble */}
      <group ref={flag} position={[h.cup[0], 0, h.cup[1]]}>
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 1.2, 10]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
        <mesh position={[0.16, 1.08, 0]}>
          <boxGeometry args={[0.3, 0.2, 0.01]} />
          <Glass tint="#ff8fc7" />
        </mesh>
      </group>
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
  const flag = useRef<Group>(null);
  const hole = useGameStore((s) => s.golf.hole);
  const turn = useGameStore((s) => s.golf.turn);
  const s = useRef({ head: new Vector3(), down: new Vector3(), fwd: new Vector3(), tmp: new Vector3(), rim: new Vector3() }).current;

  const setPhase = (p: typeof golfState.phase) => {
    golfState.phase = p;
    golfState.phaseAt = performance.now();
  };

  /** Ball at rest on the lie; whoever's turn it is stands beside it facing the cup. */
  const address = () => {
    const rb = ball.current;
    const { hole, turn } = useGameStore.getState().golf;
    const h = HOLES[hole];
    if (!rb) return;
    const lie = golfState.lie;
    rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
    rb.setTranslation({ x: lie.x, y: BALL_R, z: lie.z }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    golfState.prevBall.set(lie.x, 0, lie.z);
    golfState.cupArmed = true;
    golfState.baseYaw = yawTo(lie.x, lie.z, h.cup[0], h.cup[1]);
    // Stand so the putter head hangs just behind the ball (it hangs 0.24 m to
    // the player's right and slightly ahead of the feet).
    const f = golfState.baseYaw;
    const back = 0.16, side = 0.24;
    const x = lie.x - (-Math.sin(f)) * back - Math.cos(f) * side;
    const z = lie.z - (-Math.cos(f)) * back + Math.sin(f) * side;
    placeRig(turn, x, 0, z, f, "pendulum");
    placeRig((1 - turn) as PlayerSlot, x - Math.cos(f) * 1.6, 0, z + Math.sin(f) * 1.6, f, "pendulum");
    golfState.prevGrip = rigs[turn].grip;
    setPhase("aim");
  };

  /** Sets the ball rolling from (x, z) along unit (dirX, dirZ) at `v` m/s, with matching topspin (no skid). */
  const roll = (x: number, z: number, dirX: number, dirZ: number, v: number) => {
    const rb = ball.current;
    if (!rb) return;
    rb.setBodyType(rapier.RigidBodyType.Dynamic, true);
    rb.setTranslation({ x, y: BALL_R, z }, true);
    rb.setLinvel({ x: dirX * v, y: 0, z: dirZ * v }, true);
    // Spin axis = up x direction, rate v / r.
    rb.setAngvel({ x: dirZ * (v / BALL_R), y: 0, z: -dirX * (v / BALL_R) }, true);
    golfState.prevBall.set(x, 0, z);
    golfState.stillSince = 0;
    setPhase("rolling");
  };

  useEffect(() => {
    golfState.launch = (x, z, vx, vz) => {
      const v = Math.hypot(vx, vz);
      golfState.cupArmed = true;
      if (v > 0) roll(x, z, vx / v, vz / v, v);
    };
    return () => {
      golfState.launch = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** In the cup: card the stroke and call it, then on to the next turn or hole (or the end). */
  const holeOut = () => {
    const rb = ball.current;
    const g = useGameStore.getState().golf;
    const h = HOLES[g.hole];
    if (!rb) return;
    rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
    rb.setTranslation({ x: h.cup[0], y: -0.06, z: h.cup[1] }, true);
    feedback("make", h.cup[0], 0, h.cup[1]);
    const strokes = g.strokes;
    const cards: typeof g.cards = [...g.cards];
    cards[g.turn] = [...g.cards[g.turn], strokes];
    // Over once nobody is left to play this hole and it was the last one.
    const waiting = nextTurn(g.turn, g.players, (p) => cards[p].length > g.hole) !== g.turn;
    const over = !waiting && g.hole === HOLES.length - 1;
    useGameStore.setState({ golf: { ...g, cards, over } });

    const total = (p: PlayerSlot) => cards[p].reduce((n, x) => n + x, 0);
    if (over) {
      // Each golfer's card, for their career (won: only with two golfers; fewest strokes).
      for (const p of g.players === 2 ? ([0, 1] as const) : [g.turn]) {
        if (!cards[p].length) continue;
        const won = g.players === 2 ? total(p) < total((1 - p) as PlayerSlot) : undefined;
        sendResult(p, { game: "golf", strokes: cards[p], par: HOLES.slice(0, cards[p].length).map((x) => x.par), holes: HOLES.length, won });
      }
    }
    if (over && g.players === 2) {
      const [a, b] = [total(0), total(1)];
      // Fewest strokes wins.
      callout(a === b ? `Tied · ${a} strokes each` : `${playerName(a < b ? 0 : 1)} wins · ${Math.min(a, b)} to ${Math.max(a, b)}`, "make");
    } else {
      callout(`${scoreName(strokes, h.par)} · ${strokes} stroke${strokes === 1 ? "" : "s"}`, "make");
    }
    setPhase(over ? "over" : "holed");
  };

  // New hole, or the next player on this one: ball on the tee.
  useEffect(() => {
    const h = HOLES[hole];
    golfState.lie.set(h.tee[0], 0, h.tee[1]);
    const id = requestAnimationFrame(address);
    return () => cancelAnimationFrame(id);
  }, [hole, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const rb = ball.current;
    if (!rb) return;
    const now = performance.now();
    const g = useGameStore.getState().golf;
    // Only the golfer whose turn it is controls the putter.
    const r0 = rigs[g.turn];
    const grip = r0.live && r0.grip;
    // While the golfer is calibrating, their swings are for calibration only.
    const calibrating = !!useGameStore.getState().calibration[g.turn];
    const pressed = !calibrating && grip && !golfState.prevGrip;
    const released = !calibrating && !grip && golfState.prevGrip;
    golfState.prevGrip = grip;
    const h = HOLES[g.hole];
    /** Has this player finished the current hole? */
    const holedOut = (p: PlayerSlot) => g.cards[p].length > g.hole;
    const t = rb.translation();

    // Aim: straight at the cup, turned by the phone's heading.
    const aimYaw = golfState.baseYaw + assistAim(MathUtils.clamp(r0.heading, -AIM_MAX, AIM_MAX), AIM_SNAP);
    s.fwd.set(-Math.sin(aimYaw), 0, -Math.cos(aimYaw));

    // Putter head: hangs from the hand along the phone's bottom edge.
    s.down.set(0, -1, 0).applyQuaternion(r0.handQuat);
    s.head.copy(r0.handPos).addScaledVector(s.down, PUTTER.shaft);
    const headSpeed = s.tmp.subVectors(s.head, golfState.prevHead).dot(s.fwd) / Math.max(delta, 1e-3);
    golfState.prevHead.copy(s.head);

    if (golfState.phase === "aim" && !useGameStore.getState().players[g.turn].connected) {
      // The golfer's phone left: the other player, if still to play this hole, tees off (the new turn re-tees the ball).
      const turn = nextTurn(g.turn, g.players, holedOut);
      if (turn !== g.turn) {
        setPhase("next");
        useGameStore.setState({ golf: { ...g, turn, strokes: 0 } });
      }
    } else if (golfState.phase === "aim" || golfState.phase === "address") {
      if (golfState.phase === "aim" && pressed) {
        golfState.history.length = 0;
        setPhase("address");
      }
      if (golfState.phase === "address") {
        golfState.history.push({ t: now, v: headSpeed });
        while (golfState.history.length && now - golfState.history[0].t > SWING_WINDOW_MS) golfState.history.shift();
        if (released) {
          const peak = Math.max(0, ...golfState.history.map((e) => e.v));
          // The calibrated swing: a player's normal swing is a medium putt.
          const speed = peak * PUTT_GAIN * (r0.games.golf?.swing ?? 1) * r0.sens.swing;
          golfState.lastSpeed = speed;
          if (speed < PUTT_MIN) {
            callout("Swing the putter forward, then let go");
            setPhase("aim");
          } else {
            // Topspin to match, so it rolls from the start instead of skidding.
            roll(t.x, t.z, s.fwd.x, s.fwd.z, Math.min(PUTT_MAX, speed));
            useGameStore.setState({ golf: { ...g, strokes: g.strokes + 1 } });
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
      const [cx, cz] = h.cup;
      if (!golfState.cupArmed && Math.hypot(t.x - cx, t.z - cz) > CUP_R + BALL_R) golfState.cupArmed = true;
      // Did the ball's center cross the rim since last frame? Along its line from
      // last frame's spot: `along` to the point nearest the cup, `offset` to the side.
      const p0 = golfState.prevBall;
      const fx = speed > 1e-4 ? lv.x / speed : 0;
      const fz = speed > 1e-4 ? lv.z / speed : 0;
      const along = (cx - p0.x) * fx + (cz - p0.z) * fz;
      const offset = (cx - p0.x) * -fz + (cz - p0.z) * fx;
      const half = Math.sqrt(Math.max(0, CUP_R * CUP_R - offset * offset));
      const moved = (t.x - p0.x) * fx + (t.z - p0.z) * fz;
      const crossed = golfState.cupArmed && speed > 1e-4 && Math.abs(offset) < CUP_R && along - half <= moved && along + half >= 0;
      golfState.prevBall.set(t.x, 0, t.z);
      if (crossed) {
        // Over the hole: the cup model decides, and the ball plays it out on a scripted path.
        const pass = cupOutcome(speed, offset);
        const into = Math.max(0, along - half); // where it crossed the near rim, along the line
        const c = golfState.cup;
        c.kind = pass.kind;
        c.t0 = now;
        c.entry.set(p0.x + fx * into, BALL_R, p0.z + fz * into);
        c.dir.set(fx, 0, fz);
        c.speed = speed;
        // Time across the rest of the hole; a drop only falls until it is a ball's depth down, then sinks.
        const left = (along + half - into) / speed;
        c.cross = pass.kind === "drop" ? Math.min(left, Math.sqrt((2 * BALL_R) / CUP_G)) : left;
        c.turn = pass.turn;
        c.keep = pass.keep;
        golfState.lastCup = { kind: pass.kind, speed, offset };
        golfState.flagHitAt = now;
        rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
        if (pass.kind === "lip") {
          callout("Lipped out", "miss");
          feedback("miss", cx, 0, cz);
        } else if (pass.kind === "hop") {
          callout("Too fast", "miss");
          feedback("miss", cx, 0, cz);
        }
        setPhase("cup");
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
    } else if (golfState.phase === "cup") {
      const c = golfState.cup;
      const [cx, cz] = h.cup;
      const e = (now - c.t0) / 1000;
      if (e < c.cross) {
        // Across the hole with no turf under it: falling.
        s.tmp.copy(c.entry).addScaledVector(c.dir, c.speed * e);
        s.tmp.y = BALL_R - 0.5 * CUP_G * e * e;
        rb.setNextKinematicTranslation(s.tmp);
      } else {
        // Then what the far rim does with it.
        const k = Math.min(1, (e - c.cross) / CUP_AFTER[c.kind as keyof typeof CUP_AFTER]);
        const rimY = BALL_R - 0.5 * CUP_G * c.cross * c.cross;
        s.rim.copy(c.entry).addScaledVector(c.dir, c.speed * c.cross); // where it met the far rim
        if (c.kind === "drop") {
          // Down and into the middle of the cup.
          s.tmp.set(MathUtils.lerp(s.rim.x, cx, k), MathUtils.lerp(rimY, -0.06, k * k), MathUtils.lerp(s.rim.z, cz, k));
        } else if (c.kind === "lip") {
          // Rides the rim around (the way it was already heading round it) and climbs back out.
          s.tmp.set(s.rim.x - cx, 0, s.rim.z - cz);
          const way = Math.sign(s.tmp.z * c.dir.x - s.tmp.x * c.dir.z);
          s.tmp.applyAxisAngle(UP, way * c.turn * k);
          s.tmp.x += cx;
          s.tmp.z += cz;
          s.tmp.y = rimY + (BALL_R - rimY) * k;
          if (k >= 1) c.dir.applyAxisAngle(UP, way * c.turn);
        } else {
          // Skims the far rim and hops on.
          s.tmp.copy(s.rim).addScaledVector(c.dir, c.speed * c.keep * (e - c.cross));
          s.tmp.y = rimY + (BALL_R - rimY) * k + HOP_H * Math.sin(Math.PI * k);
        }
        rb.setNextKinematicTranslation(s.tmp);
        if (k >= 1) {
          // Played out, exactly once: into the cup, or rolling on.
          if (c.kind === "drop") holeOut();
          else {
            golfState.cupArmed = false;
            roll(s.tmp.x, s.tmp.z, c.dir.x, c.dir.z, c.speed * c.keep);
          }
        }
      }
    } else if (golfState.phase === "holed" && now - golfState.phaseAt > NEXT_HOLE_MS) {
      // Advance exactly once; the effect for the new hole or turn tees the ball up and sets "aim".
      // The other player plays this hole if they still have to, else on to the next hole, Player 1 first.
      setPhase("next");
      const other = nextTurn(g.turn, g.players, holedOut);
      const first: PlayerSlot = g.players === 2 && useGameStore.getState().players[0].connected ? 0 : g.turn;
      const [hole, turn] = other !== g.turn ? [g.hole, other] : [g.hole + 1, first];
      useGameStore.setState({ golf: { ...g, hole, turn, strokes: 0 } });
      if (g.players === 2) callout(`${hole === g.hole ? "" : `Hole ${hole + 1} · `}${playerName(turn)} is up`);
    } else if (golfState.phase === "over" && pressed) {
      // Play again from hole 1 (the hole change re-tees the ball).
      setPhase("next");
      const first: PlayerSlot = g.players === 2 && useGameStore.getState().players[0].connected ? 0 : g.turn;
      useGameStore.setState({ golf: { ...g, hole: 0, turn: first, strokes: 0, cards: [[], []], over: false } });
    }

    // The flag wobbles when the ball meets the rim, and settles.
    if (flag.current) {
      const k = (now - golfState.flagHitAt) / 1000;
      flag.current.rotation.z = k < 1.5 ? 0.1 * Math.sin(k * 20) * Math.exp(-k * 3.5) : 0;
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
    const moving = golfState.phase === "rolling" || golfState.phase === "cup";
    const bx = moving ? t.x : golfState.lie.x;
    const bz = moving ? t.z : golfState.lie.z;
    // Behind the ball, high and to the right, so the golfer (left of the ball) never blocks the line.
    // Focus: while the golfer stands over the ball (holding the screen), the camera eases in lower and
    // closer along the line, to judge the aim; it pulls back out to follow the putt.
    const focus = golfState.phase === "address";
    const back = focus ? 3 : 4.4, right = focus ? 0.8 : 1.1;
    setView(
      bx + Math.sin(f) * back + Math.cos(f) * right,
      focus ? 1.95 : 2.8,
      bz + Math.cos(f) * back - Math.sin(f) * right,
      bx - Math.sin(f) * 1.8,
      0,
      bz - Math.cos(f) * 1.8,
      focus ? 37 : 42,
    );
  });

  return (
    <>
      <Floor y={-0.05} />
      <Green hole={hole} flag={flag} />
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
