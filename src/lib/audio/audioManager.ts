import { useGameStore } from "@/store/gameStore";

// The laptop's sound effects, made in the browser (Web Audio) so there are no
// files to load: a plink when pointing at a game, a hollow thwack for a paddle
// or putter, a light lift for a serve toss, a rising arpeggio for a strike
// (or any big make), a two-note chime when the turn changes. Short and clean,
// sine and filtered noise only, mixed quiet under the scene.
//
// Browsers allow sound only after a click or key on the page (or for sites
// they trust). Until then every effect is silently dropped, never queued to
// play late; the first click or key anywhere unlocks it. Off with the
// laptop's Sound effects setting (`sound` in the store).

export type SoundEffect = "hit" | "serve" | "strike" | "turn" | "ui_hover";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
const lastAt: Partial<Record<SoundEffect, number>> = {};
/** The same effect again within this long is one sound (a hover flickering between islands, a doubled contact). */
const REPEAT_MS: Record<SoundEffect, number> = { hit: 60, serve: 300, strike: 800, turn: 600, ui_hover: 90 };

/** The shared audio context, if the browser lets the page make sound right now; otherwise null. */
export function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  try {
    ctx ??= new AudioContext();
  } catch {
    return null;
  }
  if (ctx.state !== "running") {
    if (navigator.userActivation?.isActive) void ctx.resume();
    else return null;
  }
  return ctx;
}

// Unlock on the first click or key, so effects work from then on.
if (typeof window !== "undefined") {
  const unlock = () => {
    if (audioContext()?.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/** The effects' shared output: a gentle compressor so stacked sounds never clip. */
function output(ac: AudioContext) {
  if (out?.context === ac) return out;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  comp.connect(ac.destination);
  out = ac.createGain();
  out.gain.value = 0.5;
  out.connect(comp);
  return out;
}

function noiseBuffer(ac: AudioContext) {
  if (noise && noise.sampleRate === ac.sampleRate) return noise;
  noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.25), ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** A sine that starts at `freq` (gliding to `to`) and dies away: the building block of every effect. */
function tone(ac: AudioContext, dest: AudioNode, t: number, freq: number, level: number, ring: number, to = freq) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + ring * 0.6);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  osc.connect(env).connect(dest);
  osc.start(t);
  osc.stop(t + ring + 0.05);
}

/** A burst of band-passed noise: the "crack" of contact. */
function burst(ac: AudioContext, dest: AudioNode, t: number, center: number, level: number, ring: number) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = center;
  band.Q.value = 1.4;
  const env = ac.createGain();
  env.gain.setValueAtTime(level, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  src.connect(band).connect(env).connect(dest);
  src.start(t);
  src.stop(t + ring + 0.02);
}

/** A bell note: the chime's partials (see brand/chime.ts), shorter. */
function bell(ac: AudioContext, dest: AudioNode, t: number, freq: number, level: number) {
  tone(ac, dest, t, freq, level, 0.55);
  tone(ac, dest, t, freq * 1.5, level * 0.35, 0.35);
  tone(ac, dest, t, freq * 0.5, level * 0.2, 0.5);
}

/**
 * Plays an effect now, if sound is on and the browser allows it. `strength`
 * (0..1) scales it: a soft touch or a hard hit, a spare or a strike.
 */
export function playSound(effect: SoundEffect, strength = 1) {
  if (!useGameStore.getState().sound) return;
  const now = performance.now();
  if (now - (lastAt[effect] ?? -Infinity) < REPEAT_MS[effect]) return;
  const ac = audioContext();
  if (!ac) return;
  lastAt[effect] = now;
  const s = Math.min(1, Math.max(0.15, strength));
  const dest = output(ac);
  const t = ac.currentTime + 0.005;
  switch (effect) {
    case "ui_hover":
      // A small glassy plink.
      tone(ac, dest, t, 1760, 0.12, 0.09);
      tone(ac, dest, t, 2640, 0.04, 0.05);
      break;
    case "hit":
      // A hollow thwack: a short crack over a body that drops in pitch.
      burst(ac, dest, t, 2200, 0.5 * s, 0.035);
      tone(ac, dest, t, 760, 0.55 * s, 0.09, 420);
      break;
    case "serve":
      // The toss: a light lift.
      tone(ac, dest, t, 520, 0.16, 0.14, 820);
      break;
    case "turn":
      // A two-note chime, up a fourth.
      bell(ac, dest, t, 1319, 0.18); // E6
      bell(ac, dest, t + 0.13, 1760, 0.2); // A6
      break;
    case "strike": {
      // A rising arpeggio: C6 E6 G6, and C7 when it is the full thing.
      const notes = s >= 0.9 ? [1047, 1319, 1568, 2093] : [1047, 1319, 1568];
      notes.forEach((f, i) => bell(ac, dest, t + i * 0.075, f, 0.2));
      break;
    }
  }
}
