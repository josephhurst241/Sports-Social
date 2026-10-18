import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import {
  PACKET_BYTES,
  TELEMETRY_CHANNEL,
  roomPeerId,
  NAME_MAX,
  type ClientToHost,
  type GameResult,
  type HostToClient,
  type PlayerSlot,
} from "./protocol";
import { NEUTRAL_SENSITIVITY, cleanSensitivity } from "@/lib/game/calibration";
import { cancelCalibration, confirmReady, resetCalibration, startCalibration } from "@/lib/game/calibrating";
import { rigs } from "@/lib/game/rig";
import { addToSession, emptySession, type SessionStats } from "@/lib/games/session";
import {
  currentTurn,
  playerName,
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

/** A finished game, to the player's phone, which saves it to their career if they are signed in. */
export function sendResult(slot: PlayerSlot, result: GameResult) {
  sendToClient(slot, { t: "result", result });
  // The session record too, for guests and signed-in players alike.
  const session = [...useGameStore.getState().session] as [SessionStats, SessionStats];
  session[slot] = addToSession(session[slot], result);
  useGameStore.setState({ session });
}

/** Wipes a player's session record (they left, or a new phone took the slot). */
function clearSession(slot: PlayerSlot) {
  const session = [...useGameStore.getState().session] as [SessionStats, SessionStats];
  session[slot] = emptySession();
  useGameStore.setState({ session });
}

/** The names everyone sees: account names, else Player 1/2. */
const names = (): [string, string] => [playerName(0), playerName(1)];


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

  // Tell the phones whose turn it is whenever that changes (a turn-based game
  // starts, ends, or passes to the other player), so the waiting one says so.
  // Likewise each player's calibration step, to their own phone; and back in
  // the hub, calibrate anyone who switched to Motion during a game.
  let cal = useGameStore.getState().calibration;
  let scene = useGameStore.getState().scene;
  // Likewise each player's name when someone signs in, joins or leaves.
  let turn = currentTurn();
  let named = names().join("|");
  const stopTurns = useGameStore.subscribe(() => {
    const next = currentTurn();
    if (next !== turn) broadcast({ t: "turn", slot: (turn = next) });
    const st = useGameStore.getState();
    if (st.scene !== scene) {
      scene = st.scene;
      // Each game is calibrated the first time a Motion player enters it; leaving cancels a run.
      for (const slot of [0, 1] as const) {
        cancelCalibration(slot);
        if (scene !== "hub" && st.players[slot].connected && st.inputModes[slot] === "motion" && !rigs[slot].games[scene]) startCalibration(slot, scene);
      }
    }
    const nowCal = useGameStore.getState().calibration;
    if (nowCal !== cal) {
      for (const slot of [0, 1] as const) if (nowCal[slot] !== cal[slot]) sendToClient(slot, { t: "calibration", state: nowCal[slot] });
      cal = nowCal;
    }
    const now = names();
    if (now.join("|") !== named) {
      named = now.join("|");
      broadcast({ t: "names", names: now });
    }
  });

  return () => {
    stopTurns();
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
  setPlayer(slot, { connected: false, peerId: null, account: null });
  clearSession(slot);
  resetCalibration(slot);
  rigs[slot].sens = { ...NEUTRAL_SENSITIVITY };
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
  setPlayer(slot, { connected: true, peerId: conn.peer, account: null });
  clearSession(slot);
  conn.send({ t: "welcome", slot } satisfies HostToClient);
  conn.send({ t: "scene", scene: useGameStore.getState().scene } satisfies HostToClient);
  conn.send({ t: "turn", slot: currentTurn() } satisfies HostToClient);
  conn.send({ t: "names", names: names() } satisfies HostToClient);

  conn.on("data", (raw) => {
    const msg = raw as ClientToHost;
    if (msg?.t === "recenter") requestRecenter(slot);
    else if (msg?.t === "exit") exitHandler?.();
    else if (msg?.t === "input") {
      useGameStore.getState().telemetry[slot].virtual = msg.mode === "buttons";
      const inputModes = [...useGameStore.getState().inputModes] as ["motion" | "buttons", "motion" | "buttons"];
      inputModes[slot] = msg.mode;
      useGameStore.setState({ inputModes });
      // Motion is calibrated the first time it is used in each game; Buttons needs none.
      const scene = useGameStore.getState().scene;
      if (msg.mode === "motion" && scene !== "hub" && !rigs[slot].games[scene]) startCalibration(slot, scene);
      if (msg.mode === "buttons") cancelCalibration(slot);
    } else if (msg?.t === "profile") {
      // Who is on this phone. Names come from another device, so trim and cap them.
      const name = typeof msg.name === "string" ? msg.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
      const account = name ? { id: typeof msg.id === "string" ? msg.id : null, name } : null;
      setPlayer(slot, { ...useGameStore.getState().players[slot], account });
    } else if (msg?.t === "calibrate") {
      // From Settings: calibrate the game this player is in again.
      const scene = useGameStore.getState().scene;
      if (scene !== "hub") startCalibration(slot, scene);
    }
    else if (msg?.t === "calibrate-ready") confirmReady(slot);
    else if (msg?.t === "calibrate-skip") cancelCalibration(slot);
    else if (msg?.t === "sensitivity") rigs[slot].sens = { aim: cleanSensitivity(msg.aim), swing: cleanSensitivity(msg.swing) };
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
