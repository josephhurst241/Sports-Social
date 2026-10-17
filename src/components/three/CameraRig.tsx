"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import { view } from "@/lib/game/view";

/** Glides the camera to whatever the current scene asked for (lib/game/view.ts). */
export default function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const s = useRef({ pos: new Vector3(), look: new Vector3(), first: true }).current;
  useFrame((_, delta) => {
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 4);
    if (s.first) {
      s.pos.copy(view.pos);
      s.look.copy(view.look);
      s.first = false;
    }
    s.pos.lerp(view.pos, k);
    s.look.lerp(view.look, k);
    camera.position.copy(s.pos);
    camera.lookAt(s.look);
    if (Math.abs(camera.fov - view.fov) > 0.01) {
      camera.fov += (view.fov - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
