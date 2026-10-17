import type { IslandId } from "@/lib/hub/islands";
import { broadcast } from "@/lib/net/host";
import type { PlayerSlot } from "@/lib/net/protocol";
import { narrate } from "@/lib/narrator/events";
import { playerName, useGameStore, type SceneId } from "@/store/gameStore";
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
  const [p1, p2] = [s.players[0].connected, s.players[1].connected];
  const two = p1 && p2 ? 2 : 1;
  // Player 1 goes first, unless only the second phone is still here.
  const first: PlayerSlot = !p1 && p2 ? 1 : 0;
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
    pingpong.deficit = [0, 0];
    pingpong.calledMatchPoint = null;
    useGameStore.setState({ pingpong: { score: [0, 0], rally: 0, cpu: !s.players[1].connected } });
  } else if (id === "bowling") {
    // Two phones in now means two bowlers taking turns, a frame each. The lane places them.
    useGameStore.setState({ bowling: { rolls: [[], []], turn: first, players: two, over: false } });
  } else {
    // Two phones in now means two golfers taking turns, a hole each. The green places them at each tee.
    useGameStore.setState({ golf: { hole: 0, turn: first, players: two, strokes: 0, cards: [[], []], over: false } });
  }
  setScene(id);
  // Who is playing: ping pong is always two (the CPU stands in); bowling and golf are one or two.
  const players =
    id === "pingpong"
      ? `${playerName(0)} and ${p2 ? playerName(1) : "the CPU"}`
      : two === 2
        ? `${playerName(0)} and ${playerName(1)}`
        : playerName(first);
  narrate({ type: "matchStart", game: id, players });
}

export function exitToHub() {
  if (useGameStore.getState().scene === "hub") return;
  placeInHub();
  setScene("hub");
}
