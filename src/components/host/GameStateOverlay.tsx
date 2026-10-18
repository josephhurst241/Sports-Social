"use client";

import { useEffect, useState } from "react";
import { useGameStore, type Announcement } from "@/store/gameStore";

/** How long each card stays up, its exit included (ms). */
const SHOW_MS = 2400;
/** The exit, at the end of SHOW_MS (ms): matches `.announce-out` in globals.css. */
const EXIT_MS = 260;

/**
 * The big card for a headline moment (announce() in the store): it springs
 * up into the middle of the laptop, holds, fades away, and the next one in
 * the queue follows. The card stays mounted through its exit, then leaves
 * the queue. On a panel like all text over the scene.
 */
export default function GameStateOverlay() {
  const head = useGameStore((s) => s.announcements[0] ?? null);
  const [shown, setShown] = useState<Announcement | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // The queue was cleared (a scene change): gone at once.
    if (!head) return setShown(null);
    setShown(head);
    setLeaving(false);
    const out = setTimeout(() => setLeaving(true), SHOW_MS - EXIT_MS);
    const done = setTimeout(() => {
      useGameStore.setState((s) => ({ announcements: s.announcements[0] === head ? s.announcements.slice(1) : s.announcements }));
    }, SHOW_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [head]);

  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8" aria-live="polite">
      <div
        key={shown.at}
        className={`panel max-w-[min(90vw,900px)] rounded-3xl px-12 py-8 text-center ${leaving ? "announce-out" : "announce-in"}`}
      >
        <div className="text-6xl leading-tight font-semibold tracking-tight text-ink">{shown.text}</div>
        {shown.detail && <div className="tabular mt-2 text-[22px] font-medium text-accent-ink">{shown.detail}</div>}
      </div>
    </div>
  );
}
