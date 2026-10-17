import { Vector3 } from "three";

// Where the camera should be. Each scene writes this every frame (a fixed
// shot, or one that follows the ball); CameraRig glides the real camera to it.
export const view = {
  pos: new Vector3(0, 3.6, 8.6),
  look: new Vector3(0, 1.7, -8),
  fov: 42,
};

export function setView(px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 42) {
  view.pos.set(px, py, pz);
  view.look.set(lx, ly, lz);
  view.fov = fov;
}
