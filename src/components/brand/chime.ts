// The logo's sound: a soft glass chime, made in the browser (Web Audio), so
// there is no file to load. Browsers allow sound only after a click or key on
// the page (or for sites they trust), so this plays when allowed and is
// otherwise silent; it never queues up to play late. It shares the sound
// effects' audio context (lib/audio/audioManager.ts).

import { audioContext } from "@/lib/audio/audioManager";

/** When it last played, so two triggers close together (a skip click and the glint) chime once. */
let lastAt = -Infinity;

/** Bell-like partials: frequency (Hz), loudness, how long it rings (s). */
const PARTIALS: [number, number, number][] = [
  [1568, 1, 0.9], // G6, the note
  [2349, 0.42, 0.6], // a fifth above, the glassy shimmer
  [3136, 0.16, 0.35], // a bright edge that dies fast
  [784, 0.22, 0.7], // a soft body an octave below
];

/** Plays the chime now if the browser allows sound. Returns whether it did. */
export function playChime(volume = 0.16) {
  if (performance.now() - lastAt < 1500) return false;
  // Still blocked (no click or key yet): stay silent rather than play later.
  const ctx = audioContext();
  if (!ctx) return false;
  lastAt = performance.now();
  const t = ctx.currentTime + 0.01;
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  for (const [freq, level, ring] of PARTIALS) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + ring + 0.05);
  }
  return true;
}
