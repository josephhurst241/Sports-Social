import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";
import type { GameResult } from "@/lib/net/protocol";

// Player accounts, on the phone (Supabase Auth). Playing needs none: guests
// play as Player 1/2. Signing in is one tap (Google) or an emailed 6-digit
// code, and the session persists in this browser. Without Supabase keys in
// .env.local accounts are simply off and everyone is a guest.
//
// The database side is supabase/migrations/*.sql: profiles (names), games
// (career, written only through record_game) and the career_stats view.

let client: SupabaseClient | null | undefined;

/** The Supabase client, or null when this server has no Supabase keys. */
export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  // Spelled out in full so Next inlines them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client =
    url && key
      ? createBrowserClient(url, key, {
          // The room code rides in the phone's URL as ?code=; never read it as a
          // sign-in code. /auth/callback exchanges sign-in codes explicitly.
          auth: { detectSessionInUrl: false },
        })
      : null;
  return client;
}

export type AccountStatus = "off" | "loading" | "guest" | "signed-in";

export const useAccount = create<{ status: AccountStatus; user: { id: string; name: string; email: string | null } | null }>(() => ({
  status: "loading",
  user: null,
}));

async function loadUser(id: string, email: string | null) {
  const sb = supabase()!;
  const { data } = await sb.from("profiles").select("name").eq("id", id).maybeSingle();
  useAccount.setState({ status: "signed-in", user: { id, email, name: data?.name ?? email?.split("@")[0] ?? "Player" } });
}

/** Restores the session and follows sign-ins and sign-outs. Returns a cleanup. */
export function initAccount() {
  const sb = supabase();
  if (!sb) {
    useAccount.setState({ status: "off", user: null });
    return () => {};
  }
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    const u = session?.user;
    // Outside the callback: Supabase asks that no awaits run inside it.
    setTimeout(() => {
      if (!u) useAccount.setState({ status: "guest", user: null });
      else if (useAccount.getState().user?.id !== u.id) loadUser(u.id, u.email ?? null);
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}

/** Where the browser comes back to after Google, so it returns to this exact page (room code and all). */
function callbackUrl() {
  return `${location.origin}/auth/callback?next=${encodeURIComponent(location.pathname + location.search)}`;
}

export async function signInWithGoogle() {
  const { error } = await supabase()!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
  return error?.message ?? null;
}

/** Emails a 6-digit sign-in code (it also creates the account the first time). */
export async function sendEmailCode(email: string) {
  const { error } = await supabase()!.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: callbackUrl() } });
  return error?.message ?? null;
}

export async function verifyEmailCode(email: string, code: string) {
  const { error } = await supabase()!.auth.verifyOtp({ email, token: code, type: "email" });
  return error?.message ?? null;
}

export async function signOut() {
  await supabase()!.auth.signOut();
}

export async function rename(name: string) {
  const user = useAccount.getState().user;
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 24);
  if (!user || !clean) return "Enter a name.";
  const { error } = await supabase()!.from("profiles").update({ name: clean }).eq("id", user.id);
  if (error) return error.message;
  useAccount.setState({ user: { ...user, name: clean } });
  return null;
}

/** A database error in words a player can act on (a network failure reads as "TypeError: Failed to fetch"). */
export function readable(message: string) {
  return /fetch|network/i.test(message) ? "Can't reach the server. Check the connection and try again." : message;
}

/** Saves a finished game to the signed-in player's career. Null on success, else the reason. */
export async function saveResult(result: GameResult) {
  const { game, ...details } = result;
  const { error } = await supabase()!.rpc("record_game", { p_game: game, p_details: details });
  return error ? readable(error.message) : null;
}

export interface CareerRow {
  game: GameResult["game"];
  played: number;
  wins: number;
  best: number | null;
  average: number | null;
}
export interface RecentGame {
  id: number;
  game: GameResult["game"];
  played_at: string;
  score: number;
  won: boolean | null;
  details: Record<string, unknown>;
}

/** The signed-in player's totals per game and their latest games. */
export async function loadCareer() {
  const sb = supabase()!;
  const [stats, recent] = await Promise.all([
    sb.from("career_stats").select("game, played, wins, best, average"),
    sb.from("games").select("id, game, played_at, score, won, details").order("played_at", { ascending: false }).limit(10),
  ]);
  const failed = stats.error?.message ?? recent.error?.message;
  const error = failed ? readable(failed) : null;
  return { error, stats: (stats.data ?? []) as CareerRow[], recent: (recent.data ?? []) as RecentGame[] };
}
