"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { MeshBasicMaterial, RingGeometry, type Mesh } from "three";
import { SCENE_INKS } from "@/lib/game/theme";
import { useGameStore, type Feedback as Shot } from "@/store/gameStore";

// Make and miss: a quiet ripple on the ground where it happened. A make sends
// out two thin rings in the scene's accent color; a miss, one small grey ring
// that fades quickly. A fixed pool of rings, animated in the frame loop; new
// ones start from the store's `feedback` (set by the games, via feedback()).

const POOL = 6;
/** Ring sizes (radius, m), how long they last (s), and the gap before a make's second ring. */
const MAKE = { from: 0.06, to: 0.7, life: 0.8, second: 0.14 };
const MISS = { from: 0.05, to: 0.28, life: 0.45 };
const MISS_COLOR = "#8e8e93";

interface Ring {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  start: number;
  kind: Shot["kind"];
  active: boolean;
}

export default function Feedback() {
  const r = useMemo(() => {
    const geo = new RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
    const rings: Ring[] = Array.from({ length: POOL }, () => {
      const mat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      return { mesh: null as unknown as Mesh, mat, start: 0, kind: "make" as const, active: false };
    });
    return { geo, rings, next: 0 };
  }, []);
  useEffect(
    () => () => {
      r.geo.dispose();
      r.rings.forEach((x) => x.mat.dispose());
    },
    [r],
  );

  // Start rings when a game reports a make or miss (outside React: no re-render).
  useEffect(() => {
    const spawn = (shot: Shot, delay: number) => {
      const ring = r.rings[r.next];
      r.next = (r.next + 1) % POOL;
      ring.kind = shot.kind;
      ring.start = performance.now() + delay * 1000;
      ring.active = true;
      ring.mesh?.position.set(shot.at[0], shot.at[1] + 0.006, shot.at[2]);
      ring.mat.color.set(shot.kind === "make" ? SCENE_INKS[useGameStore.getState().scene] : MISS_COLOR);
    };
    return useGameStore.subscribe((s, prev) => {
      const shot = s.feedback;
      if (!shot || shot === prev.feedback) return;
      spawn(shot, 0);
      if (shot.kind === "make") spawn(shot, MAKE.second);
    });
  }, [r]);

  useFrame(() => {
    const now = performance.now();
    for (const ring of r.rings) {
      if (!ring.active || !ring.mesh) continue;
      const k = (now - ring.start) / 1000 / (ring.kind === "make" ? MAKE.life : MISS.life);
      if (k < 0) {
        ring.mesh.visible = false;
        continue;
      }
      if (k >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }
      const spec = ring.kind === "make" ? MAKE : MISS;
      const ease = 1 - (1 - k) ** 3;
      ring.mesh.visible = true;
      ring.mesh.scale.setScalar(spec.from + (spec.to - spec.from) * ease);
      ring.mat.opacity = (ring.kind === "make" ? 0.75 : 0.5) * (1 - k);
    }
  });

  return (
    <group>
      {r.rings.map((ring, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) ring.mesh = m;
          }}
          geometry={r.geo}
          material={ring.mat}
          visible={false}
          renderOrder={3}
        />
      ))}
    </group>
  );
}
