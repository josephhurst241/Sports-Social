import type { NarrationEvent, NarrationType } from "./events.ts";

// What the narrator says. Several variants per event, each short (about two
// seconds spoken), with {fields} filled from the event. `priority` paces them
// (pacer.ts): 3 big moments interrupt, 2 normal, 1 small talk that is
// dropped when the narrator spoke recently. `ttl` is how long a line can wait
// its turn: short for reactions, longer for "you're up" lines, which stay
// true until the player acts.

export interface LineSet {
  priority: 1 | 2 | 3;
  /** Seconds before an unspoken line is stale and dropped. */
  ttl: number;
  lines: string[];
}

const GAME_NAMES = { pingpong: "ping pong", bowling: "bowling", golf: "golf" };

export const LINES: Record<NarrationType, LineSet> = {
  matchStart: {
    priority: 2,
    ttl: 4,
    lines: ["Welcome to {gameName}. {players}, you're on!", "{players}, it's {gameName} time.", "Let's play {gameName}. Good luck, {players}."],
  },
  matchEnd: {
    priority: 3,
    ttl: 6,
    lines: ["{winner} wins it, {score}!", "That's the match! {winner} takes it, {score}.", "Game over. {winner} wins, {score}!"],
  },
  join: { priority: 2, ttl: 3, lines: ["{name} has joined.", "Welcome in, {name}!", "{name} is here."] },
  leave: { priority: 2, ttl: 3, lines: ["{name} has left.", "We've lost {name}.", "{name} stepped out."] },
  turn: { priority: 2, ttl: 6, lines: ["{name}, you're up.", "Over to {name}.", "Your turn, {name}."] },

  point: { priority: 1, ttl: 2, lines: ["Point, {name}.", "{name} takes that one.", "Nicely done, {name}."] },
  matchPoint: { priority: 3, ttl: 3, lines: ["Match point, {name}!", "{name} is one away!", "Match point. Big moment for {name}."] },
  deuce: { priority: 2, ttl: 5, lines: ["Deuce!", "All square. Deuce!", "Deuce. Win by two!"] },
  longRally: { priority: 2, ttl: 3, lines: ["What a rally! {hits} shots, {name} wins it.", "{hits}-shot rally, and {name} takes it!", "Incredible rally! Point {name}."] },
  ace: { priority: 2, ttl: 3, lines: ["Ace! {name} serves it past.", "Untouchable serve from {name}!", "Ace for {name}!"] },
  comeback: {
    priority: 3,
    ttl: 6,
    lines: ["What a comeback! {name} was {from} down and wins it, {score}!", "From {from} points behind, {name} takes it!", "{name} completes the comeback, {score}!"],
  },

  strike: { priority: 3, ttl: 3, lines: ["Strike!", "Strike for {name}!", "All ten! Strike, {name}!"] },
  double: { priority: 3, ttl: 3, lines: ["Double! Back-to-back strikes for {name}.", "Two in a row, {name}!", "That's a double!"] },
  turkey: { priority: 3, ttl: 3, lines: ["Turkey! Three straight strikes!", "Three in a row! Turkey for {name}!", "{name} bags a turkey!"] },
  strikeStreak: { priority: 3, ttl: 3, lines: ["{count} strikes in a row! {name} is on fire!", "That's {count} straight, {name}!", "{count} in a row. Unstoppable!"] },
  spare: { priority: 2, ttl: 3, lines: ["Spare!", "Picked up the spare, {name}.", "Nice spare, {name}!"] },
  gutter: { priority: 2, ttl: 3, lines: ["Into the gutter.", "Gutter ball. Shake it off, {name}.", "Oh, gutter!"] },
  split: { priority: 2, ttl: 3, lines: ["Ooh, a split.", "Tough split for {name}.", "That's a split. Good luck!"] },
  finalFrame: { priority: 2, ttl: 6, lines: ["Final frame, {name}.", "Tenth frame. Make it count, {name}.", "Last frame for {name}."] },

  holeInOne: { priority: 3, ttl: 4, lines: ["Hole in one!", "Hole in one for {name}! Incredible!", "In with one stroke! Wow, {name}!"] },
  hole: { priority: 1, ttl: 3, lines: ["{Result} for {name}.", "{Result}, {name}.", "That's {aResult}, {name}."] },
  longPutt: { priority: 3, ttl: 4, lines: ["From {meters} meters! {result} for {name}!", "Sunk it from {meters} meters!", "What a putt, {name}! {meters} meters!"] },
  lipOut: { priority: 2, ttl: 2.5, lines: ["Lipped out!", "Oh, so close! It lipped out.", "Around the rim and out!"] },
  tooFast: { priority: 2, ttl: 2.5, lines: ["Too much pace!", "Hit it too hard, it hopped the cup.", "Way too fast, {name}."] },
  lastHole: { priority: 2, ttl: 6, lines: ["Last hole!", "Here's the final hole.", "One hole to go."] },
};

/** A golf hole's result as a noun ("over": two or more over par, said as its stroke count). */
function resultNoun(e: Extract<NarrationEvent, { type: "hole" }>) {
  return e.result === "over" ? `${e.strokes}-stroke hole` : e.result;
}

/** The {fields} of an event, as words. */
function fields(e: NarrationEvent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) out[k] = String(v);
  if ("game" in e) out.gameName = GAME_NAMES[e.game];
  if (e.type === "hole") {
    const noun = resultNoun(e);
    out.Result = noun[0].toUpperCase() + noun.slice(1);
    out.aResult = `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
  }
  if (e.type === "matchEnd" && e.winner === null) out.winner = "Nobody";
  return out;
}

/** Lines that would make no sense for this event (a tie has no winner). */
function usable(e: NarrationEvent, line: string) {
  if (e.type === "matchEnd" && e.winner === null) return !line.includes("{winner}");
  return true;
}

const TIE_LINES = ["It's a tie, {score}!", "All square at the end, {score}."];
const SOLO_LINES = ["That's the round! {winner}: {score}.", "All done. {winner} finishes with {score}.", "Final score for {winner}: {score}."];

/** How much a line matters (pacer.ts). A hole under par is news; par and worse are small talk. */
export function priorityOf(e: NarrationEvent): 1 | 2 | 3 {
  if (e.type === "hole" && (e.result === "birdie" || e.result === "eagle")) return 2;
  return LINES[e.type].priority;
}

/**
 * A line for the event, never the same variant twice in a row for that event.
 * `last` remembers the previous pick per event type; `random` is injectable for tests.
 */
export function pickLine(e: NarrationEvent, last: Map<string, number>, random = Math.random): string {
  const set =
    e.type === "matchEnd" && e.winner === null
      ? TIE_LINES
      : e.type === "matchEnd" && e.solo
        ? SOLO_LINES
        : LINES[e.type].lines.filter((l) => usable(e, l));
  // Variants are remembered per set, so a tie or solo ending does not count against the usual ones.
  const key = set === TIE_LINES ? "tie" : set === SOLO_LINES ? "solo" : e.type;
  const prev = last.get(key);
  const choices = set.map((_, i) => i).filter((i) => set.length === 1 || i !== prev);
  const i = choices[Math.floor(random() * choices.length)];
  last.set(key, i);
  const f = fields(e);
  return set[i].replace(/\{(\w+)\}/g, (_, k: string) => f[k] ?? "");
}
