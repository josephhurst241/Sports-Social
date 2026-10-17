"use client";

import { useEffect, useState } from "react";
import { BOARDS, loadLeaderboard, type Board, type Period, type RankRow } from "@/lib/account/leaderboard";

// The leaderboard on the phone: pick a game (and for ping pong, wins or win
// rate) and a period; the signed-in player's own row is highlighted, wherever
// they rank. Guests see it too, with a note that signing in gets them on it.

const PICKS: { board: Board; label: string }[] = [
  { board: "bowling", label: "Bowling" },
  { board: "golf", label: "Golf" },
  { board: "pingpong_wins", label: "Ping Pong" },
  { board: "pingpong_rate", label: "Win rate" },
];

export default function Leaderboard({ me }: { me: string | null }) {
  const [board, setBoard] = useState<Board>("bowling");
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<{ key: string; error: string | null; rows: RankRow[] } | null>(null);
  const key = `${board}/${period}`;
  useEffect(() => {
    let live = true;
    loadLeaderboard(board, period).then((r) => live && setData({ key, ...r }));
    return () => {
      live = false;
    };
  }, [board, period, key]);
  const info = BOARDS[board];
  const loading = data?.key !== key;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {PICKS.map((p) => (
          <button
            key={p.board}
            onClick={() => setBoard(p.board)}
            className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold ${board === p.board ? "bg-accent-ink text-white" : "bg-black/[0.06] text-ink-2"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-accent-ink">{info.measure}</div>
        <div className="flex rounded-full bg-black/[0.06] p-0.5 text-[13px] font-semibold">
          {(["week", "all"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded-full px-3 py-1 ${period === p ? "bg-white text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.06)]" : "text-ink-2"}`}>
              {p === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-[15px] text-ink-3">Loading…</p>
      ) : data.error ? (
        <p className="text-[15px] text-[#c0392b]">{data.error}</p>
      ) : data.rows.length === 0 ? (
        <p className="text-[15px] text-ink-2">Nobody on this board yet{period === "week" ? " this week" : ""}.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {data.rows.map((r, i) => (
            <li
              key={r.user_id}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] ${r.is_me ? "bg-accent/30 font-semibold" : ""} ${
                i > 0 && r.rank > data.rows[i - 1].rank + 1 ? "mt-3" : ""
              }`}
            >
              <span className="tabular w-7 text-right text-ink-3">{r.rank}</span>
              <span className="flex-1 truncate">
                {r.name}
                {r.is_me && <span className="ml-1.5 text-[12px] font-semibold text-accent-ink">You</span>}
              </span>
              <span className="tabular font-semibold">{info.format(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
      {!me && <p className="mt-4 rounded-2xl bg-[#f2f2f7] px-4 py-3 text-[15px] text-ink-2">Sign in to be ranked. Guests&apos; games are not saved.</p>}
    </div>
  );
}
