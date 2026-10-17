import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import {
  PACKET_BYTES,
  TELEMETRY_CHANNEL,
  roomPeerId,
  type ClientToHost,
  type HostToClient,
  type PlayerSlot,
} from "./protocol";
import {
  requestRecenter,
  resetTelemetry,
  setPlayer,
  useGameStore,
  writeTelemetry,
} from "@/store/gameStore";

// The laptop. Registers a 4-digit room code with the PeerJS broker, accepts up
// to two phones, and copies their telemetry into the store.

const conns: [DataConnection | null, DataConnection | null] = [null, null];

function randomCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/** Opens a Peer with the given id; resolves null if the id is already taken. */
function openPeer(PeerCtor: typeof Peer, id: string): Promise<Peer | null> {
  return new Promise((resolve, reject) => {
    const peer = new PeerCtor(id, { debug: 0 });
    const onError = (err: { type: string }) => {
      peer.destroy();
      if (err.type === "unavailable-id") resolve(null);
      else reject(err);
    };
    peer.once("open", () => {
      peer.off("error", onError);
      resolve(peer);
    });
    peer.once("error", onError);
  });
}

export function sendToClient(slot: PlayerSlot, msg: HostToClient) {
  const conn = conns[slot];
  if (conn?.open) conn.send(msg);
}

export function broadcast(msg: HostToClient) {
  sendToClient(0, msg);
  sendToClient(1, msg);
}

/** A phone asked to leave the current game (three-finger tap). Set by the scene layer. */
let exitHandler: (() => void) | null = null;
export function onExitRequest(fn: (() => void) | null) {
  exitHandler = fn;
}

/** Starts hosting. Returns a cleanup function. */
export async function startHost(): Promise<() => void> {
  useGameStore.setState({ hostStatus: "opening", hostError: null });
  const { default: PeerCtor } = await import("peerjs");

  let peer: Peer | null = null;
  let code = "";
  try {
    for (let attempt = 0; attempt < 6 && !peer; attempt++) {
      code = randomCode();
      peer = await openPeer(PeerCtor, roomPeerId(code));
    }
  } catch (err) {
    useGameStore.setState({
      hostStatus: "error",
      hostError: `Could not reach the PeerJS broker (${(err as { type?: string }).type ?? "network"}). Check the internet connection.`,
    });
    return () => {};
  }
  if (!peer) {
    useGameStore.setState({ hostStatus: "error", hostError: "No free room code. Reload to try again." });
    return () => {};
  }
  const hostPeer = peer;
  useGameStore.setState({ hostStatus: "ready", roomCode: code });

  hostPeer.on("connection", (conn) => {
    conn.on("open", () => attach(conn));
  });
  // Losing the broker only stops new phones from joining; live peer
  // connections keep working. Re-register so the code stays joinable.
  hostPeer.on("disconnected", () => {
    if (!hostPeer.destroyed) hostPeer.reconnect();
  });
  hostPeer.on("error", (err) => console.warn("[host] peer error", err.type, err));

  return () => {
    conns.forEach((c, i) => {
      c?.close();
      release(i as PlayerSlot, c);
    });
    hostPeer.destroy();
    useGameStore.setState({ hostStatus: "idle", roomCode: null });
  };
}

function release(slot: PlayerSlot, conn: DataConnection | null) {
  if (conns[slot] !== conn) return;
  conns[slot] = null;
  setPlayer(slot, { connected: false, peerId: null });
  resetTelemetry(slot);
}

function attach(conn: DataConnection) {
  const slot = conns[0] === null ? 0 : conns[1] === null ? 1 : null;
  if (slot === null) {
    conn.send({ t: "full" } satisfies HostToClient);
    setTimeout(() => conn.close(), 500);
    return;
  }
  conns[slot] = conn;

  // The host creates its end of the negotiated telemetry channel first, then
  // says "welcome"; the phone only creates its end (and starts sending) after
  // that message arrives, so no packet hits a stream the host has not opened.
  const pc = conn.peerConnection;
  const channel = pc.createDataChannel(TELEMETRY_CHANNEL.label, {
    negotiated: true,
    id: TELEMETRY_CHANNEL.id,
    ordered: TELEMETRY_CHANNEL.ordered,
    maxRetransmits: TELEMETRY_CHANNEL.maxRetransmits,
  });
  channel.binaryType = "arraybuffer";
  channel.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
    if (ev.data.byteLength === PACKET_BYTES) writeTelemetry(slot, new Float32Array(ev.data));
  };

  resetTelemetry(slot);
  setPlayer(slot, { connected: true, peerId: conn.peer });
  conn.send({ t: "welcome", slot } satisfies HostToClient);
  conn.send({ t: "scene", scene: useGameStore.getState().scene } satisfies HostToClient);

  conn.on("data", (raw) => {
    const msg = raw as ClientToHost;
    if (msg?.t === "recenter") requestRecenter(slot);
    else if (msg?.t === "exit") exitHandler?.();
    else if (msg?.t === "input") {
      useGameStore.getState().telemetry[slot].virtual = msg.mode === "buttons";
      const inputModes = [...useGameStore.getState().inputModes] as ["motion" | "buttons", "motion" | "buttons"];
      inputModes[slot] = msg.mode;
      useGameStore.setState({ inputModes });
    }
  });
  const drop = () => {
    channel.close();
    release(slot, conn);
  };
  conn.on("close", drop);
  conn.on("error", drop);
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      conn.close();
      drop();
    }
  });
}
