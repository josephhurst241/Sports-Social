import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import {
  PACKET_BYTES,
  TELEMETRY_CHANNEL,
  roomPeerId,
  type ClientToHost,
  type HostToClient,
} from "./protocol";
import { useGameStore } from "@/store/gameStore";

// The phone. Joins the host's room and streams telemetry packets.

export interface ClientLink {
  /** Sends one packet. Skips it if the channel is not open or is backed up. */
  send(packet: Float32Array<ArrayBuffer>): void;
  control(msg: ClientToHost): void;
  close(): void;
}

export async function connectToHost(code: string): Promise<ClientLink> {
  useGameStore.setState({ clientStatus: "connecting", clientError: null });
  const { default: PeerCtor } = await import("peerjs");

  const peer: Peer = await new Promise((resolve, reject) => {
    const p = new PeerCtor({ debug: 0 });
    p.once("open", () => resolve(p));
    p.once("error", reject);
  });

  let channel: RTCDataChannel | null = null;
  const conn: DataConnection = peer.connect(roomPeerId(code), {
    reliable: false, // ordered: false; telemetry goes on its own channel below
    serialization: "json",
  });

  const fail = (message: string) => {
    useGameStore.setState({ clientStatus: "error", clientError: message });
  };
  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") fail(`No game is running with code ${code}.`);
    else fail(`Connection error (${err.type}).`);
  });

  conn.on("open", () => conn.send({ t: "hello" } satisfies ClientToHost));
  conn.on("data", (raw) => {
    const msg = raw as HostToClient;
    if (msg.t === "welcome") {
      channel = conn.peerConnection.createDataChannel(TELEMETRY_CHANNEL.label, {
        negotiated: true,
        id: TELEMETRY_CHANNEL.id,
        ordered: TELEMETRY_CHANNEL.ordered,
        maxRetransmits: TELEMETRY_CHANNEL.maxRetransmits,
      });
      channel.binaryType = "arraybuffer";
      useGameStore.setState({ clientStatus: "connected", mySlot: msg.slot });
    } else if (msg.t === "scene") {
      useGameStore.setState({ clientScene: msg.scene as never });
    } else if (msg.t === "turn") {
      useGameStore.setState({ clientTurn: msg.slot });
    } else if (msg.t === "names") {
      useGameStore.setState({ clientNames: msg.names });
    } else if (msg.t === "result") {
      useGameStore.setState({ clientResult: { result: msg.result, at: performance.now() } });
    } else if (msg.t === "full") {
      useGameStore.setState({ clientStatus: "full" });
    }
  });
  conn.on("close", () => {
    const { clientStatus } = useGameStore.getState();
    if (clientStatus !== "error" && clientStatus !== "full") {
      useGameStore.setState({ clientStatus: "closed", mySlot: null });
    }
  });

  return {
    send(packet) {
      // Unreliable channel: if packets queue up (weak Wi-Fi), drop rather than
      // send stale poses late. A few packets of backlog is the most we allow.
      if (channel?.readyState === "open" && channel.bufferedAmount < PACKET_BYTES * 4) {
        channel.send(packet);
      }
    },
    control(msg) {
      if (conn.open) conn.send(msg);
    },
    close() {
      channel?.close();
      conn.close();
      peer.destroy();
    },
  };
}
