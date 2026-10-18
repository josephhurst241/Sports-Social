"use client";

import { MeshTransmissionMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, type Material, type Mesh, type Object3D } from "three";
import { GLASS_INTENSITIES, GLASS_LEVELS, useGameStore, type GlassIntensity } from "@/store/gameStore";

// The glass pipeline. Every glass surface samples three's single shared
// transmission buffer (transmissionSampler), so adding glass objects costs
// one extra scene pass in total, not two per object. One component per kind
// (Glass, BackgroundGlass) is used everywhere, so every surface of a kind
// shares one compiled shader per look and intensity.
//
// Two settings shape it, both on the laptop:
// - the look (`glassStyle`, G; liquid by default): "classic" is the
//   prototype's glass; "liquid" is the liquid-glass look: clear and light
//   (tints washed toward white, so the scene shows through), twice the
//   lensing under a soft glossy coat, a faint iridescent sheen, and rims
//   kept soft (gentle dispersion, a little refraction blur); at High, a slow
//   ripple through the refraction (drei's temporal distortion);
// - the intensity (`glassIntensity`, the segmented control): how much glass
//   is rendered (GLASS_LEVELS in the store). "off" swaps every glass for a
//   tinted, glossy stand-in with no transmission, so three skips the
//   transmission pass altogether.
// Both list every prop they set, so switching back resets each one.
//
// Switching never stalls: every glass mesh keeps a material for each
// intensity (attached to its own slot on the mesh, so none is ever disposed
// and its compiled shader is kept), and a switch only repoints mesh.material
// (GlassPipeline). The pipeline also draws two frames of each intensity
// whenever new glass mounts (a scene loads, or a piece of it a moment
// later), so every render pass (the screen, three's transmission pass, the
// hub's mirror) has compiled each one for the new meshes before anyone
// switches.

// `lens` scales the level's thickness, `prism` its dispersion, `soften` adds
// to its roughness (a blurrier, gentler refraction at the rims), and
// `clear` washes the tint toward white (more of the scene shows through).
const FOREGROUND = {
  classic: {
    transmission: 0.98, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1, iridescence: 0, anisotropicBlur: 0.1,
    distortion: 0, distortionScale: 0, temporalDistortion: 0, lens: 1, prism: 1, soften: 0, clear: 0,
  },
  liquid: {
    transmission: 1, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 1.5, iridescence: 0.3, anisotropicBlur: 0.3,
    distortion: 0.3, distortionScale: 0.4, temporalDistortion: 0.1, lens: 2, prism: 1.2, soften: 0.04, clear: 0.5,
  },
};

const BACKGROUND = {
  classic: { transmission: 0.95, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1, iridescence: 0, lens: 1, soften: 0, clear: 0 },
  liquid: { transmission: 1, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 1.4, iridescence: 0.2, lens: 1.5, soften: 0.03, clear: 0.4 },
};

const WHITE = new Color("#ffffff");
/** The tint washed `clear` of the way to white. */
const cleared = (tint: string, clear: number) => (clear ? `#${new Color(tint).lerp(WHITE, clear).getHexString()}` : tint);
/** The iridescent film's thickness range (nm): a soft sheen rather than an oil slick. */
const FILM: [number, number] = [120, 380];

type Style = keyof typeof FOREGROUND;
type Level = Exclude<GlassIntensity, "off">;
const LEVELS: Level[] = ["mild", "medium", "high"];

/**
 * drei builds the shader in onBeforeCompile, and three keys programs by that
 * function's source text, where the sample count is not visible: without
 * this, every sample count would share whichever program compiled first.
 */
const PROGRAM_KEYS: Record<number, () => string> = {};
const programKey = (samples: number) => (PROGRAM_KEYS[samples] ??= () => `mesh-transmission-${samples}`);

type Slots = Partial<Record<GlassIntensity, Material>>;
const slots = (mesh: Object3D) => (mesh.userData.glass ??= {}) as Slots;
/** Set when a glass material attaches (a mesh mounted): GlassPipeline warms every intensity up for it. */
let unwarmed = true;

/** Attaches a material to its intensity's slot on the mesh, and as the mesh's material if that intensity is on. */
const ATTACH = Object.fromEntries(
  GLASS_INTENSITIES.map((level) => [
    level,
    (mesh: Mesh, material: Material) => {
      const own = slots(mesh);
      own[level] = material;
      unwarmed = true;
      if (useGameStore.getState().glassIntensity === level) mesh.material = material;
      return () => {
        if (own[level] === material) delete own[level];
      };
    },
  ]),
) as Record<GlassIntensity, (mesh: Mesh, material: Material) => () => void>;

/**
 * Turns frustum culling off on every glass mesh while the pipeline warms up,
 * so glass the camera is not looking at yet (it is still gliding in) is
 * drawn, and so compiled, in every pass; then back to each mesh's own.
 */
function cullGlass(scene: Object3D, cull: boolean) {
  scene.traverse((o) => {
    if (!o.userData.glass) return;
    if (!cull) o.userData.culled ??= o.frustumCulled;
    o.frustumCulled = cull ? (o.userData.culled ?? true) : false;
  });
}

/** Points every glass mesh in the scene at its material for `level`. */
function showLevel(scene: Object3D, level: GlassIntensity) {
  scene.traverse((o) => {
    const m = (o.userData.glass as Slots | undefined)?.[level];
    if (m) (o as Mesh).material = m;
  });
}

/** The "off" stand-in: glossy, tinted, see-through, no transmission. */
function OffGlass({ tint }: { tint: string }) {
  const { opacity, roughness } = GLASS_LEVELS.off;
  return <meshPhysicalMaterial attach={ATTACH.off} transparent opacity={opacity} transmission={0} roughness={roughness} thickness={0} clearcoat={0} color={tint} />;
}

/**
 * Large or thin pieces (the hub disc, the table top, the rings) keep the
 * look's sheen, not its ripple, extra lensing or refraction blur (which is
 * noise-sampled): across a big surface those read as smudges or grain.
 * Thin ones lose the clearcoat too: a mirror-sharp coat on a 5 cm tube
 * aliases into beads.
 */
const SURFACE = { lens: 1, distortion: 0, temporalDistortion: 0, anisotropicBlur: 0.1, soften: 0 };
type Surface = "large" | "thin";

function Transmission({ style, level, tint, ior, surface }: { style: Style; level: Level; tint: string; ior?: number; surface?: Surface }) {
  const { lens: full, prism, soften, clear, ...look } = FOREGROUND[style];
  const lens = surface ? Math.min(full, SURFACE.lens) : full;
  const l = GLASS_LEVELS[level];
  const ripple = l.ripple && !surface;
  const color = useMemo(() => cleared(tint, clear), [tint, clear]);
  return (
    <MeshTransmissionMaterial
      attach={ATTACH[level]}
      transmissionSampler
      {...look}
      samples={l.samples}
      customProgramCacheKey={programKey(l.samples)}
      thickness={l.thickness * lens}
      chromaticAberration={l.chromaticAberration * prism}
      roughness={l.roughness + (surface ? SURFACE.soften : soften)}
      ior={ior ?? l.ior}
      distortion={ripple ? look.distortion : SURFACE.distortion}
      temporalDistortion={ripple ? look.temporalDistortion : SURFACE.temporalDistortion}
      clearcoat={surface === "thin" ? 0 : look.clearcoat}
      anisotropicBlur={surface ? SURFACE.anisotropicBlur : look.anisotropicBlur}
      iridescenceThicknessRange={FILM}
      color={color}
    />
  );
}

function Physical({ style, level, tint }: { style: Style; level: Level; tint: string }) {
  const { lens, soften, clear, ...look } = BACKGROUND[style];
  const l = GLASS_LEVELS[level];
  const color = useMemo(() => cleared(tint, clear), [tint, clear]);
  return (
    <meshPhysicalMaterial
      attach={ATTACH[level]}
      {...look}
      thickness={l.thickness * lens}
      roughness={l.roughness + soften}
      ior={l.ior}
      iridescenceThicknessRange={FILM}
      color={color}
    />
  );
}

/**
 * Foreground glass: drei's MeshTransmissionMaterial, on the shared buffer.
 * `ior` overrides the level's (water is 1.33); `surface` marks a large or
 * thin piece (see SURFACE).
 */
export function Glass({ tint = "#ffffff", ior, surface }: { tint?: string; ior?: number; surface?: Surface }) {
  const style = useGameStore((s) => s.glassStyle);
  return (
    <>
      <OffGlass tint={tint} />
      {LEVELS.map((level) => (
        <Transmission key={level} style={style} level={level} tint={tint} ior={ior} surface={surface} />
      ))}
    </>
  );
}

/** Background glass: three's native physical transmission, no extra shader work. */
export function BackgroundGlass({ tint = "#ffffff" }: { tint?: string }) {
  const style = useGameStore((s) => s.glassStyle);
  return (
    <>
      <OffGlass tint={tint} />
      {LEVELS.map((level) => (
        <Physical key={level} style={style} level={level} tint={tint} />
      ))}
    </>
  );
}

/**
 * Applies the intensity: repoints every glass mesh at its material for it
 * and sizes the shared transmission buffer. Whenever new glass mounts it
 * draws two frames with each intensity (seven frames, during the camera's
 * glide in, when the new scene compiles anyway), so all of them are compiled
 * in every render pass: the hub mirror renders in its own frame callback,
 * which after a remount runs a frame behind this one. Mount it once, inside the Suspense that holds the
 * environment, so that has loaded.
 */
export function GlassPipeline() {
  const gl = useThree((s) => s.gl);
  const world = useThree((s) => s.scene);
  const level = useGameStore((s) => s.glassIntensity);
  /** Intensities still to draw once for newly mounted glass, the chosen one last. */
  const warm = useRef<GlassIntensity[] | null>(null);

  useEffect(() => {
    gl.transmissionResolutionScale = level === "off" ? 1 : GLASS_LEVELS[level].buffer;
    showLevel(world, level);
  }, [gl, world, level]);

  // Each other intensity for two frames, then the chosen one.
  useFrame(() => {
    if (unwarmed && !warm.current?.length) {
      unwarmed = false;
      const chosen = useGameStore.getState().glassIntensity;
      warm.current = [...GLASS_INTENSITIES.filter((l) => l !== chosen).flatMap((l) => [l, l]), chosen];
    }
    const queue = warm.current;
    if (!queue?.length) return;
    const next = queue.shift()!;
    cullGlass(world, !queue.length);
    showLevel(world, queue.length ? next : useGameStore.getState().glassIntensity);
  });

  return null;
}
