"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import { view } from "@/lib/game/view";
import { useGameStore } from "@/store/gameStore";

/** On the session's first load the opening shot starts this far back and up, and glides in once the startup animation ends. */
const INTRO_OFFSET = new Vector3(0, 4, 11);

/** Glides the camera to whatever the current scene asked for (lib/game/view.ts). */
export default function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const s = useRef({ pos: new Vector3(), look: new Vector3(), first: true }).current;
  useFrame((_, delta) => {
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 4);
    const { intro, introGlide } = useGameStore.getState();
    if (s.first) {
      s.pos.copy(view.pos);
      s.look.copy(view.look);
      if (introGlide) {
        s.pos.add(INTRO_OFFSET);
        useGameStore.setState({ introGlide: false });
      }
      s.first = false;
    }
    if (intro) {
      // Hold the opening shot under the startup animation.
      camera.position.copy(s.pos);
      camera.lookAt(s.look);
      return;
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
