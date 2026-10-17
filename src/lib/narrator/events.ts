// What the narrator can react to. Games only emit these (`narrate(...)`),
// from the one place each outcome is decided, never per frame; the narrator
// (narrator.ts) picks a line, paces it and speaks it. No audio code here.
//
// Names are resolved by the game when it emits ("Player 1", the CPU, or an
// account's name), so lines can use them as they are.

export type GameId = "pingpong" | "bowling" | "golf";

export type NarrationEvent =
  // Every game
  | { type: "matchStart"; game: GameId; players: string }
  /** `winner`: null for a tie; with `solo`, the one player (their score is the result). */
  | { type: "matchEnd"; game: GameId; winner: string | null; score: string; solo?: boolean }
  | { type: "join"; name: string }
  | { type: "leave"; name: string }
  | { type: "turn"; game: GameId; name: string }
  // Ping pong (one game to 11 is the match, so game point and match point are one call)
  | { type: "point"; name: string }
  | { type: "matchPoint"; name: string }
  | { type: "deuce" }
  | { type: "longRally"; name: string; hits: number }
  | { type: "ace"; name: string }
  | { type: "comeback"; name: string; from: number; score: string }
  // Bowling
  | { type: "strike"; name: string }
  | { type: "double"; name: string }
  | { type: "turkey"; name: string }
  | { type: "strikeStreak"; name: string; count: number }
  | { type: "spare"; name: string }
  | { type: "gutter"; name: string }
  | { type: "split"; name: string }
  | { type: "finalFrame"; name: string }
  // Golf
  | { type: "holeInOne"; name: string }
  | { type: "hole"; name: string; result: "eagle" | "birdie" | "par" | "bogey" | "over"; strokes: number }
  | { type: "longPutt"; name: string; meters: number; result: string }
  | { type: "lipOut"; name: string }
  | { type: "tooFast"; name: string }
  | { type: "lastHole" };

export type NarrationType = NarrationEvent["type"];

const listeners = new Set<(e: NarrationEvent) => void>();

/** Tell the narrator something happened. Safe to call with no narrator running. */
export function narrate(e: NarrationEvent) {
  for (const l of listeners) l(e);
}

export function onNarrate(listener: (e: NarrationEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
