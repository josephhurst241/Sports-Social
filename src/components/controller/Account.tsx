"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  loadCareer,
  rename,
  sendEmailCode,
  signInWithGoogle,
  signOut,
  useAccount,
  verifyEmailCode,
  type CareerRow,
  type RecentGame,
} from "@/lib/account/account";
import type { GameResult } from "@/lib/net/protocol";

// The phone's account UI: a chip that reads "Sign in" or the player's name,
// a sign-in sheet (Google, or an emailed code), and a profile sheet with the
// career. Hidden entirely when accounts are off (no Supabase keys).

export const GAME_LABELS: Record<GameResult["game"], string> = { bowling: "Bowling", golf: "Golf", pingpong: "Ping Pong" };

/** Strokes against par as golfers write it: E, +3, −2. */
export const vsPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `−${-n}`);

export function AccountChip({ onOpen }: { onOpen: (sheet: "signin" | "profile") => void }) {
  const { status, user } = useAccount();
  if (status === "off" || status === "loading") return null;
  if (!user)
    return (
      <button className="panel rounded-full px-4 py-2 text-[15px] font-semibold text-accent-ink active:opacity-70" onClick={() => onOpen("signin")}>
        Sign in
      </button>
    );
  return (
    <button className="panel flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-[15px] font-semibold active:opacity-70" onClick={() => onOpen("profile")}>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-ink text-[13px] text-white">{user.name[0]?.toUpperCase()}</span>
      <span className="max-w-[9em] truncate">{user.name}</span>
    </button>
  );
}

/** A sheet that rises from the bottom over the controller. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/25" onClick={onClose} style={{ touchAction: "auto" }}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[32px] bg-white px-6 pt-5 pb-8 shadow-[0_0_0_1px_rgb(0_0_0/0.06)]"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
          <button className="rounded-full bg-black/[0.06] px-3 py-1 text-[15px] font-semibold text-ink-2" onClick={onClose}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const field = "w-full rounded-2xl bg-[#f2f2f7] px-4 py-3.5 text-[17px] outline-none placeholder:text-[#a1a1a6]";
const primary = "w-full rounded-2xl bg-accent-ink py-3.5 text-[17px] font-semibold text-white active:opacity-80 disabled:opacity-40";

export function SignInSheet({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = useAccount((s) => s.user);
  useEffect(() => {
    if (user) onClose();
  }, [user, onClose]);

  const run = async (task: () => Promise<string | null>, then?: () => void) => {
    setBusy(true);
    setError(null);
    const err = await task();
    setBusy(false);
    if (err) setError(err);
    else then?.();
  };

  return (
    <Sheet title="Sign in" onClose={onClose}>
      <p className="mb-5 text-[15px] leading-snug text-ink-2">Keep your scores and see your best games. You can always play as a guest.</p>
      <button className="w-full rounded-2xl bg-ink py-3.5 text-[17px] font-semibold text-white active:opacity-80 disabled:opacity-40" disabled={busy} onClick={() => run(signInWithGoogle)}>
        Continue with Google
      </button>
      <div className="my-5 flex items-center gap-3 text-[13px] text-ink-3">
        <span className="h-px flex-1 bg-black/10" />
        or with email
        <span className="h-px flex-1 bg-black/10" />
      </div>
      {!sent ? (
        <div className="flex flex-col gap-3">
          <input className={field} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className={primary} disabled={busy || !/^\S+@\S+\.\S+$/.test(email)} onClick={() => run(() => sendEmailCode(email.trim()), () => setSent(true))}>
            Email me a code
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] text-ink-2">
            We sent a code to <span className="font-semibold text-ink">{email}</span>.
          </p>
          <input
            className={`${field} tabular text-center text-[28px] tracking-[0.3em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
          />
          <button className={primary} disabled={busy || code.length < 6} onClick={() => run(() => verifyEmailCode(email.trim(), code))}>
            Sign in
          </button>
          <button
            className="py-1 text-[15px] font-semibold text-accent-ink"
            onClick={() => {
              setSent(false);
              setCode("");
            }}
          >
            Use a different email
          </button>
        </div>
      )}
      {error && <p className="mt-4 text-center text-[15px] text-[#c0392b]">{error}</p>}
    </Sheet>
  );
}

/** One game's career line: what "best" means differs per game. */
function CareerLine({ row }: { row: CareerRow }) {
  const facts: [string, string][] =
    row.game === "pingpong"
      ? [
          ["Played", String(row.played)],
          ["Won", String(row.wins)],
          ["Win rate", `${Math.round((row.wins / Math.max(1, row.played)) * 100)}%`],
        ]
      : row.game === "golf"
        ? [
            ["Rounds", String(row.played)],
            ["Best", row.best === null ? "–" : vsPar(row.best)],
            ["Average", row.average === null ? "–" : vsPar(Math.round(Number(row.average) * 10) / 10)],
          ]
        : [
            ["Games", String(row.played)],
            ["Best", row.best === null ? "–" : String(row.best)],
            ["Average", row.average === null ? "–" : String(Math.round(Number(row.average)))],
          ];
  return (
    <div className="rounded-2xl bg-[#f2f2f7] px-4 py-3">
      <div className="text-[13px] font-semibold text-accent-ink">{GAME_LABELS[row.game]}</div>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {facts.map(([k, v]) => (
          <div key={k}>
            <div className="tabular text-[20px] leading-tight font-semibold">{v}</div>
            <div className="text-[12px] text-ink-3">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function recentSummary(g: RecentGame) {
  const d = g.details as { score?: [number, number]; opponentName?: string; strokes?: number[] };
  if (g.game === "pingpong") return `${d.score?.[0]}–${d.score?.[1]} vs ${d.opponentName ?? "?"}`;
  if (g.game === "golf") return `${(d.strokes ?? []).reduce((a, b) => a + b, 0)} strokes (${vsPar(g.score)})`;
  return `${g.score}`;
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const user = useAccount((s) => s.user);
  const [name, setName] = useState(user?.name ?? "");
  const [nameNote, setNameNote] = useState<string | null>(null);
  const [career, setCareer] = useState<Awaited<ReturnType<typeof loadCareer>> | null>(null);
  useEffect(() => {
    loadCareer().then(setCareer);
  }, []);
  if (!user) return null;
  const played = career?.stats.reduce((n, r) => n + r.played, 0) ?? 0;

  return (
    <Sheet title={user.name} onClose={onClose}>
      {!career ? (
        <p className="text-[15px] text-ink-3">Loading…</p>
      ) : career.error ? (
        <p className="text-[15px] text-[#c0392b]">{career.error}</p>
      ) : played === 0 ? (
        <p className="text-[15px] text-ink-2">No games yet. Finish a game and it will show up here.</p>
      ) : (
        <>
          <div className="mb-3 text-[15px] text-ink-2">
            <span className="font-semibold text-ink">{played}</span> game{played === 1 ? "" : "s"} played
          </div>
          <div className="flex flex-col gap-2">
            {career.stats.map((r) => (
              <CareerLine key={r.game} row={r} />
            ))}
          </div>
          <h3 className="mt-6 mb-2 text-[13px] font-semibold text-accent-ink">Recent games</h3>
          <ul className="divide-y divide-black/[0.06]">
            {career.recent.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2.5 text-[15px]">
                <span>
                  <span className="font-semibold">{GAME_LABELS[g.game]}</span>
                  <span className="ml-2 text-ink-3">{new Date(g.played_at).toLocaleDateString()}</span>
                </span>
                <span className="tabular text-ink-2">
                  {recentSummary(g)}
                  {g.won !== null && <span className={`ml-2 font-semibold ${g.won ? "text-accent-ink" : "text-ink-3"}`}>{g.won ? "W" : "L"}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-6 mb-2 text-[13px] font-semibold text-accent-ink">Your name</h3>
      <div className="flex gap-2">
        <input className={field} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
        <button
          className="rounded-2xl bg-accent-ink px-5 text-[15px] font-semibold text-white disabled:opacity-40"
          disabled={!name.trim() || name.trim() === user.name}
          onClick={async () => setNameNote((await rename(name)) ?? "Saved")}
        >
          Save
        </button>
      </div>
      {nameNote && <p className="mt-2 text-[13px] text-ink-3">{nameNote}</p>}
      <button className="mt-6 w-full py-2 text-[15px] font-semibold text-[#c0392b]" onClick={() => signOut()}>
        Sign out
      </button>
    </Sheet>
  );
}

/** A short note at the bottom of the phone, with an optional action. */
export function Toast({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-5">
      <div className="panel-ink pointer-events-auto flex items-center gap-4 rounded-full py-2.5 pr-2.5 pl-5 text-[15px] font-semibold">
        {text}
        {action && (
          <button className="rounded-full bg-white px-3.5 py-1.5 text-accent-ink" onClick={onAction}>
            {action}
          </button>
        )}
        {!action && <span className="w-2" />}
      </div>
    </div>
  );
}
