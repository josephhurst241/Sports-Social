"use client";

import { useState } from "react";
import { NEUTRAL_SENSITIVITY, SENSITIVITY_LIMITS, cleanSensitivity, type Sensitivity } from "@/lib/game/calibration";
import { Sheet } from "./Account";

// The phone's settings: one short sheet. Controls (Buttons or Motion),
// calibrating motion again, Aim and Swing sensitivity, recentering, and
// haptics. Calibration runs on the laptop in the hub, so it is offered there
// only; the sensitivities apply to Motion (Buttons sends ideal motions).

type InputMode = "buttons" | "motion";
const HAPTICS_KEY = "sports-social-haptics";
const SENSITIVITY_KEY = "sports-social-sensitivity";

/** This phone's Aim and Swing sensitivity (remembered on the phone). */
export function savedSensitivity(): Sensitivity {
  try {
    const v = JSON.parse(localStorage.getItem(SENSITIVITY_KEY) ?? "null");
    return v ? { aim: cleanSensitivity(v.aim), swing: cleanSensitivity(v.swing) } : { ...NEUTRAL_SENSITIVITY };
  } catch {
    return { ...NEUTRAL_SENSITIVITY };
  }
}

export function saveSensitivity(sens: Sensitivity) {
  try {
    localStorage.setItem(SENSITIVITY_KEY, JSON.stringify(sens));
  } catch {}
}

/** One sensitivity slider, 0.5x to 2x, with its value. */
function Slider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={SENSITIVITY_LIMITS[0]}
        max={SENSITIVITY_LIMITS[1]}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-32 accent-[var(--accent-ink)]"
      />
      <span className="tabular w-11 text-right text-[15px] font-semibold">{value.toFixed(2).replace(/0$/, "")}×</span>
    </div>
  );
}

/** Whether the phone ticks under the finger (remembered on this phone). */
export function hapticsOn() {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
}

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] py-3.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[17px] font-semibold">{title}</div>
        {note && <div className="mt-0.5 text-[13px] leading-snug text-ink-3">{note}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const action = "rounded-full bg-accent-ink px-4 py-2 text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-35";

export function SettingsSheet({
  mode,
  onMode,
  scene,
  sens,
  onSens,
  onCalibrate,
  onRecenter,
  onClose,
}: {
  mode: InputMode;
  onMode: (m: InputMode) => void;
  scene: string;
  sens: Sensitivity;
  onSens: (s: Sensitivity) => void;
  onCalibrate: () => void;
  onRecenter: () => void;
  onClose: () => void;
}) {
  const [haptics, setHaptics] = useState(hapticsOn);
  const canCalibrate = mode === "motion" && scene !== "hub";
  return (
    <Sheet title="Settings" onClose={onClose}>
      <Row title="Controls" note={mode === "buttons" ? "On-screen buttons. Works anywhere." : "Swing and turn the phone itself."}>
        <div className="flex rounded-full bg-black/[0.06] p-1 text-[14px] font-semibold">
          {(["buttons", "motion"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onMode(m)}
              className={`rounded-full px-3.5 py-1.5 ${mode === m ? "bg-white text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.06)]" : "text-ink-2"}`}
            >
              {m === "buttons" ? "Buttons" : "Motion"}
            </button>
          ))}
        </div>
      </Row>
      <Row
        title="Calibrate motion"
        note={
          mode !== "motion"
            ? "For Motion controls."
            : scene === "hub"
              ? "Calibrates the game you are in. Start a game first."
              : "Tunes this game to how you move: hold, then the action a few times."
        }
      >
        <button
          className={action}
          disabled={!canCalibrate}
          onClick={() => {
            onCalibrate();
            onClose();
          }}
        >
          Calibrate
        </button>
      </Row>
      {mode === "motion" && (
        <>
          <Row title="Aim" note="How far turning the phone moves your aim.">
            <Slider label="Aim sensitivity" value={sens.aim} onChange={(aim) => onSens({ ...sens, aim })} />
          </Row>
          <Row title="Swing" note="How strong a swing is.">
            <Slider label="Swing sensitivity" value={sens.swing} onChange={(swing) => onSens({ ...sens, swing })} />
          </Row>
        </>
      )}
      <Row title="Recenter" note="Point the phone at the laptop, then tap.">
        <button className={action} disabled={mode !== "motion"} onClick={onRecenter}>
          Recenter
        </button>
      </Row>
      <Row title="Haptics" note="A tick under your finger as you grip and press.">
        <button
          role="switch"
          aria-checked={haptics}
          onClick={() => {
            const next = !haptics;
            setHaptics(next);
            try {
              localStorage.setItem(HAPTICS_KEY, next ? "on" : "off");
            } catch {}
          }}
          className={`relative h-8 w-13 rounded-full transition-colors ${haptics ? "bg-accent-ink" : "bg-black/15"}`}
        >
          <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white transition-transform ${haptics ? "translate-x-5" : ""}`} />
        </button>
      </Row>
    </Sheet>
  );
}
