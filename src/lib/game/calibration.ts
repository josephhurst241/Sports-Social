// Motion calibration, per game: the first time a player uses Motion in a
// game, they are shown how to hold the phone for it, hold still (their rest
// pose: the baseline everything is measured from), then do that game's real
// action (putt, bowl, swing the paddle) until it is consistent: at least
// three times, at most six. From that, for each player and game:
//
// - swing: their natural swing's peak speed becomes a medium shot;
// - aimZero: where they naturally point at release, measured from rest, is
//   subtracted from their aim from then on (so their "straight" is straight).
//
// Measured on the laptop from the player's own phone (calibrating.ts).
// Buttons mode and the CPU send ideal motions and are never calibrated.
// Pure: no browser, no store.

export type CalGame = "pingpong" | "bowling" | "golf";
export type CalStep = "hold" | "action" | "done";

/** What a player's natural swing in this game should become: a medium shot, m/s of the measured speed. */
export const TARGET_SWING: Record<CalGame, number> = {
  bowling: 1.45, // the hand: about a 6 m/s ball
  golf: 1.47, // the putter head: about a 2.5 m/s putt
  pingpong: 3.6, // the blade, forward: a mid-pace hit
};
/** The slowest action that counts as a rep, m/s (a twitch is not a swing). */
export const REP_MIN: Record<CalGame, number> = { bowling: 0.35, golf: 0.25, pingpong: 1.0 };
/** How far the multipliers may go, so a fumbled calibration never makes the game unplayable. */
export const SWING_LIMITS = [0.6, 2.2] as const;
/** The most a natural aim offset may correct, radians (about 20°). */
export const AIM_ZERO_MAX = 0.35;

/** Reps needed, at least; and where it stops waiting for them to agree. */
export const REPS_MIN = 3;
export const REPS_MAX = 6;
/** Reps agree when the last three vary by at most this much (standard deviation over mean). */
export const CONSISTENT = 0.3;
/** Seconds the rest pose is held. */
export const HOLD_SECONDS = 1.5;
/** Seconds the "all set" note stays. */
export const DONE_SECONDS = 2.5;

/** A player's calibration for one game. */
export interface GameCal {
  swing: number;
  aimZero: number;
}

/** Where a player's calibration is, for the laptop and their phone. */
export interface CalView {
  game: CalGame;
  step: CalStep;
  /** The step is shown and waits for the player to tap Ready before it measures. */
  waiting: boolean;
  /** 0 to 1 through the hold. */
  progress: number;
  /** Reps measured so far, and how many are still needed at least. */
  reps: number;
  needed: number;
  /** The result, once done. */
  result: GameCal | null;
}

/**
 * A player's own adjustment on top of calibration, from their phone's
 * Settings: Aim scales how far turning moves the aim, Swing the swing power.
 * Remembered on the phone, sent to the laptop on connecting and on change.
 */
export interface Sensitivity {
  aim: number;
  swing: number;
}
export const SENSITIVITY_LIMITS = [0.5, 2] as const;
export const NEUTRAL_SENSITIVITY: Sensitivity = { aim: 1, swing: 1 };

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** A sensitivity from another device: a number, within the limits (1 if not). */
export function cleanSensitivity(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, SENSITIVITY_LIMITS) : 1;
}

/** The value `share` of the way up the sorted samples (0.5: the median). */
export function percentile(samples: number[], share: number) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))))];
}

/** Whether the reps so far are enough: at least three, and the last three agree (or it has had its six). */
export function repsDone(peaks: number[]) {
  if (peaks.length >= REPS_MAX) return true;
  if (peaks.length < REPS_MIN) return false;
  const last = peaks.slice(-REPS_MIN);
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  const sd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / last.length);
  return mean > 0 && sd / mean <= CONSISTENT;
}

/** Backward swings in a row that mean the phone's compass zero faces away from the laptop. */
export const BACKWARD_REPS = 2;

/**
 * Which way a held swing (bowling, golf) went through: +1 forward, -1
 * backward, 0 too small to tell (fastest under `min`, m/s). The through-swing
 * always comes after the backswing, so it is the sign of the last sample at
 * least half as fast as the fastest either way, not of the faster one: a
 * gentle putt's backswing is often as fast as its stroke. -1 means the
 * world frame is turned around (the compass zero was taken from the phone's
 * other face), so forward swings play backward.
 */
export function swingDirection(speeds: number[], min: number) {
  const top = speeds.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  if (top < min) return 0;
  for (let i = speeds.length - 1; i >= 0; i--) if (Math.abs(speeds[i]) >= top / 2) return Math.sign(speeds[i]);
  return 0;
}

/**
 * swingDirection for golf, where the grip is often held past the stroke: the
 * putter swinging back toward rest, a second practice stroke, or the hand
 * easing back after the push can be the last strong motion. Backward only
 * when the last strong motion and the fastest one both are.
 */
export function puttDirection(speeds: number[], min: number) {
  const last = swingDirection(speeds, min);
  if (last >= 0) return last;
  const fastest = speeds.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0);
  return fastest < 0 ? -1 : 1;
}

/**
 * The calibration from the reps: the median of the last three swings sets
 * the swing scale, and the median of where they pointed at release (radians
 * from rest, + left) the aim zero. Medians, so one odd rep cannot skew it.
 */
export function gameCal(game: CalGame, peaks: number[], releaseAims: number[]): GameCal {
  const last = peaks.slice(-REPS_MIN);
  const swing = last.length ? clamp(TARGET_SWING[game] / percentile(last, 0.5), SWING_LIMITS) : 1;
  const aims = releaseAims.slice(-REPS_MIN);
  const aimZero = game === "pingpong" || !aims.length ? 0 : clamp(percentile(aims, 0.5), [-AIM_ZERO_MAX, AIM_ZERO_MAX]);
  return { swing, aimZero };
}

/** What each game's calibration asks, for the phone and the laptop. */
export const CAL_TEXT: Record<CalGame, Record<CalStep, { title: string; hint: string }>> = {
  golf: {
    hold: { title: "Hold it like a putter", hint: "Phone upright in your hands, screen toward the laptop, arms relaxed. Hold still." },
    action: { title: "Putt, three times", hint: "Hold the screen, swing back and through like a putt, let go." },
    done: { title: "All set", hint: "Your putting is tuned to you." },
  },
  bowling: {
    hold: { title: "Hold it like the ball", hint: "Phone in your hand, screen toward you, arm hanging. Hold still." },
    action: { title: "Bowl, three times", hint: "Hold the screen, swing your arm back and forward underhand, let go." },
    done: { title: "All set", hint: "Your bowling is tuned to you." },
  },
  pingpong: {
    hold: { title: "Hold it like a paddle", hint: "Screen facing the table, phone upright like a bat. Hold still." },
    action: { title: "Swing, three times", hint: "Swing across your body like a forehand, then back to ready." },
    done: { title: "All set", hint: "Your swing is tuned to you." },
  },
};
