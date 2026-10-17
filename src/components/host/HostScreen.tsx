"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { exitToHub } from "@/lib/game/scenes";
import { scorecard, totalScore } from "@/lib/games/bowling";
import { HOLES, PAR } from "@/lib/games/golf";
import { POINTS_TO_WIN } from "@/lib/games/pingpong";
import { startHost } from "@/lib/net/host";
import { ISLANDS } from "@/lib/hub/islands";
import { PLAYER_COLORS, PLAYER_NAMES, type PlayerSlot } from "@/lib/net/protocol";
import { requestRecenter, useGameStore } from "@/store/gameStore";

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

function PlayerChip({ slot }: { slot: PlayerSlot }) {
  const connected = useGameStore((s) => s.players[slot].connected);
  const rate = usePacketRate(slot);
  return (
    <div className="panel flex items-center gap-3 rounded-full py-2.5 pr-5 pl-3.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: connected ? PLAYER_COLORS[slot] : "#d1d1d6" }} />
      <span className="text-[15px] font-semibold">{PLAYER_NAMES[slot]}</span>
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

/** The handshake: a massive room code and a QR, nothing else. */
function Handshake({ code, url, status, error }: { code: string | null; url: string | null; status: string; error: string | null }) {
  const svg = useQrSvg(url);
  return (
    <div className="panel w-[min(92vw,820px)] rounded-[40px] px-14 py-12">
      <div className="text-[15px] font-semibold text-ink-3">Room code</div>
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
        <div className="text-[12px] font-semibold text-ink-3">Room</div>
        <div className="tabular text-[26px] leading-none font-semibold tracking-tight">{code}</div>
      </div>
    </div>
  );
}

/** The game a player tapped in the hub; a second tap starts it. */
function Selection() {
  const selected = useGameStore((s) => s.selected);
  const island = ISLANDS.find((i) => i.id === selected);
  return (
    <div
      className="panel rounded-3xl px-8 py-5 text-center transition-all duration-300"
      style={{ opacity: island ? 1 : 0, transform: island ? "none" : "translateY(8px)" }}
    >
      <div className="text-[13px] font-semibold text-ink-3">Selected</div>
      <div className="mt-0.5 text-[28px] leading-tight font-semibold tracking-tight">{island?.name ?? " "}</div>
      <div className="mt-1 text-[15px] text-ink-2">Tap again to play.</div>
    </div>
  );
}

/** The latest point, roll or stroke, shown for a moment. */
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
      className="panel rounded-full px-7 py-3 text-[22px] font-semibold tracking-tight transition-all duration-300"
      style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(-6px)" }}
    >
      {callout?.text ?? " "}
    </div>
  );
}

function PingPongHud() {
  const { score, rally, cpu } = useGameStore((s) => s.pingpong);
  return (
    <div className="panel flex items-center gap-7 rounded-full px-7 py-3">
      <Side color={PLAYER_COLORS[0]} name="Player 1" points={score[0]} />
      <div className="text-center">
        <div className="text-[12px] font-semibold text-ink-3">First to {POINTS_TO_WIN}</div>
        <div className="tabular text-[13px] text-ink-2">Rally {rally}</div>
      </div>
      <Side color={cpu ? "#ff7ae0" : PLAYER_COLORS[1]} name={cpu ? "CPU" : "Player 2"} points={score[1]} right />
    </div>
  );
}

function Side({ color, name, points, right }: { color: string; name: string; points: number; right?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-[15px] font-semibold">{name}</span>
      <span className="tabular text-[30px] leading-none font-semibold">{points}</span>
    </div>
  );
}

function BowlingHud() {
  const rolls = useGameStore((s) => s.bowling.rolls);
  const card = scorecard(rolls);
  return (
    <div className="panel flex items-stretch rounded-2xl p-1.5">
      {card.map((f, i) => (
        <div key={i} className={`w-[60px] px-1 py-1 text-center ${i ? "border-l border-black/[0.06]" : ""}`}>
          <div className="text-[11px] font-semibold text-ink-3">{i + 1}</div>
          <div className="tabular mt-0.5 h-5 text-[15px] font-semibold tracking-wider">{f.marks.join(" ")}</div>
          <div className="tabular text-[13px] text-ink-2">{f.total ?? ""}</div>
        </div>
      ))}
      <div className="w-[70px] border-l border-black/[0.06] px-1 py-1 text-center">
        <div className="text-[11px] font-semibold text-ink-3">Total</div>
        <div className="tabular mt-1 text-[24px] leading-none font-semibold">{totalScore(rolls)}</div>
      </div>
    </div>
  );
}

function GolfHud() {
  const { hole, strokes, card, over } = useGameStore((s) => s.golf);
  const h = HOLES[Math.min(hole, HOLES.length - 1)];
  const total = card.reduce((a, b) => a + b, 0);
  return (
    <div className="panel flex items-center gap-8 rounded-full px-7 py-3">
      <div>
        <div className="text-[12px] font-semibold text-ink-3">
          Hole {Math.min(hole, HOLES.length - 1) + 1} of {HOLES.length} · Par {h.par}
        </div>
        <div className="text-[17px] font-semibold">{over ? "Round complete" : h.name}</div>
      </div>
      <div className="text-center">
        <div className="text-[12px] font-semibold text-ink-3">Strokes</div>
        <div className="tabular text-[28px] leading-none font-semibold">{over ? "–" : strokes}</div>
      </div>
      <div className="text-center">
        <div className="text-[12px] font-semibold text-ink-3">Card · Par {PAR}</div>
        <div className="tabular text-[17px] font-semibold">
          {card.length ? card.join("  ") : "–"}
          {card.length > 0 && <span className="ml-2 text-ink-3">= {total}</span>}
        </div>
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
  hub: ["Point the top of your phone at a game. Tap to select, tap again to play.", "Hold it upright to rest. R or a two-finger tap recenters. G switches the glass."],
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

  // R recenters every phone's heading; Esc leaves a game; G switches the glass look.
  useEffect(() => {
    const saved = localStorage.getItem(GLASS_KEY);
    if (saved === "classic" || saved === "liquid") useGameStore.setState({ glassStyle: saved });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR") {
        requestRecenter(0);
        requestRecenter(1);
      } else if (e.code === "Escape") {
        exitToHub();
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
    <main className="fixed inset-0 overflow-hidden bg-white select-none">
      <div className="absolute inset-0">
        <Stage />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-8">
        <div className="text-[17px] font-semibold tracking-tight">Sports Social</div>
        <div className="flex flex-col items-center gap-3">
          {anyone && scene === "hub" && <Selection />}
          {scene === "pingpong" && <PingPongHud />}
          {scene === "bowling" && <BowlingHud />}
          {scene === "golf" && <GolfHud />}
          {scene !== "hub" && <Callout />}
        </div>
        {anyone && code ? <RoomBadge code={code} url={url} /> : <div />}
      </header>

      {!anyone && scene !== "hub" && (
        <div className="pointer-events-none absolute inset-x-0 top-40 flex justify-center">
          <div className="panel rounded-full px-6 py-3 text-[15px] text-ink-2">
            No phone connected. Rejoin with room code <span className="font-semibold text-ink">{code}</span>
          </div>
        </div>
      )}

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
        {anyone && (
          <div className="max-w-[46ch] text-right text-[13px] leading-relaxed text-ink-3">
            {hint}
            <br />
            {hint2}
          </div>
        )}
      </footer>
    </main>
  );
}
