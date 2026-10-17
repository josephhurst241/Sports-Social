"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { rigs } from "@/lib/game/rig";
import { setView } from "@/lib/game/view";
import { cpuIntent } from "@/lib/input/cpu";
import { makeSwingPaddle, stepSwingPaddle } from "@/lib/input/paddle";
import { useGameStore } from "@/store/gameStore";
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

/** Broadcast view: behind Player 1, high and a little to the right, so the avatar never hides the table. */
function PingPongView() {
  useFrame(() => setView(1.0, 3.4, 6.2, 0, 0.7, -0.9, 38));
  return null;
}

export default function PingPongScene() {
  return (
    <>
      <PingPongView />
      <Floor />
      <TableModel />
      <PingPong />
      <CpuPlayer />
    </>
  );
}
