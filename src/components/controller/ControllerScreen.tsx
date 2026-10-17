"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import {
  createButtonState,
  islandName,
  nudge,
  power,
  press,
  release,
  setScene,
  stepButtons,
  type ButtonScene,
} from "@/lib/input/buttons";
import { connectToHost, type ClientLink } from "@/lib/net/client";
import { P, PACKET_FLOATS, PLAYER_COLORS, PLAYER_NAMES, SEND_HZ } from "@/lib/net/protocol";
import {
  createSensorState,
  requestMotionPermission,
  startDeviceSensors,
  startSimulatedSensors,
  type SensorState,
} from "@/lib/sensors/motion";
import { useGameStore } from "@/store/gameStore";

// The phone. Step 1: the room code and "Start". Step 2, one of two inputs:
//
// - Buttons (the default): on-screen buttons per game. The phone generates
//   the same telemetry packet the sensors would (lib/input/buttons.ts), so
//   the laptop runs unchanged. Needs no motion permission and no HTTPS.
// - Motion: the real sensors; the whole screen is one frosted grip pane, a
//   two-finger tap recenters, three fingers go back to the hub.
//
// Telemetry streams at 60 Hz either way.

type InputMode = "buttons" | "motion";
const MODE_KEY = "sports-social-input";

/** One line on the motion pane for whatever the laptop is showing. */
const MOTION_HINTS: Record<string, string> = {
  hub: "Point the top of the phone at a game. Tap to select, tap again to play.",
  pingpong: "Hold it like a paddle, screen facing the table. Swing to hit. Tap to serve.",
  bowling: "Hold the screen to pick up the ball. Swing underhand, let go to bowl.",
  golf: "Hold it upright like a putter. Hold the screen, swing, let go to putt.",
};

function savedMode(param: string | null): InputMode {
  if (param === "motion" || param === "buttons") return param;
  try {
    return localStorage.getItem(MODE_KEY) === "motion" ? "motion" : "buttons";
  } catch {
    return "buttons";
  }
}

export default function ControllerScreen() {
  const params = useSearchParams();
  const sim = params.get("sim") === "1"; // desktop test pad: the mouse stands in for the sensors
  const [code, setCode] = useState(() => (params.get("code") ?? "").replace(/\D/g, "").slice(0, 4));
  const [mode, setModeState] = useState<InputMode>(() => savedMode(params.get("input")));
  const status = useGameStore((s) => s.clientStatus);
  const error = useGameStore((s) => s.clientError);
  const slot = useGameStore((s) => s.mySlot);
  const scene = useGameStore((s) => s.clientScene);
  const [localError, setLocalError] = useState<string | null>(null);
  const [grip, setGrip] = useState(false);

  const link = useRef<ClientLink | null>(null);
  const sensors = useRef<SensorState>(createSensorState());
  const sensorsRunning = useRef(false);
  const buttons = useRef(createButtonState());
  const buttonPacket = useRef(new Float32Array(PACKET_FLOATS));
  const modeRef = useRef(mode);
  const pane = useRef<HTMLDivElement>(null);
  const stopSensors = useRef<(() => void) | null>(null);

  const startSensors = useCallback(() => {
    if (sim || sensorsRunning.current) return;
    stopSensors.current = startDeviceSensors(sensors.current);
    sensorsRunning.current = true;
  }, [sim]);

  const applyMode = useCallback((next: InputMode) => {
    modeRef.current = next;
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {}
    link.current?.control({ t: "input", mode: next });
  }, []);

  /** Switching to Motion asks for sensor access, so it must run inside the tap. */
  const chooseMode = (next: InputMode) => {
    setLocalError(null);
    if (next === "buttons" || sim) return applyMode(next);
    if (!window.isSecureContext) {
      setLocalError("Motion needs the https:// address shown on the laptop. Buttons work anywhere.");
      return;
    }
    requestMotionPermission().then((granted) => {
      if (!granted) return setLocalError("Motion access was denied. Allow Motion & Orientation for this site.");
      startSensors();
      applyMode("motion");
    });
  };

  const connect = useCallback(() => {
    setLocalError(null);
    const wantsMotion = modeRef.current === "motion" && !sim;
    // First statement in the tap handler, before any await: iOS only shows
    // the motion prompt while the user gesture is still active.
    const permission = wantsMotion ? requestMotionPermission() : Promise.resolve(true);
    useGameStore.setState({ clientStatus: "permission" });
    permission.then(async (granted) => {
      if (wantsMotion && (!granted || !window.isSecureContext)) {
        // No sensors: play with buttons instead of stopping here.
        applyMode("buttons");
        setLocalError("Motion is unavailable here, so you are on Buttons. You can switch later.");
      } else if (wantsMotion) {
        startSensors();
      }
      try {
        // Never two links: close any previous one before opening a new one.
        link.current?.close();
        link.current = await connectToHost(code);
      } catch {
        useGameStore.setState({ clientStatus: "error", clientError: "Could not reach the connection service." });
      }
    });
  }, [code, sim, applyMode, startSensors]);

  // Tell the laptop which input this phone uses whenever the link comes up.
  useEffect(() => {
    if (status === "connected") link.current?.control({ t: "input", mode: modeRef.current });
  }, [status]);

  // Buttons follow the laptop's scene.
  useEffect(() => {
    setScene(buttons.current, scene as ButtonScene);
  }, [scene]);

  // The simulated sensors read the mouse over the pane, once it exists.
  useEffect(() => {
    if (!sim || status !== "connected" || mode !== "motion" || !pane.current) return;
    stopSensors.current?.();
    stopSensors.current = startSimulatedSensors(sensors.current, pane.current);
  }, [sim, status, mode]);

  // 60 Hz send loop. A preallocated Float32Array goes out every tick: no allocation, no JSON.
  useEffect(() => {
    if (status !== "connected") return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      let packet = sensors.current.packet;
      if (modeRef.current === "buttons") {
        packet = buttonPacket.current;
        stepButtons(buttons.current, Math.min((now - last) / 1000, 0.1), packet);
      }
      last = now;
      packet[P.TIME] = now;
      link.current?.send(packet);
    }, 1000 / SEND_HZ);
    return () => clearInterval(id);
  }, [status]);

  // Keep the screen awake while playing.
  useEffect(() => {
    if (status !== "connected" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((l) => (lock = l), () => {});
    return () => {
      lock?.release();
    };
  }, [status]);

  useEffect(
    () => () => {
      stopSensors.current?.();
      link.current?.close();
    },
    [],
  );

  // --- Motion pane input
  const setGripState = (down: boolean) => {
    if (down && sensors.current.packet[P.GRIP] === 0) navigator.vibrate?.(8); // a tick, where supported
    sensors.current.packet[P.GRIP] = down ? 1 : 0;
    setGrip(down);
  };
  // Touch screens follow a touch with imitation mouse events; ignore those so
  // a released grip does not pulse back on.
  const lastTouch = useRef(0);
  const fromMouse = (down: boolean) => {
    if (performance.now() - lastTouch.current > 800) setGripState(down);
  };
  // One finger is the grip. Two- and three-finger taps are gestures, decided
  // when the fingers lift (they land one at a time): two recenters, three
  // leaves the game for the hub.
  const maxTouches = useRef(0);
  const onTouchStart = (e: TouchEvent) => {
    lastTouch.current = performance.now();
    maxTouches.current = Math.max(maxTouches.current, e.touches.length);
    setGripState(e.touches.length === 1);
  };
  const onTouchEnd = (e: TouchEvent) => {
    lastTouch.current = performance.now();
    e.preventDefault(); // also suppresses the imitation mouse events
    if (e.touches.length > 0) return;
    setGripState(false);
    if (maxTouches.current === 2) link.current?.control({ t: "recenter" });
    else if (maxTouches.current >= 3) link.current?.control({ t: "exit" });
    maxTouches.current = 0;
  };

  if (status === "connected" && slot !== null) {
    const color = PLAYER_COLORS[slot];
    return (
      <main
        className="fixed inset-0 flex flex-col overflow-hidden bg-white select-none"
        style={{ touchAction: "none", WebkitTouchCallout: "none" }}
      >
        {/* Soft color behind everything, so the frosted surfaces have something to frost. */}
        <div
          className="absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: grip ? 1 : 0.55,
            background: `radial-gradient(70% 50% at 25% 30%, ${color}, transparent 72%), radial-gradient(65% 50% at 80% 75%, ${color}cc, transparent 72%)`,
          }}
        />
        <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {scene !== "hub" ? (
              <button
                className="panel rounded-full px-4 py-2 text-[15px] font-semibold active:opacity-70"
                onClick={() => link.current?.control({ t: "exit" })}
              >
                ‹ Hub
              </button>
            ) : (
              <span className="text-[17px] font-semibold">{PLAYER_NAMES[slot]}</span>
            )}
          </div>
          <Segmented value={mode} onChange={chooseMode} />
        </header>
        {localError && <p className="relative z-10 px-6 text-center text-[13px] text-ink-2">{localError}</p>}

        {mode === "buttons" ? (
          <ButtonPad scene={scene as ButtonScene} state={buttons.current} />
        ) : (
          <div
            ref={pane}
            className="relative flex flex-1 flex-col items-center justify-between py-10 backdrop-blur-xl transition-colors duration-100"
            style={{ background: grip ? "rgb(255 255 255 / 0.2)" : "rgb(255 255 255 / 0.5)" }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchCancel={() => setGripState(false)}
            // Desktop test pad: the mouse button is the grip.
            onMouseDown={() => fromMouse(true)}
            onMouseUp={() => fromMouse(false)}
            onMouseLeave={() => fromMouse(false)}
          >
            <div />
            <div className="px-8 text-center">
              <div className="text-[34px] font-semibold tracking-tight text-ink">{grip ? "Gripping" : "Touch to grip"}</div>
              <div className="mt-3 text-[17px] leading-snug text-ink-2">{MOTION_HINTS[scene] ?? MOTION_HINTS.hub}</div>
            </div>
            <div className="text-center text-[13px] leading-relaxed text-ink-2">
              Two fingers: recenter
              {scene !== "hub" && (
                <>
                  <br />
                  Three fingers: back to the hub
                </>
              )}
            </div>
          </div>
        )}
      </main>
    );
  }

  const busy = status === "permission" || status === "connecting";
  const message =
    localError ??
    (status === "error"
      ? error
      : status === "full"
        ? "This game already has two players."
        : status === "closed"
          ? "Disconnected. Tap to reconnect."
          : null);

  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center bg-white px-8 select-none">
      <div className="w-full max-w-sm">
        <h1 className="text-[34px] leading-tight font-semibold tracking-tight">Sports Social</h1>
        <p className="mt-2 text-[17px] text-ink-2">Your phone is the controller.</p>

        <label className="mt-12 block text-[13px] font-semibold text-ink-3" htmlFor="code">
          Room code
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="tabular mt-2 w-full rounded-2xl bg-[#f2f2f7] px-6 py-5 text-[44px] font-semibold tracking-[0.2em] outline-none placeholder:text-[#c7c7cc]"
        />

        <div className="mt-6 flex justify-center">
          <Segmented value={mode} onChange={(m) => applyMode(m)} />
        </div>

        <button
          disabled={code.length !== 4 || busy}
          onClick={connect}
          className="mt-4 w-full rounded-2xl bg-ink py-5 text-[17px] font-semibold text-white active:opacity-80 disabled:bg-[#d1d1d6]"
        >
          {busy ? "Connecting…" : "Start"}
        </button>

        <p className="mt-4 min-h-[3em] text-center text-[15px] leading-snug text-ink-2">{message}</p>
      </div>
    </main>
  );
}

function Segmented({ value, onChange }: { value: InputMode; onChange: (m: InputMode) => void }) {
  return (
    <div className="flex rounded-full bg-black/[0.06] p-1 text-[14px] font-semibold">
      {(["buttons", "motion"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded-full px-4 py-1.5 transition-colors ${value === m ? "bg-white text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.06)]" : "text-ink-2"}`}
        >
          {m === "buttons" ? "Buttons" : "Motion"}
        </button>
      ))}
    </div>
  );
}

/** A button that reports press and release (for hold-to-wind-up actions). */
function HoldButton({
  onDown,
  onUp,
  className,
  children,
  label,
}: {
  onDown: () => void;
  onUp?: () => void;
  className: string;
  children: ReactNode;
  label?: string;
}) {
  const [down, setDown] = useState(false);
  return (
    <button
      aria-label={label}
      className={`${className} transition-transform duration-75 ${down ? "scale-[0.97]" : ""}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDown(true);
        navigator.vibrate?.(6);
        onDown();
      }}
      onPointerUp={() => {
        setDown(false);
        onUp?.();
      }}
      onPointerCancel={() => {
        setDown(false);
        onUp?.();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

const ARROW = "panel flex h-20 w-20 items-center justify-center rounded-full text-[30px] font-semibold active:opacity-70";

/** The Buttons layout for whatever the laptop is showing. */
function ButtonPad({ scene, state }: { scene: ButtonScene; state: ReturnType<typeof createButtonState> }) {
  const [, redraw] = useState(0);
  const meter = useRef<HTMLDivElement>(null);
  const bump = () => redraw((n) => n + 1);

  // The power meter follows the backswing every frame without re-rendering React.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (meter.current) meter.current.style.transform = `scaleX(${Math.max(0, Math.min(1, power(state)))})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const big = "panel flex flex-1 flex-col items-center justify-center rounded-[36px] text-center";

  if (scene === "hub") {
    return (
      <div className="relative z-10 flex flex-1 flex-col gap-5 px-5 pb-6">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-[15px] font-semibold text-ink-2">Aiming at</div>
          <div className="mt-1 text-[40px] font-semibold tracking-tight">{islandName(state)}</div>
          <div className="mt-8 flex gap-6">
            <HoldButton label="Previous game" className={ARROW} onDown={() => (nudge(state, -1), bump())}>
              ‹
            </HoldButton>
            <HoldButton label="Next game" className={ARROW} onDown={() => (nudge(state, 1), bump())}>
              ›
            </HoldButton>
          </div>
        </div>
        <HoldButton className={`${big} max-h-48`} onDown={() => press(state)} onUp={() => release(state)}>
          <span className="text-[30px] font-semibold tracking-tight">Select</span>
          <span className="mt-1 text-[15px] text-ink-2">Tap to choose, tap again to play</span>
        </HoldButton>
      </div>
    );
  }

  if (scene === "pingpong") {
    return (
      <div className="relative z-10 flex flex-1 flex-col px-5 pb-6">
        <HoldButton className={big} onDown={() => press(state)} onUp={() => release(state)}>
          <span className="text-[40px] font-semibold tracking-tight">Swing</span>
          <span className="mt-2 max-w-[24ch] text-[15px] leading-snug text-ink-2">
            Hold to wind up, let go to swing. The first press serves.
          </span>
        </HoldButton>
      </div>
    );
  }

  // Bowling and golf: aim, then hold for power and let go.
  const verb = scene === "bowling" ? "Bowl" : "Putt";
  const deg = Math.round((-state.aim * 180) / Math.PI);
  return (
    <div className="relative z-10 flex flex-1 flex-col gap-4 px-5 pb-6">
      <div className="flex items-center justify-between">
        <HoldButton label="Aim left" className={ARROW} onDown={() => (nudge(state, -1), bump())}>
          ‹
        </HoldButton>
        <div className="text-center">
          <div className="text-[13px] font-semibold text-ink-3">Aim</div>
          <div className="tabular text-[28px] font-semibold">
            {deg === 0 ? "Straight" : `${Math.abs(deg)}° ${deg > 0 ? "right" : "left"}`}
          </div>
        </div>
        <HoldButton label="Aim right" className={ARROW} onDown={() => (nudge(state, 1), bump())}>
          ›
        </HoldButton>
      </div>
      <div className="panel h-3 overflow-hidden rounded-full">
        <div ref={meter} className="h-full origin-left rounded-full bg-ink" style={{ transform: "scaleX(0)" }} />
      </div>
      <HoldButton className={big} onDown={() => press(state)} onUp={() => release(state)}>
        <span className="text-[40px] font-semibold tracking-tight">{verb}</span>
        <span className="mt-2 max-w-[24ch] text-[15px] leading-snug text-ink-2">
          Hold to wind up (longer is {scene === "bowling" ? "faster" : "further"}), let go to {verb.toLowerCase()}.
        </span>
      </HoldButton>
    </div>
  );
}
