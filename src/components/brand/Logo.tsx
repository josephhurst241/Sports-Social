import { useId } from "react";

// The Sports Social mark: a ping pong paddle and its ball, in glass. A solid
// face and a short flared handle in a lighter tone, tipped so the handle
// points down and left, with the ball up and to the right: simple equipment
// that reads as sport even at favicon size. Drawn in the theme's
// --accent-ink, so it follows each scene's color, with a glass layer: a soft
// sheen across the face, a thin bright edge, a light inner shadow. A band of
// light sweeps across (`sweep`, and on hover) and the ball catches a glint;
// globals.css has the keyframes.

/** The face (an upright oval), the handle below it, the ball; the paddle is drawn upright, then tilted. */
const FACE = { cx: 28, cy: 25, rx: 16.5, ry: 17.5 };
const HANDLE = "M24.5 40.5 L31.5 40.5 L33 55 Q28 58.5 23 55 Z";
const TILT = "rotate(32 28 34)";
const BALL = { cx: 52, cy: 11, r: 6.5 };

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
  /** Run the glint once now (the startup animation). */
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
            <ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} />
          </clipPath>
          <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.55 }} />
            <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
          </linearGradient>
          <radialGradient id={shade} cx="0.4" cy="0.25" r="0.9">
            <stop offset="0.6" style={{ stopColor: "#000000", stopOpacity: 0 }} />
            <stop offset="1" style={{ stopColor: "#000000", stopOpacity: 0.3 }} />
          </radialGradient>
          <linearGradient id={band} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
            <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        <g transform={TILT}>
          {/* Handle: lighter, like the wood under the rubber */}
          <path d={HANDLE} style={{ fill: "var(--accent-ink)", fillOpacity: 0.45 }} />
          <path d={HANDLE} fill="none" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.8} />
          {/* Face: solid, so it never reads as a lens */}
          <ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} style={{ fill: "var(--accent-ink)" }} />
          <g clipPath={`url(#${clip})`}>
            <rect x="0" y="0" width="64" height="64" fill={`url(#${shade})`} />
            <ellipse cx={FACE.cx - 3} cy={FACE.cy - 9} rx={12} ry={6.5} fill={`url(#${sheen})`} />
            <g className={`logo-sweep ${sweep ? "logo-sweep-run" : ""}`}>
              <rect x="-22" y="-8" width="15" height="80" transform="rotate(20 28 25)" fill={`url(#${band})`} />
            </g>
          </g>
          <ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx - 0.75} ry={FACE.ry - 0.75} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={1} />
        </g>

        {/* The ball: lighter glass, a bright point that glints */}
        <circle cx={BALL.cx} cy={BALL.cy} r={BALL.r} style={{ fill: "var(--accent-ink)", fillOpacity: 0.5 }} />
        <circle cx={BALL.cx} cy={BALL.cy} r={BALL.r - 0.6} fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.9} />
        <circle cx={BALL.cx - 2} cy={BALL.cy - 2.2} r={1.6} fill="#ffffff" fillOpacity={0.85} />
        <g className={`logo-glint ${sweep ? "logo-glint-run" : ""}`} style={{ transformOrigin: `${BALL.cx - 2}px ${BALL.cy - 2.2}px` }}>
          <path
            d={`M${BALL.cx - 2} ${BALL.cy - 9} L${BALL.cx - 1.2} ${BALL.cy - 3} L${BALL.cx + 5} ${BALL.cy - 2.2} L${BALL.cx - 1.2} ${BALL.cy - 1.4} L${BALL.cx - 2} ${BALL.cy + 4.6} L${BALL.cx - 2.8} ${BALL.cy - 1.4} L${BALL.cx - 9} ${BALL.cy - 2.2} L${BALL.cx - 2.8} ${BALL.cy - 3} Z`}
            fill="#ffffff"
          />
        </g>
      </svg>
      {wordmark && (
        <span className="text-[0.5em] leading-none font-semibold tracking-tight whitespace-nowrap text-ink">Sports Social</span>
      )}
    </span>
  );
}
