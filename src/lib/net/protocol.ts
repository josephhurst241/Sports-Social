// Wire format shared by the host (laptop) and the client (phone).
//
// Two channels ride on one RTCPeerConnection:
// - the PeerJS DataConnection, opened with { reliable: false } (which PeerJS
//   maps to ordered: false). JSON, for a handful of control messages only
//   (role assignment, recenter). PeerJS still retransmits on this channel, so
//   control messages always arrive, just not necessarily in order.
// - TELEMETRY_CHANNEL: a pre-negotiated channel with ordered: false and
//   maxRetransmits: 0, i.e. real UDP semantics: a lost pose is never resent,
//   the next one (16 ms later) supersedes it. Packets are raw Float32Array
//   bytes at 60 Hz, never JSON.

/** Peer IDs on the public PeerJS broker are global, so namespace the room code. */
export const PEER_ID_PREFIX = "sports-social-v1-";
export const roomPeerId = (code: string) => `${PEER_ID_PREFIX}${code}`;

export const TELEMETRY_CHANNEL = {
  label: "telemetry",
  // Negotiated channels skip in-band setup: both sides create the same id.
  // Auto-assigned ids start at 0/1, so a high id never collides with PeerJS's.
  id: 100,
  ordered: false,
  maxRetransmits: 0,
} as const;

export const SEND_HZ = 60;

/**
 * Telemetry packet: one Float32Array, 9 floats = 36 bytes.
 *
 * The spec listed raw gyro alpha/beta/gamma, but it also requires converting
 * orientation to a quaternion on the phone, so slots 4..7 carry the quaternion
 * (already in three.js world axes: +Y up, -Z = the phone's compass north).
 * Accel is linear acceleration (gravity removed) in the phone's own axes, m/s^2.
 */
export const P = {
  TIME: 0, // performance.now() on the phone, ms. Used to drop stale packets.
  AX: 1,
  AY: 2,
  AZ: 3,
  QX: 4,
  QY: 5,
  QZ: 6,
  QW: 7,
  GRIP: 8, // 0 or 1
} as const;
export const PACKET_FLOATS = 9;
export const PACKET_BYTES = PACKET_FLOATS * 4;

export type PlayerSlot = 0 | 1;
export const PLAYER_COLORS = ["#00FFFF", "#FF00FF"] as const;
export const PLAYER_NAMES = ["Player 1", "Player 2"] as const;

/** Control messages over the PeerJS channel (retransmitted, unordered). */
export type HostToClient =
  | { t: "welcome"; slot: PlayerSlot } // host's telemetry channel exists; start streaming
  | { t: "full" } // both slots taken
  | { t: "scene"; scene: string }; // what the laptop is showing, for the phone's hint

export type ClientToHost =
  | { t: "hello" }
  | { t: "recenter" }
  | { t: "exit" }
  // "buttons": the phone's packets are generated from on-screen buttons, already
  // in the player's frame (no compass heading to zero); "motion": real sensors.
  | { t: "input"; mode: "motion" | "buttons" };
