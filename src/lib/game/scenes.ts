import type { IslandId } from "@/lib/hub/islands";
import { broadcast } from "@/lib/net/host";
import type { PlayerSlot } from "@/lib/net/protocol";
import { useGameStore, type SceneId } from "@/store/gameStore";
import { PLAYER_Z, game as pingpong } from "@/lib/games/pingpong";
import { placeRig, rigs } from "./rig";

// Switching between the hub and the three games. Each scene owns its own
// world (mounted by Stage) and places the players itself here.

/** Where players stand on the hub's nexus disc (its top face is y = 0; avatars stand at 0.15). */
const HUB_Y = 0.15;
export function placeInHub() {
  const two = useGameStore.getState().players[1].connected;
  placeRig(0, two ? -0.8 : 0, HUB_Y, 0, 0, "pointer");
  placeRig(1, 0.8, HUB_Y, 0, 0, "pointer");
}

function setScene(scene: SceneId) {
  useGameStore.setState({ scene, callout: null, selected: null, hovered: [null, null] });
  broadcast({ t: "scene", scene });
}

export function enterGame(id: IslandId) {
  const s = useGameStore.getState();
  if (id === "pingpong") {
    // Player 1 at the near end, the second phone (or the CPU) at the far end.
    placeRig(0, 0, 0, PLAYER_Z, 0, "paddle");
    placeRig(1 as PlayerSlot, 0, 0, -PLAYER_Z, Math.PI, "paddle");
    // At the table, both players slide along their baseline to meet the ball.
    rigs[0].slide = rigs[1].slide = true;
    pingpong.phase = "idle";
    pingpong.phaseAt = performance.now();
    pingpong.server = 0;
    pingpong.pointsPlayed = 0;
    useGameStore.setState({ pingpong: { score: [0, 0], rally: 0, cpu: !s.players[1].connected } });
  } else if (id === "bowling") {
    // The ball hangs 0.24 m right of the bowler's center: stand there so it leaves mid-lane.
    placeRig(0, -0.24, 0, 0.9, 0, "pendulum");
    placeRig(1, 2.4, 0, 1.6, 0, "pendulum");
    useGameStore.setState({ bowling: { rolls: [], over: false } });
  } else {
    useGameStore.setState({ golf: { hole: 0, strokes: 0, card: [], over: false } });
    // The golf scene places the players at each tee.
  }
  setScene(id);
}

export function exitToHub() {
  if (useGameStore.getState().scene === "hub") return;
  placeInHub();
  setScene("hub");
}
