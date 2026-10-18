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
import Logo from "@/components/brand/Logo";
import Splash from "@/components/brand/Splash";
import { themeVars } from "@/lib/game/theme";
import { connectToHost, type ClientLink } from "@/lib/net/client";
import { P, PACKET_FLOATS, PLAYER_COLORS, SEND_HZ, type PlayerSlot } from "@/lib/net/protocol";
import {
  createSensorState,
  requestMotionPermission,
  startDeviceSensors,
  startSimulatedSensors,
  type SensorState,
} from "@/lib/sensors/motion";
import { initAccount, saveResult, useAccount } from "@/lib/account/account";
import { useGameStore } from "@/store/gameStore";
import CalDiagram from "@/components/CalDiagram";
import { CAL_TEXT, REPS_MIN } from "@/lib/game/calibration";
import { AccountChip, ProfileSheet, SignInSheet, Toast } from "./Account";
import { SettingsSheet, hapticsOn, saveSensitivity, savedSensitivity } from "./Settings";

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
  bowling: "Hold the phone however is comfortable. Hold the screen, swing, let go to bowl.",
  golf: "Hold the phone however is comfortable. Hold the screen, swing, let go to putt.",
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
  const turn = useGameStore((s) => s.clientTurn);
  const names = useGameStore((s) => s.clientNames);
  const account = useAccount();
  // The test pad can stand in for a signed-in name (?sim=1&name=Ana); it saves nothing.
  const simName = sim ? params.get("name") : null;
  const [sheet, setSheet] = useState<"signin" | "profile" | "settings" | null>(null);
  // This phone's Aim and Swing sensitivity (Settings), remembered here and sent to the laptop.
  const [sens, setSens] = useState(savedSensitivity);
  const calibration = useGameStore((s) => s.clientCalibration);
  const [toast, setToast] = useState<{ text: string; action?: "signin" } | null>(null);
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

  // Accounts: restore the session (or find accounts are off).
  useEffect(() => initAccount(), []);

  // The test pad shows the phone's state to scripts, as window.__glass does on the laptop.
  useEffect(() => {
    if (sim) (window as unknown as { __phone: unknown }).__phone = { store: useGameStore, account: useAccount };
  }, [sim]);

  // Tell the laptop who is playing whenever the link comes up or the player signs in or out.
  useEffect(() => {
    if (status !== "connected") return;
    const user = account.user;
    link.current?.control({ t: "profile", id: user?.id ?? null, name: user?.name ?? simName ?? null });
  }, [status, account.user, simName]);

  // And this phone's sensitivity, on connecting and whenever it changes.
  useEffect(() => {
    if (status === "connected") link.current?.control({ t: "sensitivity", aim: sens.aim, swing: sens.swing });
  }, [status, sens]);

  // A finished game from the laptop: save it to the career, or invite a guest to sign in.
  const result = useGameStore((s) => s.clientResult);
  useEffect(() => {
    if (!result) return;
    const { status: acc } = useAccount.getState();
    if (acc === "signed-in") {
      saveResult(result.result).then((err) => setToast({ text: err ? `Not saved: ${err}` : "Saved to your career" }));
    } else if (acc === "guest") {
      setToast({ text: "Keep your scores?", action: "signin" });
    }
  }, [result]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const overlays = (
    <>
      {sheet === "signin" && <SignInSheet onClose={() => setSheet(null)} />}
      {sheet === "profile" && <ProfileSheet onClose={() => setSheet(null)} />}
      {sheet === "settings" && (
        <SettingsSheet
          mode={mode}
          onMode={chooseMode}
          scene={scene}
          sens={sens}
          onSens={(next) => {
            setSens(next);
            saveSensitivity(next);
          }}
          onCalibrate={() => link.current?.control({ t: "calibrate" })}
          onRecenter={() => link.current?.control({ t: "recenter" })}
          onClose={() => setSheet(null)}
        />
      )}
      {toast && (
        <Toast
          text={toast.text}
          action={toast.action ? "Sign in" : undefined}
          onAction={() => {
            setToast(null);
            setSheet("signin");
          }}
        />
      )}
    </>
  );

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
    if (down && sensors.current.packet[P.GRIP] === 0 && hapticsOn()) navigator.vibrate?.(8); // a tick, where supported
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
    // Bowling and golf take turns: the other player's turn has nothing to press.
    const waitingFor = turn !== null && turn !== slot ? turn : null;
    return (
      <main
        className="themed fixed inset-0 flex flex-col overflow-hidden bg-white select-none"
        style={{ ...themeVars(scene), touchAction: "none", WebkitTouchCallout: "none" }}
      >
        {/* Soft color behind everything, so the frosted surfaces have something to frost:
            the player's color up top, the game's signature below, both kept faint so
            the controls stay the loudest thing on screen. */}
        <div
          className="absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: grip ? 0.9 : 0.45,
            background: `radial-gradient(70% 50% at 25% 25%, ${color}, transparent 72%), radial-gradient(70% 55% at 75% 80%, var(--accent), transparent 72%)`,
          }}
        />
        <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            {scene !== "hub" ? (
              <button
                className="panel rounded-full px-4 py-2 text-[15px] font-semibold active:opacity-70"
                onClick={() => link.current?.control({ t: "exit" })}
              >
                ‹ Hub
              </button>
            ) : (
              !account.user && <span className="truncate text-[17px] font-semibold">{names[slot]}</span>
            )}
            <AccountChip onOpen={setSheet} />
          </div>
          {calibration && calibration.step !== "done" ? (
            <button
              className="panel rounded-full px-4 py-2 text-[15px] font-semibold text-ink-2 active:opacity-70"
              onClick={() => link.current?.control({ t: "calibrate-skip" })}
            >
              Skip
            </button>
          ) : (
            <button
              aria-label="Settings"
              className="panel flex h-10 w-10 items-center justify-center rounded-full text-ink-2 active:opacity-70"
              onClick={() => setSheet("settings")}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
              </svg>
            </button>
          )}
        </header>
        {localError && <p className="relative z-10 px-6 text-center text-[13px] text-ink-2">{localError}</p>}

        {mode === "buttons" ? (
          waitingFor !== null ? (
            <Waiting slot={waitingFor} name={names[waitingFor]} />
          ) : (
            <ButtonPad scene={scene as ButtonScene} state={buttons.current} />
          )
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
            {calibration ? (
              // Calibration: what to do now, and how far along (the laptop measures).
              <div className="w-full px-8 text-center">
                <div className="text-[13px] font-semibold text-accent-ink">Calibrating motion</div>
                {calibration.step !== "done" && <CalDiagram game={calibration.game} step={calibration.step} size={170} />}
                <div className="mt-1 text-[30px] font-semibold tracking-tight">{CAL_TEXT[calibration.game][calibration.step].title}</div>
                <div className="mt-2 text-[17px] leading-snug text-ink-2">{CAL_TEXT[calibration.game][calibration.step].hint}</div>
                {calibration.waiting ? (
                  // Each step starts only when the player is ready. Its touches stay
                  // off the pane, so tapping it is never a grip or a gesture.
                  <button
                    className="panel-ink mt-7 rounded-full px-10 py-3.5 text-[19px] font-semibold active:opacity-80"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    onClick={() => link.current?.control({ t: "calibrate-ready" })}
                  >
                    Ready
                  </button>
                ) : calibration.step === "action" ? (
                  // One dot per rep: three at least, more until they are consistent.
                  <div className="mt-6 flex justify-center gap-2">
                    {Array.from({ length: Math.max(REPS_MIN, calibration.reps + calibration.needed) }, (_, i) => (
                      <span key={i} className={`h-3 w-3 rounded-full ${i < calibration.reps ? "bg-accent-ink" : "bg-black/15"}`} />
                    ))}
                  </div>
                ) : calibration.step !== "done" ? (
                  <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-black/10">
                    <div className="h-full rounded-full bg-accent-ink transition-[width] duration-150" style={{ width: `${calibration.progress * 100}%` }} />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="px-8 text-center">
                <div className={`text-[34px] font-semibold tracking-tight ${grip ? "text-accent-ink" : "text-ink"}`}>
                  {waitingFor !== null ? `${names[waitingFor]}'s turn` : grip ? "Gripping" : "Touch to grip"}
                </div>
                <div className="mt-3 text-[17px] leading-snug text-ink-2">
                  {waitingFor !== null ? "You're up next. Watch the laptop." : (MOTION_HINTS[scene] ?? MOTION_HINTS.hub)}
                </div>
              </div>
            )}
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
        {overlays}
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
        <h1>
          <Logo size={68} wordmark />
        </h1>
        <div className="mt-3">
          <AccountChip onOpen={setSheet} />
        </div>
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

      {overlays}
      <Splash variant="phone" />
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
        if (hapticsOn()) navigator.vibrate?.(6);
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

/** Shown instead of the buttons while the other player takes their turn. */
function Waiting({ slot, name }: { slot: PlayerSlot; name: string }) {
  return (
    <div className="relative z-10 flex flex-1 flex-col px-5 pb-6">
      <div className="panel flex flex-1 flex-col items-center justify-center rounded-[36px] text-center">
        <span
          className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"
          style={{ background: PLAYER_COLORS[slot] }}
        />
        <span className="mt-4 text-[34px] font-semibold tracking-tight">{name}&apos;s turn</span>
        <span className="mt-2 text-[15px] text-ink-2">You&apos;re up next. Watch the laptop.</span>
      </div>
    </div>
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

  // The main action is the one inverse surface on screen, so it never blends with the arrows.
  const big = "panel-ink flex flex-1 flex-col items-center justify-center rounded-[36px] text-center";

  if (scene === "hub") {
    return (
      <div className="relative z-10 flex flex-1 flex-col gap-5 px-5 pb-6">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-[15px] font-semibold text-accent-ink">Aiming at</div>
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
          <span className="mt-1 text-[15px] text-white/75">Tap to choose, tap again to play</span>
        </HoldButton>
      </div>
    );
  }

  if (scene === "pingpong") {
    return (
      <div className="relative z-10 flex flex-1 flex-col px-5 pb-6">
        <HoldButton className={big} onDown={() => press(state)} onUp={() => release(state)}>
          <span className="text-[40px] font-semibold tracking-tight">Swing</span>
          <span className="mt-2 max-w-[24ch] text-[15px] leading-snug text-white/75">
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
          <div className="text-[13px] font-semibold text-accent-ink">Aim</div>
          <div className="tabular text-[28px] font-semibold">
            {deg === 0 ? "Straight" : `${Math.abs(deg)}° ${deg > 0 ? "right" : "left"}`}
          </div>
        </div>
        <HoldButton label="Aim right" className={ARROW} onDown={() => (nudge(state, 1), bump())}>
          ›
        </HoldButton>
      </div>
      <div className="panel h-3 overflow-hidden rounded-full">
        <div ref={meter} className="h-full origin-left rounded-full bg-accent-ink" style={{ transform: "scaleX(0)" }} />
      </div>
      <HoldButton className={big} onDown={() => press(state)} onUp={() => release(state)}>
        <span className="text-[40px] font-semibold tracking-tight">{verb}</span>
        <span className="mt-2 max-w-[24ch] text-[15px] leading-snug text-white/75">
          Hold to wind up (longer is {scene === "bowling" ? "faster" : "further"}), let go to {verb.toLowerCase()}.
        </span>
      </HoldButton>
    </div>
  );
}
