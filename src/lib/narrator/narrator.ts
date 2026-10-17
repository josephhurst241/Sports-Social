import { useGameStore } from "@/store/gameStore";
import { onNarrate } from "./events";
import { LINES, pickLine, priorityOf } from "./lines";
import { Pacer, type Line } from "./pacer";
import { webSpeechVoice, type Voice } from "./voice";

// The narrator, on the laptop: hears game events (events.ts), picks a line
// (lines.ts), waits its turn (pacer.ts), shows it as a subtitle under the
// callout and speaks it. Browsers block speech until the page has been
// clicked or a key pressed, so the voice starts with the first one; until
// then (and while muted) lines still show as subtitles.

const SETTINGS_KEY = "sports-social-narrator";

/** What has been said, for the headless check: the line, and whether it was voiced. */
export const narratorState = {
  history: [] as { type: string; text: string; at: number; voiced: boolean }[],
  unlocked: false,
};

let voice: Voice | null = null;

/** Mute or set the volume; remembered for next time. */
export function setNarrator(change: Partial<{ muted: boolean; volume: number }>) {
  const narrator = { ...useGameStore.getState().narrator, ...change };
  useGameStore.setState({ narrator });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(narrator));
  } catch {}
  if (narrator.muted || narrator.volume === 0) voice?.stop();
}

/** Starts listening. Returns a cleanup. */
export function startNarrator() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (saved && typeof saved.muted === "boolean" && typeof saved.volume === "number") useGameStore.setState({ narrator: saved });
  } catch {}

  voice = webSpeechVoice();
  const pacer = new Pacer();
  const last = new Map<string, number>();
  const now = () => performance.now() / 1000;
  let fallback = 0;

  const finish = (line: Line) => {
    if (pacer.current !== line) return;
    clearTimeout(fallback);
    pacer.ended(line, now());
    // Leave the subtitle a moment, unless the next line replaced it.
    const shown = useGameStore.getState().subtitle;
    setTimeout(() => {
      if (useGameStore.getState().subtitle === shown) useGameStore.setState({ subtitle: null });
    }, 500);
  };

  const play = () => {
    const line = pacer.next(now());
    if (!line) return;
    const { muted, volume } = useGameStore.getState().narrator;
    const voiced = !!voice && narratorState.unlocked && !muted && volume > 0;
    useGameStore.setState({ subtitle: { text: line.text, at: performance.now() } });
    narratorState.history.push({ type: line.type, text: line.text, at: performance.now(), voiced });
    // About how long it takes to say: ends the line when there is no voice,
    // and backs up a voice that never reports finishing.
    const seconds = 0.5 + line.text.length / 14;
    fallback = window.setTimeout(() => finish(line), (voiced ? seconds * 1.4 + 0.6 : seconds) * 1000);
    if (voiced) voice!.speak(line.text, volume, () => finish(line));
  };

  const stopListening = onNarrate((e) => {
    const set = LINES[e.type];
    const line: Line = { type: e.type, text: pickLine(e, last), priority: priorityOf(e), at: now(), ttl: set.ttl };
    if (pacer.push(line, now()) === "interrupt") {
      clearTimeout(fallback);
      voice?.stop();
    }
    play();
  });
  const tick = window.setInterval(play, 100);

  // The first click or key lets the page speak.
  const unlock = () => {
    narratorState.unlocked = true;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  return () => {
    stopListening();
    clearInterval(tick);
    clearTimeout(fallback);
    voice?.stop();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}
