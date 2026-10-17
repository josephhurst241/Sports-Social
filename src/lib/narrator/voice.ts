// How the narrator sounds. One small interface, so the browser's speech can
// later be swapped (or mixed) with recorded clips without touching the games.

export interface Voice {
  /** Speak `text` at `volume` (0 to 1); `onEnd` once it finishes or fails. */
  speak(text: string, volume: number, onEnd: () => void): void;
  stop(): void;
}

/** Natural-sounding voices where the device has them, best first; else any English voice. */
const PREFERRED = ["Google UK English Male", "Daniel", "Microsoft Ryan", "Microsoft Guy", "Google US English", "Samantha", "Microsoft Aria"];

/**
 * The browser's own speech (Web Speech API): free, no files, and it can say
 * any name. It sounds synthetic, and the voice differs by device. Null where
 * the browser has none.
 */
export function webSpeechVoice(): Voice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const synth = window.speechSynthesis;
  let voice: SpeechSynthesisVoice | null = null;
  // Voices load asynchronously in some browsers.
  const pick = () => {
    const all = synth.getVoices();
    voice = PREFERRED.map((n) => all.find((v) => v.name.includes(n))).find(Boolean) ?? all.find((v) => v.lang.startsWith("en")) ?? null;
  };
  pick();
  synth.addEventListener?.("voiceschanged", pick);

  let current: SpeechSynthesisUtterance | null = null;
  return {
    speak(text, volume, onEnd) {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? "en-US";
      u.rate = 1.08;
      u.pitch = 0.95;
      u.volume = volume;
      const finish = () => {
        if (current !== u) return;
        current = null;
        onEnd();
      };
      u.onend = finish;
      u.onerror = finish;
      current = u;
      synth.speak(u);
    },
    stop() {
      current = null;
      synth.cancel();
    },
  };
}
