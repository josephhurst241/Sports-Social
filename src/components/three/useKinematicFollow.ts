"use client";

import { useBeforePhysicsStep, type RapierRigidBody } from "@react-three/rapier";
import { useRef, type RefObject } from "react";
import { Quaternion, Vector3 } from "three";

export const PHYSICS_STEP = 1 / 120;

/**
 * Feeds a kinematicPosition body a target pose that is updated once per
 * rendered frame, spread evenly over the physics substeps of that frame.
 *
 * Rapier derives a kinematic body's velocity from how far it moves in one
 * step. Setting the target once per frame would move the body the whole way
 * in the first substep and not at all in the next, so a paddle would hit the
 * ball at double speed or zero speed depending on which substep made contact.
 *
 * In useFrame: write targetPos/targetQuat, then call commit(delta).
 */
export function useKinematicFollow(body: RefObject<RapierRigidBody | null>) {
  const state = useRef({
    targetPos: new Vector3(),
    targetQuat: new Quaternion(),
    pos: new Vector3(),
    quat: new Quaternion(),
    stepsLeft: 0,
    primed: false,
    commit(delta: number) {
      const rb = body.current;
      if (!rb) return;
      if (!this.primed) {
        // First frame: teleport instead of sweeping in from the origin.
        this.pos.copy(this.targetPos);
        this.quat.copy(this.targetQuat);
        rb.setTranslation(this.pos, true);
        rb.setRotation(this.quat, true);
        this.primed = true;
      }
      this.stepsLeft = Math.max(1, Math.round(Math.min(delta, 0.1) / PHYSICS_STEP));
    },
  }).current;

  useBeforePhysicsStep(() => {
    const rb = body.current;
    if (!rb || state.stepsLeft <= 0) return;
    const f = 1 / state.stepsLeft;
    state.pos.lerp(state.targetPos, f);
    state.quat.slerp(state.targetQuat, f);
    state.stepsLeft--;
    rb.setNextKinematicTranslation(state.pos);
    rb.setNextKinematicRotation(state.quat);
  });

  return state;
}
