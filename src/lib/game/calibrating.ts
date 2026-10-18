import { Vector3 } from "three";
import type { PlayerSlot } from "@/lib/net/protocol";
import { requestRecenter, useGameStore } from "@/store/gameStore";
import {
  DONE_SECONDS,
  HOLD_SECONDS,
  REPS_MIN,
  REP_MIN,
  gameCal,
  percentile,
  repsDone,
  type CalGame,
  type CalStep,
  type CalView,
  type GameCal,
} from "./calibration";
import { PUTTER_SHAFT, rigs } from "./rig";

// Runs a player's calibration for the game they are in (the rules are in
// calibration.ts): shows how to hold the phone, waits for Ready, takes the
// rest pose, then measures that game's action rep by rep until the reps are
// enough, and stores the result as rig.games[game]. The step reaches the
// store (calibration[slot]) only when it changes visibly, never every frame;
// the host forwards it to that player's phone. While it runs, that player's
// game input is paused (the games check calibration[slot]).
//
// It starts the first time a phone uses Motion in a game, or when the player
// asks again from Settings; leaving the game cancels it; a phone that leaves
// forgets all of its calibrations.

/** Give up waiting for reps after this long: what was measured counts (or nothing, if none). */
const ACTION_TIMEOUT = 60;
/** Ping pong: a swing ends when the blade's forward speed falls below this, m/s. */
const SWING_END = 0.3;
/** Bowling and golf: the pace is the fastest forward speed this close before letting go, ms (as in the games). */
const PACE_MS = 450;

interface Measure {
  game: CalGame;
  stepAt: number;
  /** Headings while holding still; their median is the rest heading. */
  rest: number[];
  baseline: number;
  /** Each rep's peak speed, and where the phone pointed at release (from rest). */
  peaks: number[];
  aims: number[];
  /** The forward speeds of the current swing, over the last moments. */
  history: { t: number; v: number }[];
  prevGrip: boolean;
  /** Golf: the putter head last frame, for its speed. */
  head: Vector3;
  headAt: number;
  /** Ping pong: the fastest the current swing has been (0 when not swinging). */
  swingPeak: number;
  /** The calibration this run replaces, restored if it is skipped. */
  before: GameCal | undefined;
}
const blank = (game: CalGame): Measure => ({
  game,
  stepAt: 0,
  rest: [],
  baseline: 0,
  peaks: [],
  aims: [],
  history: [],
  prevGrip: false,
  head: new Vector3(),
  headAt: 0,
  swingPeak: 0,
  before: undefined,
});
const runs: [Measure, Measure] = [blank("golf"), blank("golf")];
const scratch = new Vector3();

function setView(slot: PlayerSlot, view: CalView | null) {
  const calibration = [...useGameStore.getState().calibration] as [CalView | null, CalView | null];
  calibration[slot] = view;
  useGameStore.setState({ calibration });
}

function show(slot: PlayerSlot, step: CalStep, result: GameCal | null = null) {
  const m = runs[slot];
  m.stepAt = performance.now();
  setView(slot, { game: m.game, step, waiting: step !== "done", progress: 0, reps: m.peaks.length, needed: REPS_MIN, result });
}

/** Starts calibrating a player for the game they are in (Motion only; the games pause their input). */
export function startCalibration(slot: PlayerSlot, game: CalGame) {
  const st = useGameStore.getState();
  if (st.scene !== game || !st.players[slot].connected) return;
  const m = (runs[slot] = blank(game));
  m.before = rigs[slot].games[game];
  // Measure the player as they are, without the old result (its aim zero) on top.
  delete rigs[slot].games[game];
  show(slot, "hold");
}

/** The player tapped Ready: the step starts measuring now. */
export function confirmReady(slot: PlayerSlot) {
  const view = useGameStore.getState().calibration[slot];
  if (!view?.waiting) return;
  const m = runs[slot];
  m.stepAt = performance.now();
  m.rest = [];
  m.history.length = 0;
  m.prevGrip = rigs[slot].grip;
  m.swingPeak = 0;
  m.headAt = 0;
  // The rest pose faces the laptop: zero the compass there.
  if (view.step === "hold") requestRecenter(slot);
  setView(slot, { ...view, waiting: false, progress: 0 });
}

/** Stops a run part way (skipped, the phone switched to Buttons, or they left the game): the old result stays. */
export function cancelCalibration(slot: PlayerSlot) {
  if (!useGameStore.getState().calibration[slot]) return;
  const m = runs[slot];
  if (m.before) rigs[slot].games[m.game] = m.before;
  setView(slot, null);
}

/** Forgets all of a player's calibrations (their phone left). */
export function resetCalibration(slot: PlayerSlot) {
  rigs[slot].games = {};
  if (useGameStore.getState().calibration[slot]) setView(slot, null);
}

function finish(slot: PlayerSlot) {
  const m = runs[slot];
  if (!m.peaks.length) return cancelCalibration(slot);
  const result = gameCal(m.game, m.peaks, m.aims);
  rigs[slot].games[m.game] = result;
  show(slot, "done", result);
}

/** One rep measured: keep it if it was a real swing; finish once there are enough. */
function rep(slot: PlayerSlot, peak: number, aim: number) {
  const m = runs[slot];
  if (peak < REP_MIN[m.game]) return;
  m.peaks.push(peak);
  m.aims.push(aim);
  if (repsDone(m.peaks)) finish(slot);
  else {
    const view = useGameStore.getState().calibration[slot]!;
    setView(slot, { ...view, reps: m.peaks.length, needed: Math.max(1, REPS_MIN - m.peaks.length) });
  }
}

/** One frame of every running calibration. Called from the scene's frame loop. */
export function stepCalibration(now: number) {
  const views = useGameStore.getState().calibration;
  for (const slot of [0, 1] as const) {
    const view = views[slot];
    if (!view) continue;
    const r = rigs[slot];
    const m = runs[slot];
    const t = (now - m.stepAt) / 1000;

    if (view.step === "done") {
      if (t >= DONE_SECONDS) setView(slot, null);
      continue;
    }
    // Shown, waiting for Ready; and nothing is measured while the phone is silent.
    if (view.waiting || !r.live) continue;

    if (view.step === "hold") {
      m.rest.push(r.heading);
      const progress = Math.min(1, t / HOLD_SECONDS);
      if (progress >= 1) {
        m.baseline = percentile(m.rest, 0.5);
        // The swing arm's rest pose: however the phone is held now.
        r.neutralSeq++;
        show(slot, "action");
      } else if (progress - view.progress >= 0.05) setView(slot, { ...view, progress });
      continue;
    }

    // The action, rep by rep.
    if (t >= ACTION_TIMEOUT) {
      finish(slot);
      continue;
    }
    const fx = -Math.sin(r.facing);
    const fz = -Math.cos(r.facing);
    if (m.game === "pingpong") {
      // A forehand: the blade's forward speed rises past the rep minimum and falls back.
      const v = r.bladeVel.x * fx + r.bladeVel.z * fz;
      if (v >= REP_MIN.pingpong) m.swingPeak = Math.max(m.swingPeak, v);
      else if (m.swingPeak > 0 && v < SWING_END) {
        const peak = m.swingPeak;
        m.swingPeak = 0;
        rep(slot, peak, 0);
      }
      continue;
    }
    // Bowling and golf: hold the screen, swing, let go. The pace is the fastest
    // forward speed (the hand; golf, the putter head) just before letting go.
    let v: number;
    if (m.game === "golf") {
      scratch.set(0, -1, 0).applyQuaternion(r.handQuat).multiplyScalar(PUTTER_SHAFT).add(r.handPos);
      const dt = m.headAt ? (now - m.headAt) / 1000 : 0;
      v = dt > 0 ? ((scratch.x - m.head.x) * fx + (scratch.z - m.head.z) * fz) / dt : 0;
      m.head.copy(scratch);
      m.headAt = now;
    } else v = r.handVel.x * fx + r.handVel.z * fz;
    const grip = r.grip;
    if (grip) {
      m.history.push({ t: now, v });
      while (m.history.length && now - m.history[0].t > PACE_MS) m.history.shift();
    } else if (m.prevGrip) {
      rep(slot, m.history.reduce((a, h) => Math.max(a, h.v), 0), r.heading - m.baseline);
      m.history.length = 0;
    }
    m.prevGrip = grip;
  }
}
