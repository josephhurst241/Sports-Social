"use client";

import { Environment } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { animated, useSpring } from "@react-spring/three";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { BackSide, MeshBasicMaterial, NeutralToneMapping, type Mesh } from "three";
import { rigs } from "@/lib/game/rig";
import { useColorTheme } from "@/lib/game/theme";
import { enterGame, exitToHub, placeInHub } from "@/lib/game/scenes";
import { onExitRequest } from "@/lib/net/host";
import type { PlayerSlot } from "@/lib/net/protocol";
import { useGameStore } from "@/store/gameStore";
import Bowling, { bowl } from "./games/Bowling";
import Golf, { golfState } from "./games/Golf";
import PingPongScene from "./games/PingPongScene";
import { endRally, game as pingpong } from "@/lib/games/pingpong";
import { narrate } from "@/lib/narrator/events";
import { narratorState } from "@/lib/narrator/narrator";
import Avatar from "./Avatar";
import CameraRig from "./CameraRig";
import Hub from "./Hub";
import { PHYSICS_STEP } from "./useKinematicFollow";

// The laptop's 3D world: one Canvas and one physics world. The hub (glass
// disc and game islands) and each game are separate scenes, swapped in and
// out by the store's `scene`; the players and the camera carry over.

/** Frame rate, store, game state and the narrator's history on window.__glass, for scripts/check.mjs. */
function DebugHandle() {
  const s = useRef({ frames: 0, since: 0, debug: { fps: 0, store: useGameStore, rigs, bowl, golf: golfState, pingpong, endRally, narrator: narratorState, narrate, enterGame, exitToHub } }).current;
  useEffect(() => {
    (window as unknown as { __glass: typeof s.debug }).__glass = s.debug;
  }, [s]);
  useFrame(() => {
    const now = performance.now();
    s.frames++;
    if (now - s.since >= 1000) {
      s.debug.fps = Math.round((s.frames * 1000) / (now - s.since));
      s.frames = 0;
      s.since = now;
    }
  });
  return null;
}

/**
 * Key light. Its shadow box spans ±35 m, more than any scene, so nothing ever
 * falls outside it and gets clipped.
 */
function Sun() {
  return (
    <directionalLight
      position={[10, 18, 8]}
      intensity={1.3}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-35}
      shadow-camera-right={35}
      shadow-camera-top={35}
      shadow-camera-bottom={-35}
      shadow-camera-near={0.1}
      shadow-camera-far={100}
      shadow-bias={-0.0002}
      shadow-normalBias={0.02}
      // Glass throws a pale shadow, not a black one.
      shadow-intensity={0.45}
    />
  );
}

/**
 * The scene's color signature (lib/game/theme.ts): fog that starts white and
 * springs to the theme color, and a soft overhead spotlight in the same color
 * that tints the floor around the play area. No bloom, no emissive edges.
 */
function Atmosphere() {
  const theme = useColorTheme();
  const { color } = useSpring({ from: { color: "#ffffff" }, to: { color: theme }, config: { duration: 1200 } });
  return (
    <>
      <animated.fog attach="fog" args={["#ffffff", 30, 90]} color={color} />
      <animated.spotLight position={[0, 14, 0]} angle={0.6} penumbra={1} decay={0} intensity={0.8} color={color} />
      <SkyDome />
    </>
  );
}

/**
 * Sky around the camera: white overhead, fading to the fog color at the
 * horizon, so the fogged floor meets the sky without a seam. It takes three's
 * own fog (same color, same color space) and only sets how much by elevation.
 */
function SkyDome() {
  const dome = useRef<Mesh>(null);
  const material = useMemo(() => {
    const m = new MeshBasicMaterial({ color: "#ffffff", side: BackSide, depthWrite: false, toneMapped: false });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vSkyY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkyY = normalize(position).y;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vSkyY;")
        .replace(
          "#include <fog_fragment>",
          "#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - smoothstep(0.0, 0.15, vSkyY));\n#endif",
        );
    };
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => dome.current?.position.copy(camera.position));
  return (
    <mesh ref={dome} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[150, 48, 24]} />
    </mesh>
  );
}

export default function Stage() {
  const scene = useGameStore((s) => s.scene);
  const p2 = useGameStore((s) => s.players[1].connected);
  const cpu = useGameStore((s) => s.pingpong.cpu);

  // Seat the players on the disc at startup and whenever a second phone joins or leaves.
  useEffect(() => {
    if (useGameStore.getState().scene === "hub") placeInHub();
  }, [p2]);

  // A phone's three-finger tap leaves the game.
  useEffect(() => {
    onExitRequest(exitToHub);
    return () => onExitRequest(null);
  }, []);

  const hubPlayers: PlayerSlot[] = p2 ? [0, 1] : [0];
  const showP2 = p2 || (scene === "pingpong" && cpu);

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 3.6, 8.6], fov: 42, near: 0.05, far: 200 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      // Khronos PBR Neutral keeps whites white and the tints true
      // (R3F's default ACES washes bright colors toward white).
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
      }}
    >
      <color attach="background" args={["#ffffff"]} />
      <Atmosphere />
      <CameraRig />
      <DebugHandle />
      <Suspense fallback={null}>
        <Environment preset="studio" />
        <ambientLight intensity={0.2} />
        <Sun />
        <Physics gravity={[0, -9.81, 0]} timeStep={PHYSICS_STEP}>
          {scene === "hub" && <Hub players={hubPlayers} />}
          {scene === "pingpong" && <PingPongScene />}
          {scene === "bowling" && <Bowling />}
          {scene === "golf" && <Golf />}
          <Avatar slot={0} />
          {showP2 && <Avatar slot={1} tint={!p2 ? "#ff7ae0" : undefined} />}
        </Physics>
      </Suspense>
    </Canvas>
  );
}
