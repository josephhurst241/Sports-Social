"use client";

import { MeshTransmissionMaterial } from "@react-three/drei";
import { useGameStore } from "@/store/gameStore";

// The glass pipeline. Every glass surface samples three's single shared
// transmission buffer (transmissionSampler), so adding glass objects costs
// one extra scene pass in total, not two per object.
//
// Two looks, switched with G on the laptop (store `glassStyle`): "classic" is
// the prototype's glass; "liquid" is the start of the liquid-glass look (a
// glossy clearcoat, thicker lensing, stronger dispersion, brighter
// reflections). Both list every prop so switching back resets each one.

const FOREGROUND = {
  classic: { transmission: 0.98, roughness: 0.02, thickness: 0.3, chromaticAberration: 0.03, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1 },
  liquid: { transmission: 1, roughness: 0, thickness: 1.2, chromaticAberration: 0.08, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.6 },
};

const BACKGROUND = {
  classic: { transmission: 0.95, roughness: 0.02, thickness: 0.3, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1 },
  liquid: { transmission: 1, roughness: 0, thickness: 1, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.6 },
};

/** Foreground glass: drei's MeshTransmissionMaterial, on the shared buffer. */
export function Glass({ tint = "#ffffff", ior = 1.48 }: { tint?: string; ior?: number }) {
  const style = useGameStore((s) => s.glassStyle);
  return (
    <MeshTransmissionMaterial
      transmissionSampler
      {...FOREGROUND[style]}
      ior={ior}
      anisotropicBlur={0.1}
      samples={4}
      color={tint}
    />
  );
}

/** Background glass: three's native physical transmission, no extra shader work. */
export function BackgroundGlass({ tint = "#ffffff" }: { tint?: string }) {
  const style = useGameStore((s) => s.glassStyle);
  return <meshPhysicalMaterial {...BACKGROUND[style]} ior={1.48} color={tint} />;
}
