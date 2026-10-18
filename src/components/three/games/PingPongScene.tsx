"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { forwardZ, rightX, rigs } from "@/lib/game/rig";
import type { PlayerSlot } from "@/lib/net/protocol";
import { setView } from "@/lib/game/view";
import { cpuIntent } from "@/lib/input/cpu";
import { makeSwingPaddle, stepSwingPaddle } from "@/lib/input/paddle";
import { game as pingpong } from "@/lib/games/pingpong";
import { useGameStore, useSplit } from "@/store/gameStore";
import Floor from "../Floor";
import PingPong, { TableModel } from "./PingPong";

// Ping pong: Player 1 against the second phone, or against the CPU when
// only one phone is in. Swing like a paddle; tap the screen to serve.

/**
 * The CPU plays through a one-button paddle and writes the same telemetry
 * packet a phone would, into Player 2's slot, so the avatar, physics and
 * rules treat it exactly like a person.
 */
function CpuPlayer() {
  const paddle = useRef(makeSwingPaddle()).current;
  useFrame((_, delta) => {
    const { pingpong, players, telemetry } = useGameStore.getState();
    if (!pingpong.cpu || players[1].connected) return;
    const now = performance.now();
    const intent = cpuIntent(1, now);
    const t = telemetry[1];
    stepSwingPaddle(paddle, intent.held, intent.aim, Math.min(delta, 0.05), t.packet);
    t.source = "local";
    t.lastTime = t.packet[0];
    t.receivedAt = now;
    rigs[1].aim = paddle.aim;
  });
  return null;
}

/**
 * Where a player's half of the split screen looks from: close over their
 * shoulder (behind, above and to their right), following them as they slide
 * along the baseline, looking down the table; a little closer while they
 * serve. Returns the field of view.
 */
function closeView(slot: PlayerSlot, pos: Vector3, look: Vector3) {
  const r = rigs[slot];
  const fz = forwardZ(slot);
  const serving = pingpong.phase === "idle" && pingpong.server === slot;
  const back = serving ? 1.15 : 1.35;
  pos.set(r.root.x + rightX(slot) * 0.55, serving ? 1.9 : 2.05, r.root.z - fz * back);
  look.set(r.root.x * 0.5, 0.85, r.root.z + fz * 3.25);
  return serving ? 54 : 58;
}

/** Player 1's half (the main camera, glided by CameraRig). */
function PingPongView() {
  const s = useMemo(() => ({ pos: new Vector3(), look: new Vector3() }), []);
  useFrame(() => {
    const fov = closeView(0, s.pos, s.look);
    setView(s.pos.x, s.pos.y, s.pos.z, s.look.x, s.look.y, s.look.z, fov);
  });
  return null;
}

/**
 * Split screen: Player 1's view on the left (the main camera, glided by
 * CameraRig) and Player 2's (or the CPU's) on the right, each close over their
 * own shoulder. Takes over rendering (a frame callback with priority 1),
 * drawing the scene once per half.
 */
function SplitView() {
  const get = useThree((s) => s.get);
  const s = useMemo(
    () => ({ cam: new PerspectiveCamera(58, 1, 0.05, 200), pos: new Vector3(), look: new Vector3(), wantPos: new Vector3(), wantLook: new Vector3(), first: true }),
    [],
  );
  // Back to one full-width camera afterwards.
  useEffect(
    () => () => {
      const { camera, size } = get();
      const main = camera as PerspectiveCamera;
      main.aspect = size.width / size.height;
      main.updateProjectionMatrix();
    },
    [get],
  );
  useFrame((state, delta) => {
    const { gl, scene, size } = state;
    const main = state.camera as PerspectiveCamera;
    // Player 2's (or the CPU's) half: the same close view from their end.
    const fov = closeView(1, s.wantPos, s.wantLook);
    const k = s.first ? 1 : 1 - Math.exp(-Math.min(delta, 0.05) * 4);
    s.first = false;
    s.pos.lerp(s.wantPos, k);
    s.look.lerp(s.wantLook, k);
    s.cam.position.copy(s.pos);
    s.cam.lookAt(s.look);
    s.cam.fov += (fov - s.cam.fov) * k;

    const w = Math.floor(size.width / 2), h = size.height;
    main.aspect = s.cam.aspect = w / h;
    main.updateProjectionMatrix();
    s.cam.updateProjectionMatrix();
    // Shadows are the same for both halves: render the shadow map once, for the first.
    const autoShadows = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    gl.setScissorTest(true);
    gl.setViewport(0, 0, w, h);
    gl.setScissor(0, 0, w, h);
    gl.render(scene, main);
    gl.setViewport(w, 0, size.width - w, h);
    gl.setScissor(w, 0, size.width - w, h);
    gl.render(scene, s.cam);
    gl.setScissorTest(false);
    gl.shadowMap.autoUpdate = autoShadows;
    gl.setViewport(0, 0, size.width, size.height);
  }, 1);
  return null;
}

export default function PingPongScene() {
  const split = useSplit();
  return (
    <>
      <PingPongView />
      {split && <SplitView />}
      <Floor />
      <TableModel />
      <PingPong />
      <CpuPlayer />
    </>
  );
}
