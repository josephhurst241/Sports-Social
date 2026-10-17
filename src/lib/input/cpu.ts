import { Vector3 } from "three";
import { CONTACT, forwardZ, rigs } from "@/lib/game/rig";
import { game, predictAtPlane } from "@/lib/games/pingpong";
import type { PlayerSlot } from "@/lib/net/protocol";

// The CPU opponent plays through the same one-button paddle as the keyboard:
// it decides when to hold and release, and the swing, physics and assist do
// the rest. Its timing jitters a little per shot, so it misses now and then.

/** Release this long before the ball reaches the hitting plane (s): swing time to the contact point. */
const LEAD = 0.17;
const JITTER = 0.04;
/** Chance per shot that the CPU mistimes badly, so it can lose points. */
const MISS_CHANCE = 0.12;
const SERVE_DELAY_MS = 900;
/** The floating serve toss is back at its starting height after this long (s); the paddle rides with it. */
const TOSS_FALL = 0.7;

interface CpuState {
  lead: number;
  aim: number;
  tossAt: number;
  held: boolean;
}

const cpus: [CpuState, CpuState] = [
  { lead: LEAD, aim: 0, tossAt: 0, held: false },
  { lead: LEAD, aim: 0, tossAt: 0, held: false },
];
const pred = new Vector3();

function newShot(c: CpuState) {
  c.lead = LEAD + (Math.random() * 2 - 1) * JITTER + (Math.random() < MISS_CHANCE ? 0.22 : 0);
  c.aim = Math.random() * 2 - 1;
}

export function cpuIntent(slot: PlayerSlot, now: number): { held: boolean; aim: number } {
  const c = cpus[slot];
  const r = rigs[slot];
  if (game.phase === "idle") {
    if (game.server === slot && now - game.phaseAt > SERVE_DELAY_MS && !c.held) {
      newShot(c);
      c.held = true;
      c.tossAt = now;
    }
  } else if (game.phase === "play") {
    if (c.tossAt) {
      // Serving: let the tossed ball fall back toward the paddle, then swing.
      if ((now - c.tossAt) / 1000 > TOSS_FALL - c.lead) {
        c.held = false;
        c.tossAt = 0;
      }
    } else {
      const fz = forwardZ(slot);
      const v = game.ballVel;
      const incoming = v.z * fz < -0.3 && game.lastHitter !== slot;
      const plane = r.root.z - CONTACT.z * fz;
      if (incoming && predictAtPlane(game.ballPos, v, plane, pred)) {
        const tt = (plane - game.ballPos.z) / v.z;
        if (!c.held && tt > c.lead + 0.1) {
          newShot(c);
          c.held = true;
        } else if (c.held && tt <= c.lead) {
          c.held = false;
        }
      } else if (c.held && !incoming) {
        c.held = false;
      }
    }
  } else {
    c.held = false;
    c.tossAt = 0;
  }
  return { held: c.held, aim: c.aim };
}
