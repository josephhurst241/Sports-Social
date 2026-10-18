import { create } from "zustand";
import type { CalView } from "@/lib/game/calibration";
import { emptySession, type SessionStats } from "@/lib/games/session";
import type { IslandId } from "@/lib/hub/islands";
import { P, PACKET_FLOATS, PLAYER_NAMES, type GameResult, type PlayerSlot } from "@/lib/net/protocol";

// Two kinds of state live here.
//
// 1. React state (connection status, room code, who is connected): changes a
//    few times per session and drives the UI, so it goes through setState.
//
// 2. Transient telemetry: 60 packets/s per phone. Even setState with
//    selectors would notify every subscriber 120 times a second, so telemetry
//    never goes through it. It lives in preallocated typed arrays that the
//    network layer overwrites in place, and the render loop reads it with
//    getState() inside useFrame. No allocation per packet, no React re-render.

export type SceneId = "hub" | IslandId;

/** A shot that went in (make) or did not (miss), and where. */
export interface Feedback {
  kind: "make" | "miss";
  at: [number, number, number];
  seq: number;
}

export type HostStatus = "idle" | "opening" | "ready" | "error";
export type ClientStatus = "idle" | "permission" | "connecting" | "connected" | "full" | "closed" | "error";

export interface PlayerTelemetry {
  /** Latest packet, copied in place (see P in protocol.ts for the layout). */
  packet: Float32Array;
  /** Phone timestamp of `packet`; older packets are dropped (the channel is unordered). */
  lastTime: number;
  /** Host performance.now() when the last packet arrived; 0 = never. */
  receivedAt: number;
  /** Packets received since the HUD last sampled, for the rate readout (the HUD resets it). */
  count: number;
  /** Packets received ever; never reset. */
  total: number;
  /** Bumped on each recenter request; the avatar re-zeroes its heading when it changes. */
  recenterSeq: number;
  /** "local": written on the laptop (the CPU player), already in the player's frame, no compass to zero. */
  source: "phone" | "local";
  /** The phone is in Buttons mode: its packets are generated, already in the player's frame. */
  virtual: boolean;
}

export interface PlayerConn {
  connected: boolean;
  peerId: string | null;
  /** The phone's signed-in account (or a test name on the sim pad); null for a guest. */
  account: { id: string | null; name: string } | null;
}

interface GameState {
  // Host (laptop)
  hostStatus: HostStatus;
  roomCode: string | null;
  hostError: string | null;
  players: [PlayerConn, PlayerConn];
  /** Each player's motion calibration in progress (lib/game/calibrating.ts), or null. */
  calibration: [CalView | null, CalView | null];
  /** Each player's record this session (memory only; cleared when they leave). */
  session: [SessionStats, SessionStats];
  /** Each phone's input, for the laptop's hints (the per-packet flag lives on telemetry.virtual). */
  inputModes: ["motion" | "buttons", "motion" | "buttons"];

  // Client (phone)
  clientStatus: ClientStatus;
  clientError: string | null;
  mySlot: PlayerSlot | null;

  // Everything below changes a few times a minute at most (on hits, rolls,
  // strokes), never per frame, so it goes through setState.
  scene: SceneId;
  /** The startup animation is up (first load per session): the camera holds back meanwhile. */
  intro: boolean;
  /** First load this session: the camera's first shot starts pulled back and glides in (even if the scene loads after the intro). */
  introGlide: boolean;
  /** The glass look: the prototype's "classic" glass or the glossier "liquid" glass. G on the laptop switches it. */
  glassStyle: "classic" | "liquid";
  /** How much glass the laptop renders, from opaque-ish stand-ins ("off", no transmission pass) to the fullest lensing; see GLASS_LEVELS. */
  glassIntensity: GlassIntensity;
  /** Short message after a point, roll or stroke, with when it was set. */
  callout: { text: string; at: number; kind?: Feedback["kind"] } | null;
  /** Headline moments waiting for their big card (GameStateOverlay), first is showing: whose turn or serve, a strike, a win. */
  announcements: Announcement[];
  /** The latest make or miss, where it happened (world, m): the scene ripples there (Feedback.tsx). */
  feedback: Feedback | null;
  /** Sound effects (the logo's chime, lib/audio/audioManager.ts) on or off: the laptop's Settings (remembered in localStorage). */
  sound: boolean;

  // Hub
  hovered: [IslandId | null, IslandId | null];
  selected: IslandId | null;

  // Ping pong
  pingpong: { score: [number, number]; rally: number; cpu: boolean };
  // Bowling and golf take turns when two phones are in at the start: a whole
  // frame each in bowling, a whole hole each in golf. `players` is how many play.
  // Bowling: each player's rolls (pins knocked), whose turn, and whether every game is done
  bowling: { rolls: [number[], number[]]; turn: PlayerSlot; players: 1 | 2; over: boolean };
  // Golf: the hole, whose turn and their strokes on it so far, each player's finished holes
  golf: { hole: number; turn: PlayerSlot; players: 1 | 2; strokes: number; cards: [number[], number[]]; over: boolean };

  /** Phone side: which scene the laptop is in, for the controller's hint. */
  clientScene: SceneId;
  /** Phone side: whose turn it is in a turn-based game, or null when everyone plays at once. */
  clientTurn: PlayerSlot | null;
  /** Phone side: what each player is called, from the laptop. */
  clientNames: [string, string];
  /** Phone side: this player's calibration in progress, from the laptop. */
  clientCalibration: CalView | null;
  /** Phone side: this player's last finished game, to save to their career. */
  clientResult: { result: GameResult; at: number } | null;

  // Transient: mutated in place, never replaced
  telemetry: [PlayerTelemetry, PlayerTelemetry];
}

const makeTelemetry = (): PlayerTelemetry => {
  const packet = new Float32Array(PACKET_FLOATS);
  packet[P.QW] = 1; // identity quaternion
  return { packet, lastTime: -Infinity, receivedAt: 0, count: 0, total: 0, recenterSeq: 0, source: "phone", virtual: false };
};

export const useGameStore = create<GameState>()(() => ({
  hostStatus: "idle",
  roomCode: null,
  hostError: null,
  players: [
    { connected: false, peerId: null, account: null },
    { connected: false, peerId: null, account: null },
  ],
  calibration: [null, null],
  session: [emptySession(), emptySession()],
  inputModes: ["buttons", "buttons"],
  clientStatus: "idle",
  clientError: null,
  mySlot: null,
  scene: "hub",
  intro: true,
  introGlide: false,
  glassStyle: "liquid",
  glassIntensity: "medium",
  callout: null,
  announcements: [],
  feedback: null,
  sound: true,
  hovered: [null, null],
  selected: null,
  pingpong: { score: [0, 0], rally: 0, cpu: true },
  bowling: { rolls: [[], []], turn: 0, players: 1, over: false },
  golf: { hole: 0, turn: 0, players: 1, strokes: 0, cards: [[], []], over: false },
  clientScene: "hub",
  clientTurn: null,
  clientNames: [PLAYER_NAMES[0], PLAYER_NAMES[1]],
  clientResult: null,
  clientCalibration: null,
  telemetry: [makeTelemetry(), makeTelemetry()],
}));

/** Copies an incoming packet into the slot's buffer. Allocation-free hot path. */
export function writeTelemetry(slot: PlayerSlot, data: Float32Array) {
  const t = useGameStore.getState().telemetry[slot];
  const time = data[P.TIME];
  // Unordered channel: a late packet would yank the hand backwards, so drop it.
  // (A big jump back means the phone reloaded; accept that as a new stream.)
  if (time <= t.lastTime && t.lastTime - time < 5000) return;
  t.packet.set(data);
  t.source = "phone";
  t.lastTime = time;
  t.receivedAt = performance.now();
  t.count++;
  t.total++;
}

export function resetTelemetry(slot: PlayerSlot) {
  const t = useGameStore.getState().telemetry[slot];
  t.packet.fill(0);
  t.packet[P.QW] = 1;
  t.lastTime = -Infinity;
  t.receivedAt = 0;
  t.virtual = false;
}

export function requestRecenter(slot: PlayerSlot) {
  useGameStore.getState().telemetry[slot].recenterSeq++;
}

/** Whose turn it is in the current scene, or null when nobody waits (hub, ping pong). */
export function currentTurn(): PlayerSlot | null {
  const s = useGameStore.getState();
  if (s.scene === "bowling") return s.bowling.turn;
  if (s.scene === "golf") return s.golf.turn;
  return null;
}

/**
 * Who plays after `slot`: the other player when this game has two and they
 * are still connected and not finished, else `slot` again.
 */
export function nextTurn(slot: PlayerSlot, players: 1 | 2, finished: (p: PlayerSlot) => boolean): PlayerSlot {
  const other = (1 - slot) as PlayerSlot;
  return players === 2 && useGameStore.getState().players[other].connected && !finished(other) ? other : slot;
}

/** What to call a player: their account name, else Player 1/2. For callouts and the HUD. */
export function playerName(slot: PlayerSlot) {
  return useGameStore.getState().players[slot].account?.name ?? PLAYER_NAMES[slot];
}

/** Ping pong is always shown split, one half per player (the CPU's too): PingPongScene, HostScreen. */
export const useSplit = () => useGameStore((s) => s.scene === "pingpong");

/** playerName as a React hook, so labels update when a player signs in. */
export const usePlayerName = (slot: PlayerSlot) => useGameStore((s) => s.players[slot].account?.name ?? PLAYER_NAMES[slot]);

export type GlassIntensity = "off" | "mild" | "medium" | "high";
export const GLASS_INTENSITIES: GlassIntensity[] = ["off", "mild", "medium", "high"];

/**
 * What each glass intensity renders (Glass.tsx). "off" draws no glass at all:
 * a tinted, glossy, see-through stand-in with no transmission, so three skips
 * its transmission pass entirely. The others are MeshTransmissionMaterial on
 * the shared buffer: lens thickness, dispersion, blur, index, refraction
 * samples (baked into the shader: every level is compiled up front so
 * switching never stalls), and the shared buffer's resolution as a share of
 * the canvas (the shared sampler has no per-material resolution).
 */
// `ripple` gates the liquid look's costly touch (Glass.tsx): the moving
// ripple, High only (about 6 ms a frame in split ping pong on its own).
export const GLASS_LEVELS = {
  off: { opacity: 0.8, roughness: 0.1 },
  mild: { thickness: 0.1, chromaticAberration: 0, roughness: 0.05, ior: 1.4, samples: 2, buffer: 0.5, ripple: false },
  medium: { thickness: 0.5, chromaticAberration: 0.02, roughness: 0.02, ior: 1.45, samples: 4, buffer: 1, ripple: false },
  high: { thickness: 1.2, chromaticAberration: 0.06, roughness: 0.01, ior: 1.5, samples: 6, buffer: 1, ripple: true },
} as const;

/** A headline moment, as a big card in the middle of the laptop: a few words, and an optional line under them. */
export interface Announcement {
  text: string;
  detail?: string;
  at: number;
}

/**
 * Queues a big card for a headline moment (whose turn or serve, a strike, a
 * win). Rarer than callouts: routine results stay in the callout, and what a
 * card says is not called out again. At most two wait; a third replaces the
 * last, so a burst of events never backs up behind play.
 */
export function announce(text: string, detail?: string) {
  const queue = useGameStore.getState().announcements;
  const next = { text, detail, at: performance.now() };
  useGameStore.setState({ announcements: queue.length >= 2 ? [queue[0], next] : [...queue, next] });
}

/** A short message after a point, roll or stroke; a make or miss gives it a little pop or shake. */
export function callout(text: string, kind?: Feedback["kind"]) {
  useGameStore.setState({ callout: { text, at: performance.now(), kind } });
}

/** A make or a miss, at a point in the world: a quiet ripple there, once. */
export function feedback(kind: Feedback["kind"], x: number, y: number, z: number) {
  useGameStore.setState({ feedback: { kind, at: [x, y, z], seq: (useGameStore.getState().feedback?.seq ?? 0) + 1 } });
}

export function setPlayer(slot: PlayerSlot, conn: PlayerConn) {
  const players = [...useGameStore.getState().players] as GameState["players"];
  players[slot] = conn;
  useGameStore.setState({ players });
}
