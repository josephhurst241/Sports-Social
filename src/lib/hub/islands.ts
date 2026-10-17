import { Vector3 } from "three";

// The game islands: abstract floating icons beyond the edge of the central
// disc (radius 14), in an arc in front of the players so the camera behind
// them sees all of them. Angles are from straight ahead (-Z), + to the left.

export type IslandId = "bowling" | "pingpong" | "golf";

export interface Island {
  id: IslandId;
  name: string;
  /** Azimuth in degrees (0 = straight ahead), distance from center, hover height. */
  angle: number;
  radius: number;
  y: number;
  tint: string;
}

export const NEXUS_RADIUS = 14;

export const ISLANDS: Island[] = [
  { id: "bowling", name: "Bowling", angle: 32, radius: 19.5, y: 2.0, tint: "#c9b5ff" },
  { id: "pingpong", name: "Ping Pong", angle: 0, radius: 19.5, y: 2.5, tint: "#8fe8ff" },
  { id: "golf", name: "Golf", angle: -32, radius: 19.5, y: 2.9, tint: "#9dffc0" },
];

export function islandCenter(island: Island, out = new Vector3()) {
  const a = (island.angle * Math.PI) / 180;
  return out.set(-Math.sin(a) * island.radius, island.y, -Math.cos(a) * island.radius);
}

/** Pointing anywhere inside this sphere around an island counts as aiming at it. */
export const ISLAND_HIT_RADIUS = 3.4;
