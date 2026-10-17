"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Logo from "@/components/brand/Logo";
import Splash from "@/components/brand/Splash";
import { exitToHub } from "@/lib/game/scenes";
import { SCENE_INKS, themeVars } from "@/lib/game/theme";
import { scorecard, totalScore } from "@/lib/games/bowling";
import { HOLES, PAR } from "@/lib/games/golf";
import { POINTS_TO_WIN } from "@/lib/games/pingpong";
import { startHost } from "@/lib/net/host";
import { setNarrator, startNarrator } from "@/lib/narrator/narrator";
import { ISLANDS } from "@/lib/hub/islands";
import { BOARDS, HUB_BOARD, loadLeaderboard, type Board, type RankRow } from "@/lib/account/leaderboard";
import { supabase } from "@/lib/account/account";
import { PLAYER_COLORS, type PlayerSlot } from "@/lib/net/protocol";
import { requestRecenter, useGameStore, usePlayerName } from "@/store/gameStore";

/** Where the laptop remembers the glass look between visits. */
const GLASS_KEY = "sports-social-glass";

// The 3D scene touches WebGL and window, so it never renders on the server.
const Stage = dynamic(() => import("@/components/three/Stage"), { ssr: false });

function useJoinUrl(lanIp: string | null, code: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!code) return setUrl(null);
    const { protocol, hostname, port } = window.location;
    // The laptop usually opens localhost; the phone needs the LAN address.
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const host = local && lanIp ? lanIp : hostname;
    setUrl(`${protocol}//${host}${port ? `:${port}` : ""}/play?code=${code}`);
  }, [lanIp, code]);
  return url;
}

function useQrSvg(text: string | null) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return setSvg(null);
    let live = true;
    QRCode.toString(text, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#0b0b0fff", light: "#ffffff00" },
    }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [text]);
  return svg;
}

/** Packets per second for one slot, sampled once a second (not per packet). */
function usePacketRate(slot: PlayerSlot) {
  const [rate, setRate] = useState(0);
  useEffect(() => {
    const t = useGameStore.getState().telemetry[slot];
    t.count = 0;
    const id = setInterval(() => {
      setRate(t.count);
      t.count = 0;
    }, 1000);
    return () => clearInterval(id);
  }, [slot]);
  return rate;
}

/** A player's color dot. The neon colors get a hairline so they hold up on white. */
function Dot({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]" style={{ background: color }} />;
}

function PlayerChip({ slot }: { slot: PlayerSlot }) {
  const connected = useGameStore((s) => s.players[slot].connected);
  const name = usePlayerName(slot);
  const rate = usePacketRate(slot);
  return (
    <div className="panel flex items-center gap-3 rounded-full py-2.5 pr-5 pl-3.5">
      <Dot color={connected ? PLAYER_COLORS[slot] : "#d1d1d6"} />
      <span className="max-w-[12em] truncate text-[15px] font-semibold">{name}</span>
      <span className="tabular text-[13px] text-ink-3">{connected ? `${rate} Hz` : "Waiting"}</span>
    </div>
  );
}

function QR({ svg, size }: { svg: string | null; size: string }) {
  return (
    <div
      className={`${size} shrink-0 rounded-2xl bg-white p-3 [&_svg]:h-full [&_svg]:w-full`}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

/**
 * The handshake: a massive room code and a QR, nothing else. It sits over the
 * middle of the hub, so it is nearly opaque: avatars and icons behind it do
 * not show through the code.
 */
function Handshake({ code, url, status, error }: { code: string | null; url: string | null; status: string; error: string | null }) {
  const svg = useQrSvg(url);
  return (
    <div
      className="panel w-[min(92vw,820px)] rounded-[40px] px-14 py-12"
      style={{ background: "color-mix(in oklab, var(--wash) 30%, rgb(255 255 255 / 0.92))" }}
    >
      <Logo size={44} wordmark className="mb-8" />
      <div className="text-[15px] font-semibold text-accent-ink">Room code</div>
      <div className="mt-2 flex items-center justify-between gap-12">
        <div className="tabular text-[168px] leading-[0.9] font-semibold tracking-[-0.05em] text-ink">
          {code ?? "····"}
        </div>
        <QR svg={svg} size="h-52 w-52" />
      </div>
      <p className="mt-10 max-w-[34ch] text-[19px] leading-snug text-ink-2">
        {error ?? (code ? "Scan with your phone, then tap Connect Controller." : status)}
      </p>
      {url && <div className="mt-2 font-mono text-[13px] text-ink-3">{url}</div>}
    </div>
  );
}

function RoomBadge({ code, url }: { code: string; url: string | null }) {
  const svg = useQrSvg(url);
  return (
    <div className="panel flex items-center gap-4 rounded-3xl p-2.5 pr-5">
      <QR svg={svg} size="h-14 w-14 rounded-xl p-1.5" />
      <div>
        <div className="text-[12px] font-semibold text-accent-ink">Room</div>
        <div className="tabular text-[26px] leading-none font-semibold tracking-tight">{code}</div>
      </div>
    </div>
  );
}

/** Leaderboards already fetched, per board, so pointing back and forth does not refetch. */
const boardCache = new Map<string, { at: number; week: RankRow[]; all: RankRow[]; error: string | null }>();
const BOARD_FRESH_MS = 60_000;

/**
 * The hub's leaderboard: whichever game is pointed at or selected, this
 * week's and all-time top three side by side, with the players here marked in
 * their color. It sits in the sky under the brand, clear of the islands, and
 * only when accounts are set up (no board without Supabase keys).
 */
function HubLeaderboard() {
  const game = useGameStore((s) => s.selected ?? s.hovered[0] ?? s.hovered[1]);
  // Two selectors, not one returning a fresh array (that would re-render forever).
  const id0 = useGameStore((s) => s.players[0].account?.id ?? null);
  const id1 = useGameStore((s) => s.players[1].account?.id ?? null);
  const ids = [id0, id1];
  const [, redraw] = useState(0);
  const board: Board | null = game ? HUB_BOARD[game] : null;
  useEffect(() => {
    if (!board || !supabase()) return;
    const hit = boardCache.get(board);
    if (hit && performance.now() - hit.at < BOARD_FRESH_MS) return;
    Promise.all([loadLeaderboard(board, "week", 3), loadLeaderboard(board, "all", 3)]).then(([week, all]) => {
      boardCache.set(board, { at: performance.now(), week: week.rows, all: all.rows, error: week.error ?? all.error });
      redraw((n) => n + 1);
    });
  }, [board]);
  if (!board || !supabase()) return null;
  const data = boardCache.get(board);
  const info = BOARDS[board];
  const section = (title: string, rows: RankRow[]) => (
    <div className="min-w-0">
      <div className="text-[12px] font-semibold text-accent-ink">{title}</div>
      {rows.length === 0 ? (
        <div className="mt-1 text-[13px] text-ink-3">Nobody yet</div>
      ) : (
        <ol className="mt-1">
          {rows.map((r) => {
            const here = ids.indexOf(r.user_id);
            return (
              <li key={r.user_id} className={`flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-[13px] ${here >= 0 ? "bg-accent/25 font-semibold" : ""}`}>
                <span className="tabular w-4 text-right text-ink-3">{r.rank}</span>
                {here >= 0 && <Dot color={PLAYER_COLORS[here]} />}
                <span className="flex-1 truncate">{r.name}</span>
                <span className="tabular font-semibold">{info.format(r.value)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
  return (
    <div className="panel w-[25rem] rounded-3xl px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[15px] font-semibold tracking-tight">
          {info.title} <span className="font-normal text-ink-2">· {info.measure}</span>
        </div>
        <div className="text-[11px] whitespace-nowrap text-ink-3">Sign in on your phone to be ranked</div>
      </div>
      {!data ? (
        <div className="mt-2 text-[13px] text-ink-3">Loading…</div>
      ) : data.error ? (
        <div className="mt-2 text-[13px] text-ink-3">Leaderboard unavailable</div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-4">
          {section("This week", data.week)}
          {section("All time", data.all)}
        </div>
      )}
    </div>
  );
}

/** The game a player tapped in the hub, named in that game's color; a second tap starts it. */
function Selection() {
  const selected = useGameStore((s) => s.selected);
  const island = ISLANDS.find((i) => i.id === selected);
  return (
    <div
      className="panel rounded-3xl px-8 py-5 text-center transition-all duration-300"
      style={{ opacity: island ? 1 : 0, transform: island ? "none" : "translateY(8px)" }}
    >
      <div className="text-[13px] font-semibold text-accent-ink">Selected</div>
      <div
        className="mt-0.5 text-[28px] leading-tight font-semibold tracking-tight transition-colors duration-300"
        style={{ color: island ? SCENE_INKS[island.id] : undefined }}
      >
        {island?.name ?? " "}
      </div>
      <div className="mt-1 text-[15px] text-ink-2">Tap again to play.</div>
    </div>
  );
}

/**
 * The latest point, roll or stroke for a moment, and under it the narrator's
 * line as a subtitle. Inverted, so it reads apart from the HUD above it.
 */
function Callout() {
  const callout = useGameStore((s) => s.callout);
  const subtitle = useGameStore((s) => s.subtitle);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!callout) return setFresh(false);
    setFresh(true);
    const id = setTimeout(() => setFresh(false), 1800);
    return () => clearTimeout(id);
  }, [callout]);
  const text = fresh ? callout?.text : undefined;
  // The narrator often says just what the callout shows ("Strike!"): no need to repeat it.
  const sub = subtitle && subtitle.text !== text ? subtitle.text : undefined;
  const visible = !!(text || sub);
  // Keep the last words on the panel while it fades out.
  const [kept, setKept] = useState<{ text?: string; sub?: string }>({});
  useEffect(() => {
    if (text || sub) setKept({ text, sub });
  }, [text, sub]);
  const show = visible ? { text, sub } : kept;
  return (
    <div
      className="panel-ink max-w-[min(90vw,680px)] rounded-[26px] px-7 py-3 text-center transition-all duration-300"
      style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(-6px)" }}
    >
      {show.text && <div className="text-[22px] font-semibold tracking-tight">{show.text}</div>}
      {show.sub && <div className={show.text ? "mt-0.5 text-[15px] text-white/80" : "text-[17px] font-medium"}>{show.sub}</div>}
      {!show.text && !show.sub && " "}
    </div>
  );
}

/** The narrator's mute and volume (N mutes too). */
function NarratorControl() {
  const { muted, volume } = useGameStore((s) => s.narrator);
  const off = muted || volume === 0;
  return (
    <div className="panel pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5">
      <button
        onClick={() => setNarrator({ muted: !muted })}
        aria-label={off ? "Unmute the narrator" : "Mute the narrator"}
        title="Narrator (N)"
        className="flex h-8 w-8 items-center justify-center rounded-full text-accent-ink hover:bg-accent/20"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
          {off ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        disabled={muted}
        onChange={(e) => setNarrator({ volume: Number(e.target.value) })}
        aria-label="Narrator volume"
        className="w-24 accent-[var(--accent-ink)] disabled:opacity-40"
      />
    </div>
  );
}

function PingPongHud() {
  const { score, rally, cpu } = useGameStore((s) => s.pingpong);
  const [p1, p2] = [usePlayerName(0), usePlayerName(1)];
  return (
    <div className="panel flex items-center gap-7 rounded-full px-7 py-3">
      <Side color={PLAYER_COLORS[0]} name={p1} points={score[0]} />
      <div className="text-center">
        <div className="text-[12px] font-semibold text-accent-ink">First to {POINTS_TO_WIN}</div>
        <div className="tabular text-[13px] text-ink-2">Rally {rally}</div>
      </div>
      <Side color={cpu ? "#ff7ae0" : PLAYER_COLORS[1]} name={cpu ? "CPU" : p2} points={score[1]} right />
    </div>
  );
}

function Side({ color, name, points, right }: { color: string; name: string; points: number; right?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <Dot color={color} />
      <span className="text-[15px] font-semibold">{name}</span>
      <span className="tabular text-[30px] leading-none font-semibold">{points}</span>
    </div>
  );
}

/** One bowler's line on the scorecard; the frame being bowled is highlighted on the active line. */
function BowlingRow({ slot, rolls, active, named, header }: { slot: PlayerSlot; rolls: number[]; active: boolean; named: boolean; header: boolean }) {
  const name = usePlayerName(slot);
  const card = scorecard(rolls);
  // The frame being bowled: the first empty one, or the one with a ball still to come.
  const empty = card.findIndex((f) => f.marks.length === 0);
  let current = empty < 0 ? 9 : empty;
  if (current > 0 && card[current - 1].marks.length === 1 && card[current - 1].marks[0] !== "X") current--;
  if (!active) current = -1;
  return (
    // The waiting bowler's line steps back so the active one leads.
    <div className={`flex items-stretch transition-opacity duration-300 ${named && !active ? "opacity-50" : ""}`}>
      {named && (
        <div className="flex w-[100px] items-center gap-2 pl-2">
          <Dot color={PLAYER_COLORS[slot]} />
          <span className="truncate text-[13px] font-semibold">{name}</span>
        </div>
      )}
      {card.map((f, i) => (
        <div
          key={i}
          className={`w-[56px] rounded-xl px-1 py-1 text-center transition-colors duration-300 ${i === current ? "bg-accent/25" : ""}`}
        >
          {header && <div className={`text-[11px] font-semibold ${i === current ? "text-accent-ink" : "text-ink-3"}`}>{i + 1}</div>}
          <div className="tabular mt-0.5 h-5 text-[15px] font-semibold tracking-wider">{f.marks.join(" ")}</div>
          <div className="tabular h-[18px] text-[13px] text-ink-2">{f.total ?? ""}</div>
        </div>
      ))}
      <div className="ml-1 flex w-[70px] flex-col justify-center border-l border-accent-ink/15 px-1 py-1 text-center">
        {header && <div className="text-[11px] font-semibold text-accent-ink">Total</div>}
        <div className="tabular mt-1 text-[24px] leading-none font-semibold">{totalScore(rolls)}</div>
      </div>
    </div>
  );
}

function BowlingHud() {
  const { rolls, turn, players, over } = useGameStore((s) => s.bowling);
  const slots: PlayerSlot[] = players === 2 ? [0, 1] : [turn];
  return (
    <div className="panel flex flex-col rounded-2xl p-1.5">
      {slots.map((slot, i) => (
        <BowlingRow key={slot} slot={slot} rolls={rolls[slot]} active={!over && slot === turn} named={players === 2} header={i === 0} />
      ))}
    </div>
  );
}

function GolfHud() {
  const { hole, turn, players, strokes, cards, over } = useGameStore((s) => s.golf);
  const turnName = usePlayerName(turn);
  const h = HOLES[Math.min(hole, HOLES.length - 1)];
  const slots: PlayerSlot[] = players === 2 ? [0, 1] : [turn];
  return (
    <div className="panel flex items-center gap-8 rounded-[28px] px-7 py-3">
      <div>
        <div className="text-[12px] font-semibold text-accent-ink">
          Hole {Math.min(hole, HOLES.length - 1) + 1} of {HOLES.length} · Par {h.par}
        </div>
        <div className="text-[17px] font-semibold">{over ? "Round complete" : h.name}</div>
      </div>
      <div className="text-center">
        <div className="text-[12px] font-semibold text-accent-ink">{players === 2 && !over ? `${turnName} · Strokes` : "Strokes"}</div>
        <div className="tabular text-[28px] leading-none font-semibold">{over ? "–" : strokes}</div>
      </div>
      <div>
        <div className="text-[12px] font-semibold text-accent-ink">Card · Par {PAR}</div>
        {slots.map((slot) => {
          const card = cards[slot];
          return (
            <div
              key={slot}
              className={`tabular flex items-center gap-2 text-[17px] font-semibold transition-opacity duration-300 ${players === 2 && slot !== turn && !over ? "opacity-50" : ""}`}
            >
              {players === 2 && <Dot color={PLAYER_COLORS[slot]} />}
              {card.length ? card.join("  ") : "–"}
              {card.length > 0 && <span className="text-ink-3">= {card.reduce((a, b) => a + b, 0)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BUTTON_HINTS: Record<string, [string, string]> = {
  hub: ["On the phone: ‹ › to aim at a game, Select to choose, Select again to play.", "Switch the phone to Motion any time."],
  pingpong: ["Hold Swing to wind up, let go to swing. The first press serves.", "‹ Hub on the phone, or Esc, goes back to the hub."],
  bowling: ["‹ › to aim. Hold Bowl to wind up (longer is faster), let go to bowl.", "‹ Hub on the phone, or Esc, goes back to the hub."],
  golf: ["‹ › to aim. Hold Putt to wind up (longer is further), let go to putt.", "‹ Hub on the phone, or Esc, goes back to the hub."],
};

const HINTS: Record<string, [string, string]> = {
  hub: ["Point the top of your phone at a game. Tap to select, tap again to play.", "Hold it upright to rest. R or a two-finger tap recenters. G switches the glass. N mutes the narrator."],
  pingpong: ["Hold the phone like a paddle, screen facing the table. Swing to hit, tap to serve.", "Esc or a three-finger tap: back to the hub."],
  bowling: ["Hold the screen to pick up the ball, swing underhand, let go to bowl. Turn the phone to angle it.", "Esc or a three-finger tap: back to the hub."],
  golf: ["Hold the phone upright like a putter grip. Hold the screen, swing, let go to putt. Turn it to aim.", "Esc or a three-finger tap: back to the hub."],
};

export default function HostScreen({ lanIp }: { lanIp: string | null }) {
  const hostStatus = useGameStore((s) => s.hostStatus);
  const hostError = useGameStore((s) => s.hostError);
  const code = useGameStore((s) => s.roomCode);
  const scene = useGameStore((s) => s.scene);
  const anyone = useGameStore((s) => s.players[0].connected || s.players[1].connected);
  const url = useJoinUrl(lanIp, code);

  // One host per page load. The cancelled flag covers an unmount that lands
  // before the broker answers, so a remount can never leave two rooms open.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    startHost().then((stop) => {
      if (cancelled) stop();
      else cleanup = stop;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // The narrator: listens for game events for as long as the page is open.
  useEffect(() => startNarrator(), []);

  // R recenters every phone's heading; Esc leaves a game; G switches the glass look; N mutes the narrator.
  useEffect(() => {
    const saved = localStorage.getItem(GLASS_KEY);
    if (saved === "classic" || saved === "liquid") useGameStore.setState({ glassStyle: saved });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR") {
        requestRecenter(0);
        requestRecenter(1);
      } else if (e.code === "Escape") {
        exitToHub();
      } else if (e.code === "KeyN") {
        setNarrator({ muted: !useGameStore.getState().narrator.muted });
      } else if (e.code === "KeyG") {
        const glassStyle = useGameStore.getState().glassStyle === "liquid" ? "classic" : "liquid";
        useGameStore.setState({ glassStyle });
        localStorage.setItem(GLASS_KEY, glassStyle);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const buttonsMode = useGameStore((s) => s.inputModes[0] === "buttons");
  const [hint, hint2] = (buttonsMode ? BUTTON_HINTS : HINTS)[scene];
  return (
    <main className="themed fixed inset-0 overflow-hidden bg-white select-none" style={themeVars(scene)}>
      <div className="absolute inset-0">
        <Stage />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-8">
        {/* The brand, on a panel like all text over the scene; the handshake card carries it while that is up */}
        {anyone || scene !== "hub" ? (
          <div className="panel rounded-full py-1.5 pr-4 pl-2">
            <Logo size={34} wordmark />
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-col items-center gap-3">
          {anyone && scene === "hub" && <Selection />}
          {scene === "pingpong" && <PingPongHud />}
          {scene === "bowling" && <BowlingHud />}
          {scene === "golf" && <GolfHud />}
          <Callout />
          {/* Stacked under the callout, not pinned over it */}
          {!anyone && scene !== "hub" && (
            <div className="panel rounded-full px-6 py-3 text-[15px] text-ink-2">
              No phone connected. Rejoin with room code <span className="font-semibold text-ink">{code}</span>
            </div>
          )}
        </div>
        {anyone && code ? <RoomBadge code={code} url={url} /> : <div />}
      </header>

      {!anyone && scene === "hub" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Handshake
            code={code}
            url={url}
            status={hostStatus === "opening" ? "Opening a room…" : ""}
            error={hostStatus === "error" ? hostError : null}
          />
        </div>
      )}

      {anyone && scene === "hub" && (
        <div className="pointer-events-none absolute top-28 left-8">
          <HubLeaderboard />
        </div>
      )}

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-8">
        <div className="flex gap-3">
          <PlayerChip slot={0} />
          <PlayerChip slot={1} />
          <NarratorControl />
        </div>
        {/* On a panel, not bare: the fogged floor and glass behind would wash out loose grey text. */}
        {anyone && (
          <div className="panel max-w-[48ch] rounded-2xl px-4 py-3 text-right text-[13px] leading-relaxed">
            <span className="text-ink-2">{hint}</span>
            <br />
            <span className="text-ink-3">{hint2}</span>
          </div>
        )}
      </footer>

      <Splash variant="host" />
    </main>
  );
}
