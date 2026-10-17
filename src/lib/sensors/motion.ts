import { P, PACKET_FLOATS } from "@/lib/net/protocol";

// Phone sensors -> one reusable telemetry packet.
//
// Orientation: DeviceOrientationEvent alpha/beta/gamma are intrinsic Z-X'-Y''
// Euler angles from the phone's frame (x right, y up the screen, z out of the
// screen) to the earth frame (x east, y north, z up). They are turned into a
// quaternion here, on the phone, so nothing downstream ever touches Euler
// angles. The quaternion is also rotated into three.js world axes (+Y up,
// north = -Z), so the host can apply it to a mesh directly.
//
// Acceleration: DeviceMotionEvent.acceleration is already gravity-free. Some
// Android devices only report accelerationIncludingGravity; for those a
// low-pass filter tracks gravity and is subtracted.

const DEG = Math.PI / 180;
const SQRT_HALF = Math.SQRT1_2;
/** Low-pass weight per sample for the gravity estimate (about 0.3 s at 60 Hz). */
const GRAVITY_LPF = 0.06;

type PermissionFn = () => Promise<"granted" | "denied">;
interface WithPermission {
  requestPermission?: PermissionFn;
}

export interface SensorState {
  /** The packet sent at 60 Hz. Mutated in place; time is stamped at send. */
  packet: Float32Array<ArrayBuffer>;
  hasOrientation: boolean;
  hasMotion: boolean;
}

export function createSensorState(): SensorState {
  const packet = new Float32Array(PACKET_FLOATS);
  packet[P.QW] = 1;
  return { packet, hasOrientation: false, hasMotion: false };
}

/**
 * Must be the first call in a tap handler, before any await: iOS only shows
 * the motion prompt while the user gesture is still active. Both prompts are
 * requested in the same tick (iOS shows a single dialog for the pair). Android
 * and desktop have no requestPermission and resolve true.
 */
export function requestMotionPermission(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const dm = (window.DeviceMotionEvent as unknown as WithPermission | undefined)?.requestPermission;
  const dor = (window.DeviceOrientationEvent as unknown as WithPermission | undefined)?.requestPermission;
  const pending = [dm?.call(window.DeviceMotionEvent), dor?.call(window.DeviceOrientationEvent)].filter(
    (p): p is Promise<"granted" | "denied"> => !!p,
  );
  if (pending.length === 0) return Promise.resolve(true);
  return Promise.all(pending).then(
    (results) => results.every((r) => r === "granted"),
    () => false,
  );
}

/** Writes the quaternion for (alpha, beta, gamma) in degrees into packet[QX..QW]. */
export function writeOrientationQuat(out: Float32Array, alpha: number, beta: number, gamma: number) {
  const cx = Math.cos((beta * DEG) / 2), sx = Math.sin((beta * DEG) / 2);
  const cy = Math.cos((gamma * DEG) / 2), sy = Math.sin((gamma * DEG) / 2);
  const cz = Math.cos((alpha * DEG) / 2), sz = Math.sin((alpha * DEG) / 2);
  // Z-X'-Y'' (W3C DeviceOrientation spec): device -> earth
  const w = cx * cy * cz - sx * sy * sz;
  const x = sx * cy * cz - cx * sy * sz;
  const y = cx * sy * cz + sx * cy * sz;
  const z = cx * cy * sz + sx * sy * cz;
  // Pre-multiply by -90 deg about X: earth (z up, y north) -> three (y up, -z north)
  out[P.QX] = SQRT_HALF * (x - w);
  out[P.QY] = SQRT_HALF * (y + z);
  out[P.QZ] = SQRT_HALF * (z - y);
  out[P.QW] = SQRT_HALF * (w + x);
}

/** Starts the real sensor listeners. Returns a stop function. */
export function startDeviceSensors(state: SensorState): () => void {
  const { packet } = state;
  const gravity = [0, 0, 0];
  let gravityPrimed = false;

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    state.hasOrientation = true;
    writeOrientationQuat(packet, e.alpha, e.beta, e.gamma);
  };

  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) {
      packet[P.AX] = a.x;
      packet[P.AY] = a.y;
      packet[P.AZ] = a.z;
      state.hasMotion = true;
      return;
    }
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    if (!gravityPrimed) {
      gravity[0] = g.x;
      gravity[1] = g.y;
      gravity[2] = g.z;
      gravityPrimed = true;
    }
    gravity[0] += (g.x - gravity[0]) * GRAVITY_LPF;
    gravity[1] += (g.y - gravity[1]) * GRAVITY_LPF;
    gravity[2] += (g.z - gravity[2]) * GRAVITY_LPF;
    packet[P.AX] = g.x - gravity[0];
    packet[P.AY] = g.y - gravity[1];
    packet[P.AZ] = g.z - gravity[2];
    state.hasMotion = true;
  };

  window.addEventListener("deviceorientation", onOrientation);
  window.addEventListener("devicemotion", onMotion);
  return () => {
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("devicemotion", onMotion);
  };
}

/**
 * Desktop stand-in for a phone (open /play?sim=1): moving the mouse over the
 * pad aims the phone; with no input it sweeps by itself, so a headless
 * browser can drive the whole pipeline. Produces the same packet the real
 * sensors do.
 */
export function startSimulatedSensors(state: SensorState, pad: HTMLElement): () => void {
  const { packet } = state;
  state.hasOrientation = true;
  state.hasMotion = true;
  let pointer: { x: number; y: number } | null = null;
  let lastInput = -Infinity;

  const onMove = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
    lastInput = performance.now();
  };
  pad.addEventListener("pointermove", onMove);

  let prevYaw = 0;
  let raf = 0;
  const tick = () => {
    const now = performance.now();
    const idle = now - lastInput > 3000 || !pointer;
    // Phone held like a remote, top toward the screen: the mouse aims it
    // (x = heading, y = up/down); idle, it sweeps from side to side.
    const yaw = idle ? Math.sin(now / 600) * 50 : -(pointer?.x ?? 0) * 70;
    const pitch = idle ? 5 : 20 - (pointer?.y ?? 0) * 40;
    // alpha = heading, beta = tilt of the top up from flat, gamma = 0
    writeOrientationQuat(packet, yaw, pitch, 0);
    // A plausible sideways acceleration from the swing speed (device x axis)
    const yawRate = (yaw - prevYaw) * 60 * DEG;
    prevYaw = yaw;
    packet[P.AX] = -yawRate * 1.5;
    packet[P.AY] = 0;
    packet[P.AZ] = 0;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    pad.removeEventListener("pointermove", onMove);
  };
}
