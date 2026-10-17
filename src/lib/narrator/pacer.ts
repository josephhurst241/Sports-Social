// When the narrator speaks: a small priority queue. One line at a time, a
// short silence between lines, big moments cut in over smaller ones, lines
// that waited too long are dropped, and small talk (priority 1) only when
// the narrator has been quiet a while, so it never chatters every point.
// Pure: the caller passes the time (seconds) and does the speaking.

/** Seconds of silence between two lines. */
export const MIN_GAP = 0.6;
/** Small talk only after this many seconds since the last line started. */
export const CHATTER_GAP = 8;
/** Lines waiting at most; the least important are dropped beyond it. */
export const QUEUE_MAX = 3;

export interface Line {
  type: string;
  text: string;
  priority: 1 | 2 | 3;
  /** When it was asked for, and how long it stays worth saying, seconds. */
  at: number;
  ttl: number;
}

export class Pacer {
  queue: Line[] = [];
  current: Line | null = null;
  lastStart = -Infinity;
  lastEnd = -Infinity;

  /**
   * A new line. "interrupt": it outranks the line being spoken, so stop that
   * and call next() now; "queued"; or "dropped".
   */
  push(line: Line, now: number): "interrupt" | "queued" | "dropped" {
    if (line.priority === 1 && (this.current || this.queue.length || now - this.lastStart < CHATTER_GAP)) return "dropped";
    if (this.current && line.priority > this.current.priority) {
      this.current = null;
      this.lastEnd = -Infinity; // no gap after a cut
      this.queue.unshift(line);
      return "interrupt";
    }
    this.queue.push(line);
    // Most important first, then oldest first; drop what does not fit.
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    const dropped = this.queue.splice(QUEUE_MAX);
    return dropped.includes(line) ? "dropped" : "queued";
  }

  /** The line to speak now, if the narrator is free and the gap has passed. */
  next(now: number): Line | null {
    if (this.current || now - this.lastEnd < MIN_GAP) return null;
    this.queue = this.queue.filter((l) => now - l.at <= l.ttl);
    const line = this.queue.shift() ?? null;
    if (line) {
      this.current = line;
      this.lastStart = now;
    }
    return line;
  }

  /** The line finished (or was cut short by the voice). */
  ended(line: Line, now: number) {
    if (this.current !== line) return;
    this.current = null;
    this.lastEnd = now;
  }
}
