import { useId } from "react";

// The Sports Social mark: two glass discs meeting, two players (or two balls)
// with a lens where they overlap. Drawn in the theme's --accent-ink, so it
// follows each scene's color, with a glass layer over it: a soft sheen across
// the top, a thin bright edge, a light inner shadow at the bottom. The sheen
// can sweep across (`sweep`, and on hover); globals.css has the keyframes.
//
// Two plain circles at heart, so it still reads at favicon size.

/** Disc centers and radius in the 64 x 64 box. */
const DISCS = [
  { cx: 24, cy: 32 },
  { cx: 40, cy: 32 },
] as const;
const R = 17;

export default function Logo({
  size = 40,
  wordmark = false,
  sweep = false,
  className = "",
}: {
  /** Height of the mark, px. */
  size?: number;
  /** "Sports Social" beside the mark. */
  wordmark?: boolean;
  /** Run the sheen sweep once now (the startup animation). */
  sweep?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const clip = `${id}-clip`;
  const sheen = `${id}-sheen`;
  const shade = `${id}-shade`;
  const band = `${id}-band`;
  return (
    <span className={`logo inline-flex items-center gap-[0.35em] ${className}`} style={{ fontSize: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Sports Social" className="shrink-0 overflow-visible">
        <defs>
          <clipPath id={clip}>
            {DISCS.map((d) => (
              <circle key={d.cx} cx={d.cx} cy={d.cy} r={R} />
            ))}
          </clipPath>
          {/* Sheen: bright at the top, gone by the middle */}
          <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.75 }} />
            <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
          </linearGradient>
          {/* Inner shadow, low in the glass */}
          <radialGradient id={shade} cx="0.5" cy="0.15" r="0.95">
            <stop offset="0.6" style={{ stopColor: "#000000", stopOpacity: 0 }} />
            <stop offset="1" style={{ stopColor: "#000000", stopOpacity: 0.28 }} />
          </radialGradient>
          {/* The sweeping band of light */}
          <linearGradient id={band} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
            <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {/* The discs: the first solid, the second lighter glass, so the overlap reads as a deeper lens */}
        <circle cx={DISCS[0].cx} cy={DISCS[0].cy} r={R} style={{ fill: "var(--accent-ink)" }} />
        <circle cx={DISCS[1].cx} cy={DISCS[1].cy} r={R} style={{ fill: "var(--accent-ink)", fillOpacity: 0.55 }} />

        {/* Glass layer */}
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y="0" width="64" height="64" fill={`url(#${shade})`} />
          <ellipse cx="32" cy="22" rx="30" ry="12" fill={`url(#${sheen})`} />
          <g className={`logo-sweep ${sweep ? "logo-sweep-run" : ""}`}>
            <rect x="-20" y="-8" width="18" height="80" transform="rotate(20 32 32)" fill={`url(#${band})`} />
          </g>
        </g>
        {/* Thin bright edge, just inside each disc */}
        {DISCS.map((d) => (
          <circle key={d.cx} cx={d.cx} cy={d.cy} r={R - 0.75} fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={1} />
        ))}
      </svg>
      {wordmark && (
        <span className="text-[0.5em] leading-none font-semibold tracking-tight whitespace-nowrap text-ink">Sports Social</span>
      )}
    </span>
  );
}
