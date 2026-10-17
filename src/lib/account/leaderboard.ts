import { readable, supabase } from "./account";

// Leaderboards, read through the database's leaderboard() function
// (supabase/migrations/20261017000002_leaderboard.sql): the top rows plus the
// caller's own, never the raw games. Works signed out too (the laptop).

export type Board = "bowling" | "golf" | "pingpong_wins" | "pingpong_rate";
export type Period = "all" | "week";

export interface RankRow {
  rank: number;
  user_id: string;
  name: string;
  value: number;
  games: number;
  is_me: boolean;
}

export const BOARDS: Record<Board, { title: string; measure: string; format: (v: number) => string }> = {
  bowling: { title: "Bowling", measure: "Best game", format: (v) => String(v) },
  golf: { title: "Golf", measure: "Best round vs par", format: (v) => (v === 0 ? "E" : v > 0 ? `+${v}` : `−${-v}`) },
  pingpong_wins: { title: "Ping Pong", measure: "Wins vs CPU", format: (v) => String(v) },
  pingpong_rate: { title: "Ping Pong", measure: "Win rate (5+ games)", format: (v) => `${Math.round(v)}%` },
};

/** Which board the hub shows for each game. */
export const HUB_BOARD = { bowling: "bowling", golf: "golf", pingpong: "pingpong_wins" } as const;

export async function loadLeaderboard(board: Board, period: Period, limit = 10): Promise<{ error: string | null; rows: RankRow[] }> {
  const sb = supabase();
  if (!sb) return { error: "Accounts are not set up on this server.", rows: [] };
  const { data, error } = await sb.rpc("leaderboard", { p_board: board, p_period: period, p_limit: limit });
  if (error) return { error: readable(error.message), rows: [] };
  return { error: null, rows: ((data ?? []) as RankRow[]).map((r) => ({ ...r, rank: Number(r.rank), value: Number(r.value), games: Number(r.games) })) };
}
