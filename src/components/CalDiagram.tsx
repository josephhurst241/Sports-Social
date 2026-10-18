import type { CalGame, CalStep } from "@/lib/game/calibration";

// How to hold the phone, and the action to do, for each game's calibration:
// simple line drawings in the theme's ink, shared by the phone and the
// laptop. While holding still the drawing is still; for the action it moves
// (globals.css, `.cal-*`), so it shows the motion to copy.

const INK = { stroke: "var(--accent-ink)" };
const SOFT = { stroke: "var(--accent-ink)", strokeOpacity: 0.35 };

/** The phone, upright: a rounded body and a lighter screen. */
function Phone({ x, y, w = 16, h = 30 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={3.5} style={{ fill: "var(--accent-ink)" }} />
      <rect x={x - w / 2 + 2} y={y - h / 2 + 3} width={w - 4} height={h - 6} rx={1.5} fill="#ffffff" fillOpacity={0.35} />
    </g>
  );
}

/** A curved arrow along an arc, for the motion to make. */
function Arc({ d, head }: { d: string; head: string }) {
  return (
    <g fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={SOFT}>
      <path d={d} strokeDasharray="4 5" />
      <path d={head} />
    </g>
  );
}

export default function CalDiagram({ game, step, size = 160 }: { game: CalGame; step: CalStep; size?: number }) {
  const moving = step === "action";
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 200 150" role="img" aria-label={`How to hold the phone for ${game}`} className="mx-auto">
      {game === "golf" && (
        <>
          {/* The ground, and the putter swinging from the hand */}
          <line x1="40" y1="134" x2="160" y2="134" strokeWidth={2} strokeLinecap="round" style={SOFT} />
          <g className={moving ? "cal-golf" : undefined}>
            <circle cx="100" cy="26" r="10" fill="none" strokeWidth={2.5} style={INK} />
            <Phone x={100} y={48} />
            <line x1="100" y1="63" x2="100" y2="124" strokeWidth={3} strokeLinecap="round" style={INK} />
            <rect x="88" y="123" width="26" height="8" rx="2" style={{ fill: "var(--accent-ink)" }} />
          </g>
          {moving && <Arc d="M62 120 Q100 146 138 120" head="M130 114 L138 120 L130 125" />}
        </>
      )}
      {game === "bowling" && (
        <>
          {/* The arm hangs from the shoulder, phone and ball in hand, and swings underhand */}
          <circle cx="100" cy="18" r="6" style={{ fill: "var(--accent-ink)" }} />
          <g className={moving ? "cal-bowling" : undefined}>
            <line x1="100" y1="18" x2="100" y2="92" strokeWidth={3.5} strokeLinecap="round" style={INK} />
            <Phone x={100} y={100} />
            <circle cx="100" cy="128" r="12" fill="none" strokeWidth={2.5} style={INK} />
          </g>
          {moving && <Arc d="M48 108 Q100 158 152 108" head="M145 100 L152 108 L144 113" />}
        </>
      )}
      {game === "pingpong" && (
        <>
          {/* Seen from above: the table ahead, the paddle swept across the body like a forehand */}
          <rect x="40" y="10" width="120" height="44" rx="4" fill="none" strokeWidth={2} style={SOFT} />
          <line x1="40" y1="32" x2="160" y2="32" strokeWidth={1.5} style={SOFT} />
          <g className={moving ? "cal-pingpong" : undefined}>
            <circle cx="100" cy="92" r="17" fill="none" strokeWidth={2.5} style={INK} />
            <Phone x={100} y={92} w={14} h={24} />
            <line x1="100" y1="109" x2="100" y2="130" strokeWidth={4} strokeLinecap="round" style={INK} />
          </g>
          {moving && <Arc d="M52 118 Q100 70 148 118" head="M141 110 L148 118 L139 121" />}
        </>
      )}
    </svg>
  );
}
