import { create } from "zustand";
import type { IslandId } from "@/lib/hub/islands";
import { P, PACKET_FLOATS, type PlayerSlot } from "@/lib/net/protocol";

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
}

interface GameState {
  // Host (laptop)
  hostStatus: HostStatus;
  roomCode: string | null;
  hostError: string | null;
  players: [PlayerConn, PlayerConn];
  /** Each phone's input, for the laptop's hints (the per-packet flag lives on telemetry.virtual). */
  inputModes: ["motion" | "buttons", "motion" | "buttons"];

  // Client (phone)
  clientStatus: ClientStatus;
  clientError: string | null;
  mySlot: PlayerSlot | null;

  // Everything below changes a few times a minute at most (on hits, rolls,
  // strokes), never per frame, so it goes through setState.
  scene: SceneId;
  /** The glass look: the prototype's "classic" glass or the glossier "liquid" glass. G on the laptop switches it. */
  glassStyle: "classic" | "liquid";
  /** Short message after a point, roll or stroke, with when it was set. */
  callout: { text: string; at: number } | null;

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
    { connected: false, peerId: null },
    { connected: false, peerId: null },
  ],
  inputModes: ["buttons", "buttons"],
  clientStatus: "idle",
  clientError: null,
  mySlot: null,
  scene: "hub",
  glassStyle: "classic",
  callout: null,
  hovered: [null, null],
  selected: null,
  pingpong: { score: [0, 0], rally: 0, cpu: true },
  bowling: { rolls: [[], []], turn: 0, players: 1, over: false },
  golf: { hole: 0, turn: 0, players: 1, strokes: 0, cards: [[], []], over: false },
  clientScene: "hub",
  clientTurn: null,
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

export function callout(text: string) {
  useGameStore.setState({ callout: { text, at: performance.now() } });
}

export function setPlayer(slot: PlayerSlot, conn: PlayerConn) {
  const players = [...useGameStore.getState().players] as GameState["players"];
  players[slot] = conn;
  useGameStore.setState({ players });
}
