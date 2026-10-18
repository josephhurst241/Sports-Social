"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Logo from "@/components/brand/Logo";
import Splash from "@/components/brand/Splash";
import GameStateOverlay from "@/components/host/GameStateOverlay";
import { exitToHub } from "@/lib/game/scenes";
import { SCENE_INKS, themeVars } from "@/lib/game/theme";
import { scorecard, totalScore } from "@/lib/games/bowling";
import { HOLES, PAR } from "@/lib/games/golf";
import { POINTS_TO_WIN } from "@/lib/games/pingpong";
import { startHost } from "@/lib/net/host";
import { startCalibration } from "@/lib/game/calibrating";
import CalDiagram from "@/components/CalDiagram";
import { CAL_TEXT, REPS_MIN } from "@/lib/game/calibration";
import { ISLANDS } from "@/lib/hub/islands";
import { PLAYER_COLORS, type PlayerSlot } from "@/lib/net/protocol";
import { requestRecenter, useGameStore, usePlayerName, useSplit } from "@/store/gameStore";

/** Where the laptop remembers the glass look between visits. */
const GLASS_KEY = "sports-social-glass";
/** Where the laptop remembers whether sound effects are on. */
const SOUND_KEY = "sports-social-sound";

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
  const { games, wins } = useGameStore((s) => s.session[slot]);
  // This session's record once they have finished a game; until then the connection rate.
  const detail = !connected ? "Waiting" : games ? `${games} played · ${wins} won` : `${rate} Hz`;
  return (
    <div className="panel flex items-center gap-3 rounded-full py-2.5 pr-5 pl-3.5">
      <Dot color={connected ? PLAYER_COLORS[slot] : "#d1d1d6"} />
      <span className="max-w-[12em] truncate text-[15px] font-semibold">{name}</span>
      <span className="tabular text-[13px] text-ink-3">{detail}</span>
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

/**
 * The room code once someone has joined, small in the corner. Hover (or tab
 * to) it and it springs to 1.5x from its corner, so a second player can scan
 * the QR or read the code from the couch.
 */
function RoomBadge({ code, url }: { code: string; url: string | null }) {
  const svg = useQrSvg(url);
  return (
    <div
      tabIndex={0}
      aria-label={`Room code ${code}`}
      className="panel pointer-events-auto relative flex origin-top-right items-center gap-4 rounded-3xl p-2.5 pr-5 outline-none transition-transform duration-560 ease-spring hover:z-10 hover:scale-150 focus-visible:z-10 focus-visible:scale-150 motion-reduce:transition-none"
    >
      <QR svg={svg} size="h-14 w-14 rounded-xl p-1.5" />
      <div>
        <div className="text-[12px] font-semibold text-accent-ink">Room</div>
        <div className="tabular text-[26px] leading-none font-semibold tracking-tight">{code}</div>
      </div>
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
 * The latest point, roll or stroke for a moment. Inverted, so it reads apart
 * from the HUD above it. A make gives it a little pop, a miss a small shake.
 */
function Callout() {
  const callout = useGameStore((s) => s.callout);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!callout) return setVisible(false);
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(id);
  }, [callout]);
  return (
    <div
      className="panel-ink max-w-[min(90vw,680px)] rounded-full px-7 py-3 text-center text-[22px] font-semibold tracking-tight transition-all duration-300"
      style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(-6px)" }}
    >
      <div key={callout?.at} className={callout?.kind === "make" ? "callout-make" : callout?.kind === "miss" ? "callout-miss" : undefined}>
        {callout?.text ?? "\u00a0"}
      </div>
    </div>
  );
}

/** Switches the glass look and remembers it (G does the same). */
function setGlass(glassStyle: "classic" | "liquid") {
  useGameStore.setState({ glassStyle });
  try {
    localStorage.setItem(GLASS_KEY, glassStyle);
  } catch {}
}

/** Split-screen ping pong: a hairline between the halves, and whose view each half is. */
function SplitOverlay() {
  const cpu = useGameStore((s) => s.pingpong.cpu);
  const [n0, p2] = [usePlayerName(0), usePlayerName(1)];
  const n1 = cpu ? "CPU" : p2;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/70 shadow-[0_0_0_1px_rgb(0_0_0/0.05)]" />
      {([n0, n1] as const).map((name, i) => (
        <div key={i} className={`absolute top-1/2 ${i === 0 ? "left-6" : "right-6"}`}>
          <div className="panel flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 text-[13px] font-semibold">
            <Dot color={PLAYER_COLORS[i]} />
            {name}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Turns sound effects on or off and remembers it. */
function setSound(sound: boolean) {
  useGameStore.setState({ sound });
  try {
    localStorage.setItem(SOUND_KEY, sound ? "on" : "off");
  } catch {}
}

/** A two-option switch in the settings panel. */
function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-black/[0.06] p-0.5 text-[13px] font-semibold">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-full px-3 py-1 ${value === v ? "bg-white text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.06)]" : "text-ink-2"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The laptop's settings, behind the gear: sound, the glass look (G does the
 * same), and calibrating a Motion player again.
 */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  const sound = useGameStore((s) => s.sound);
  const glass = useGameStore((s) => s.glassStyle);
  const scene = useGameStore((s) => s.scene);
  const players = useGameStore((s) => s.players);
  const modes = useGameStore((s) => s.inputModes);
  const calibrating = useGameStore((s) => s.calibration);
  const [n0, n1] = [usePlayerName(0), usePlayerName(1)];
  const row = "flex items-center justify-between gap-6 py-2.5";
  return (
    <div className="panel pointer-events-auto w-80 rounded-3xl px-5 py-3 text-left">
      <div className="flex items-center justify-between py-1.5">
        <div className="text-[15px] font-semibold">Settings</div>
        <button className="text-[13px] font-semibold text-accent-ink" onClick={onClose}>
          Done
        </button>
      </div>
      <div className={row}>
        <span className="text-[14px]">Sound effects</span>
        <Choice value={sound ? "on" : "off"} options={[["on", "On"], ["off", "Off"]]} onChange={(v) => setSound(v === "on")} />
      </div>
      <div className={row}>
        <span className="text-[14px]">Glass</span>
        <Choice value={glass} options={[["classic", "Classic"], ["liquid", "Liquid"]]} onChange={setGlass} />
      </div>
      <div className="border-t border-black/[0.06] pt-2 pb-1">
        <div className="text-[12px] font-semibold text-accent-ink">Calibrate motion</div>
        {([0, 1] as const).map((slot) => {
          if (!players[slot].connected) return null;
          const ok = modes[slot] === "motion" && scene !== "hub" && !calibrating[slot];
          return (
            <div key={slot} className={row}>
              <span className="truncate text-[14px]">{slot === 0 ? n0 : n1}</span>
              <button
                className="rounded-full bg-accent-ink px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-35"
                disabled={!ok}
                title={modes[slot] !== "motion" ? "Playing with Buttons" : scene === "hub" ? "Start a game first" : undefined}
                onClick={() => scene !== "hub" && startCalibration(slot, scene)}
              >
                Calibrate
              </button>
            </div>
          );
        })}
        {!players[0].connected && !players[1].connected && <div className="py-2 text-[13px] text-ink-3">No phones connected</div>}
      </div>
    </div>
  );
}

/** Each player's calibration, step by step, while it runs. */
function CalibrationPanel({ slot }: { slot: PlayerSlot }) {
  const view = useGameStore((s) => s.calibration[slot]);
  const name = usePlayerName(slot);
  if (!view) return null;
  return (
    <div className="panel w-80 rounded-3xl px-5 py-3 text-center">
      <div className="flex items-center justify-center gap-2 text-[12px] font-semibold text-accent-ink">
        <Dot color={PLAYER_COLORS[slot]} />
        {name} · Calibrating motion
      </div>
      {view.step !== "done" && <CalDiagram game={view.game} step={view.step} size={120} />}
      <div className="mt-1 text-[20px] font-semibold tracking-tight">{CAL_TEXT[view.game][view.step].title}</div>
      <div className="mt-0.5 text-[13px] leading-snug text-ink-2">
        {view.waiting ? `Waiting for ${name} to tap Ready on their phone.` : CAL_TEXT[view.game][view.step].hint}
      </div>
      {view.step !== "done" && !view.waiting && (
        <div className="mx-auto mt-2.5 h-1.5 w-40 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-accent-ink transition-[width] duration-150"
            style={{ width: `${(view.step === "action" ? view.reps / Math.max(REPS_MIN, view.reps + view.needed) : view.progress) * 100}%` }}
          />
        </div>
      )}
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
  hub: ["On the phone: ‹ › to aim at a game, Select to choose, Select again to play.", "Motion controls and calibration: the phone's Settings."],
  pingpong: ["Hold Swing to wind up, let go to swing. The first press serves.", "‹ Hub on the phone, or Esc, goes back to the hub."],
  bowling: ["‹ › to aim. Hold Bowl to wind up (longer is faster), let go to bowl.", "‹ Hub on the phone, or Esc, goes back to the hub."],
  golf: ["‹ › to aim. Hold Putt to wind up (longer is further), let go to putt.", "‹ Hub on the phone, or Esc, goes back to the hub."],
};

const HINTS: Record<string, [string, string]> = {
  hub: ["Point the top of your phone at a game. Tap to select, tap again to play.", "Hold it upright to rest. R or a two-finger tap recenters. Settings: top right."],
  pingpong: ["Hold the phone like a paddle, screen facing the table. Swing to hit, tap to serve.", "Esc or a three-finger tap: back to the hub."],
  bowling: ["Hold the phone however is comfortable. Hold the screen to pick up the ball, swing, let go to bowl. Turn it to angle the shot.", "Esc or a three-finger tap: back to the hub."],
  golf: ["Hold the phone however is comfortable. Hold the screen, swing, let go to putt. Turn it to aim.", "Esc or a three-finger tap: back to the hub."],
};

export default function HostScreen({ lanIp }: { lanIp: string | null }) {
  const hostStatus = useGameStore((s) => s.hostStatus);
  const hostError = useGameStore((s) => s.hostError);
  const code = useGameStore((s) => s.roomCode);
  const scene = useGameStore((s) => s.scene);
  const anyone = useGameStore((s) => s.players[0].connected || s.players[1].connected);
  const url = useJoinUrl(lanIp, code);
  const split = useSplit();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // R recenters every phone's heading; Esc leaves a game; G switches the glass look.
  useEffect(() => {
    const saved = localStorage.getItem(GLASS_KEY);
    if (saved === "classic" || saved === "liquid") useGameStore.setState({ glassStyle: saved });
    if (localStorage.getItem(SOUND_KEY) === "off") useGameStore.setState({ sound: false });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR") {
        requestRecenter(0);
        requestRecenter(1);
      } else if (e.code === "Escape") {
        exitToHub();
      } else if (e.code === "KeyG") {
        setGlass(useGameStore.getState().glassStyle === "liquid" ? "classic" : "liquid");
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
      {split && <SplitOverlay />}
      <GameStateOverlay />

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
          <CalibrationPanel slot={0} />
          <CalibrationPanel slot={1} />
          {/* Stacked under the callout, not pinned over it */}
          {!anyone && scene !== "hub" && (
            <div className="panel rounded-full px-6 py-3 text-[15px] text-ink-2">
              No phone connected. Rejoin with room code <span className="font-semibold text-ink">{code}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-start gap-3">
            {anyone && code && <RoomBadge code={code} url={url} />}
            <button
              aria-label="Settings"
              onClick={() => setSettingsOpen((o) => !o)}
              className="panel pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
              </svg>
            </button>
          </div>
          {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        </div>
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

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-8">
        <div className="flex gap-3">
          <PlayerChip slot={0} />
          <PlayerChip slot={1} />
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
