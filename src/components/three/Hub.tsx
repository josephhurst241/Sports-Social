"use client";

import { Html, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import {
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  LatheGeometry,
  MathUtils,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Ray,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
} from "three";
import { ISLANDS, ISLAND_HIT_RADIUS, NEXUS_RADIUS, islandCenter, type Island, type IslandId } from "@/lib/hub/islands";
import { PLAYER_COLORS, type PlayerSlot } from "@/lib/net/protocol";
import { playSound } from "@/lib/audio/audioManager";
import { useGameStore } from "@/store/gameStore";
import { rigs } from "@/lib/game/rig";
import { enterGame } from "@/lib/game/scenes";
import { setView } from "@/lib/game/view";
import { BackgroundGlass, Glass } from "./Glass";

// The hub: a monolithic glass disc the players stand on, and the game islands
// floating beyond its edge. Each player's hand casts a ray along the phone's
// top edge (hold it like a remote, top toward the laptop): the island it hits
// grows, a tap on the phone selects it, and a second tap starts the game.

/** Aim assist: an island already pointed at keeps the aim over this much bigger a sphere. */
const STICKY = 1.75;

/** Icons are modeled at about 2 m across; drawn this much larger so they read from the disc. */
const ISLAND_SCALE = 1.35;

/** The central nexus: a flat glass disc whose top face is y = 0. */
function Nexus() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CylinderCollider args={[0.125, NEXUS_RADIUS]} position={[0, -0.125, 0]} />
      <mesh position={[0, -0.125, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[NEXUS_RADIUS, NEXUS_RADIUS, 0.25, 64]} />
        <Glass tint="#eef9ff" />
      </mesh>
    </RigidBody>
  );
}

// --- Island icons: all procedural primitives, geometry built once per island.

function PingPongIcon({ tint }: { tint: string }) {
  return (
    <group rotation={[0.25, 0, -0.35]}>
      <mesh castShadow rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.75, 0.75, 0.09, 64]} />
        <Glass tint={tint} />
      </mesh>
      <mesh castShadow position={[0, -1.0, 0]}>
        <capsuleGeometry args={[0.11, 0.55, 8, 20]} />
        <Glass tint={tint} />
      </mesh>
      <mesh castShadow position={[0.85, 0.55, 0.35]}>
        <sphereGeometry args={[0.2, 32, 20]} />
        <Glass tint="#ffe27a" />
      </mesh>
    </group>
  );
}

function BowlingIcon({ tint }: { tint: string }) {
  const pin = useMemo(() => {
    // A tenpin profile (radius, height), scaled up to an icon
    const profile: [number, number][] = [
      [0, 0], [0.026, 0], [0.034, 0.01], [0.048, 0.05], [0.06, 0.1], [0.061, 0.13], [0.055, 0.17],
      [0.04, 0.215], [0.028, 0.25], [0.025, 0.27], [0.03, 0.3], [0.034, 0.33], [0.03, 0.36], [0.018, 0.377], [0, 0.38],
    ];
    return new LatheGeometry(profile.map(([r, h]) => new Vector2(r * 4, h * 4)), 48);
  }, []);
  return (
    <group position={[0, -0.75, 0]}>
      <mesh geometry={pin} castShadow position={[-0.3, 0, 0]}>
        <Glass tint="#ffffff" />
      </mesh>
      <mesh castShadow position={[0.55, 0.45, 0.1]}>
        <sphereGeometry args={[0.45, 48, 32]} />
        <Glass tint={tint} />
      </mesh>
    </group>
  );
}

function GolfIcon({ tint }: { tint: string }) {
  return (
    <group position={[0, -0.6, 0]}>
      <mesh castShadow scale={[1, 0.35, 1]}>
        <sphereGeometry args={[0.9, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Glass tint={tint} />
      </mesh>
      <mesh castShadow position={[0.1, 0.95, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 1.9, 12]} />
        <Glass tint="#ffffff" />
      </mesh>
      <mesh castShadow position={[0.42, 1.65, 0]}>
        <boxGeometry args={[0.6, 0.38, 0.04]} />
        <Glass tint="#ff9fd2" />
      </mesh>
      <mesh castShadow position={[-0.45, 0.42, 0.25]}>
        <sphereGeometry args={[0.13, 32, 20]} />
        <Glass tint="#ffffff" />
      </mesh>
    </group>
  );
}

const ICONS: Record<IslandId, (p: { tint: string }) => React.JSX.Element> = {
  pingpong: PingPongIcon,
  bowling: BowlingIcon,
  golf: GolfIcon,
};

function IslandView({ island }: { island: Island }) {
  const group = useRef<Group>(null);
  const icon = useRef<Group>(null);
  const center = useMemo(() => islandCenter(island), [island]);
  const hovered = useGameStore((s) => s.hovered[0] === island.id || s.hovered[1] === island.id);
  const selected = useGameStore((s) => s.selected === island.id);
  // The name tags are DOM overlays, drawn above the page's handshake card, so
  // they only appear once a phone is in and that card is gone.
  const anyone = useGameStore((s) => s.players[0].connected || s.players[1].connected);
  const scale = useRef(1);
  const Icon = ICONS[island.id];

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    // Hover grows the island; selection holds it a little larger still.
    const want = selected ? 1.22 : hovered ? 1.15 : 1;
    scale.current = MathUtils.lerp(scale.current, want, 1 - Math.exp(-delta * 10));
    g.scale.setScalar(scale.current * ISLAND_SCALE);
    g.position.set(center.x, center.y + Math.sin(t * 0.8 + island.angle) * 0.15, center.z);
    if (icon.current) icon.current.rotation.y = t * (hovered ? 0.9 : 0.35);
  });

  return (
    <group ref={group}>
      {/* The island itself: a floating glass slab under the icon */}
      <mesh position={[0, -1.25, 0]} castShadow>
        <cylinderGeometry args={[2.1, 1.7, 0.35, 48]} />
        <BackgroundGlass tint="#f2fbff" />
      </mesh>
      <group ref={icon}>
        <Icon tint={island.tint} />
      </group>
      {anyone && (
        <Html position={[0, -1.85, 0]} center distanceFactor={30} style={{ pointerEvents: "none" }}>
          <div
            className="panel rounded-full px-4 py-1.5 text-[15px] font-semibold whitespace-nowrap transition-colors"
            style={{ color: hovered || selected ? "#000" : "#3c3c43" }}
          >
            {island.name}
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * One player's pointer: a ray from the hand along the phone's top edge,
 * drawn as a thin beam, tested against each island's hit sphere every frame.
 * The hovered island goes into the store only when it changes; a grip (tap)
 * rising edge selects whatever is hovered. Aim assist: the island already
 * hovered holds on over a slightly bigger sphere, so the aim does not flicker
 * off it at the edge. A player being calibrated neither points nor selects.
 */
function Pointer({ slot }: { slot: PlayerSlot }) {
  const beam = useRef<Mesh>(null);
  const dot = useRef<Mesh>(null);
  const s = useMemo(
    () => ({
      ray: new Ray(),
      dir: new Vector3(),
      hit: new Vector3(),
      best: new Vector3(),
      // Hit spheres at each island's rest position (the 0.15 m bob is well inside the radius).
      targets: ISLANDS.map((i) => new Sphere(islandCenter(i), ISLAND_HIT_RADIUS)),
      sticky: ISLANDS.map((i) => new Sphere(islandCenter(i), ISLAND_HIT_RADIUS * STICKY)),
      up: new Vector3(0, 1, 0),
      prevGrip: false,
      geo: new CylinderGeometry(0.012, 0.012, 1, 8).translate(0, 0.5, 0),
    }),
    [],
  );

  useFrame(() => {
    const h = rigs[slot];
    const { hovered, selected, calibration } = useGameStore.getState();
    const b = beam.current;
    const d = dot.current;
    if (!b || !d) return;

    s.dir.set(0, 1, 0).applyQuaternion(h.handQuat);
    // Only aim while the phone is tipped toward the screen, not held upright at rest.
    const aiming = h.live && s.dir.y < 0.75 && !calibration[slot];
    let target: IslandId | null = null;
    let length = 30;
    if (aiming) {
      s.ray.set(h.handPos, s.dir);
      ISLANDS.forEach((island, i) => {
        if (s.ray.intersectSphere(hovered[slot] === island.id ? s.sticky[i] : s.targets[i], s.hit)) {
          const dist = s.hit.distanceTo(h.handPos);
          if (dist < length) {
            length = dist;
            target = island.id;
            s.best.copy(s.hit);
          }
        }
      });
    }

    b.visible = aiming;
    d.visible = aiming && target !== null;
    if (aiming) {
      b.position.copy(h.handPos);
      b.quaternion.setFromUnitVectors(s.up, s.dir);
      b.scale.set(1, length, 1);
      if (target) d.position.copy(s.best);
    }

    if (hovered[slot] !== target) {
      const next = [...hovered] as typeof hovered;
      next[slot] = target;
      useGameStore.setState({ hovered: next });
      if (target) playSound("ui_hover");
    }

    // Tap the phone (grip rising edge): select what you point at, tap it again
    // to play; tapping at nothing clears the selection.
    const grip = h.live && h.grip;
    if (grip && !s.prevGrip && !calibration[slot]) {
      if (target && target === selected) enterGame(target);
      else if (target !== selected) useGameStore.setState({ selected: target });
    }
    s.prevGrip = grip;
  });

  return (
    <>
      <mesh ref={beam} geometry={s.geo} visible={false} renderOrder={2}>
        <meshBasicMaterial color={PLAYER_COLORS[slot]} transparent opacity={0.45} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={dot} visible={false} renderOrder={2}>
        <sphereGeometry args={[0.12, 24, 16]} />
        <meshBasicMaterial color={PLAYER_COLORS[slot]} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

// --- The kinetic zen garden around the disc.

/**
 * Three huge, thin glass rings around the hub. Each starts at its own tilt and
 * tumbles very slowly about an axis through the hub's center (X, Z and Y), so
 * the rings drift across one another.
 */
const RINGS = [
  { radius: 25, tilt: new Euler(Math.PI / 2, 0, 0), axis: new Vector3(1, 0, 0), speed: 0.02 },
  { radius: 30, tilt: new Euler(Math.PI / 2, Math.PI / 3, 0), axis: new Vector3(0, 0, 1), speed: -0.015 },
  { radius: 35, tilt: new Euler(0, Math.PI / 4, 0), axis: new Vector3(0, 1, 0), speed: 0.01 },
];

function OrbitalRings() {
  const rings = useRef<(Mesh | null)[]>([]);
  const s = useMemo(() => ({ base: RINGS.map((r) => new Quaternion().setFromEuler(r.tilt)), spin: new Quaternion() }), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    RINGS.forEach((ring, i) => {
      s.spin.setFromAxisAngle(ring.axis, t * ring.speed);
      rings.current[i]?.quaternion.multiplyQuaternions(s.spin, s.base[i]);
    });
  });
  return (
    <group>
      {RINGS.map((ring, i) => (
        <mesh key={ring.radius} ref={(m) => { rings.current[i] = m; }}>
          <torusGeometry args={[ring.radius, 0.05, 12, 512]} />
          <Glass />
        </mesh>
      ))}
    </group>
  );
}

/** Water droplets hanging in the air around the disc, clear of the islands and players: x, y, z, radius. */
const DROPLETS: [number, number, number, number][] = [
  [-9, 2.2, -6, 0.3],
  [7.5, 3.1, -9, 0.25],
  [-4.5, 4.2, -15, 0.4],
  [12, 1.6, -4, 0.35],
  [-13, 3.4, -2, 0.22],
  [3.5, 1.4, -12, 0.2],
  [-16, 2.6, -11, 0.38],
  [16, 3.8, -11, 0.3],
  [-6, 1.2, 4, 0.28],
  [10, 2.4, 3, 0.24],
];

/**
 * The backdrop: a few large, very faint shapes far out past the islands and
 * the rings (45 to 70 m, inside the fog), turning and drifting slowly. They
 * only lend the sky some depth: one shared pale material, low-poly, no
 * shadows, and the fog fades them further.
 */
const BACKDROP: { shape: "torus" | "ico" | "octa" | "capsule"; at: [number, number, number]; size: number; spin: [number, number] }[] = [
  { shape: "torus", at: [-34, 16, -52], size: 5, spin: [0.05, 0.03] },
  { shape: "ico", at: [26, 20, -58], size: 4.5, spin: [0.03, 0.04] },
  { shape: "octa", at: [-8, 26, -66], size: 4, spin: [0.04, -0.02] },
  { shape: "capsule", at: [44, 11, -40], size: 3.5, spin: [-0.03, 0.05] },
  { shape: "ico", at: [-50, 9, -34], size: 3.5, spin: [0.02, -0.04] },
  { shape: "torus", at: [10, 13, -48], size: 3, spin: [-0.04, 0.02] },
  { shape: "octa", at: [-24, 6, -62], size: 3, spin: [0.03, 0.03] },
  { shape: "capsule", at: [-58, 21, -50], size: 4, spin: [0.02, 0.02] },
  { shape: "ico", at: [56, 25, -60], size: 5, spin: [-0.02, 0.03] },
];

function Backdrop() {
  const groups = useRef<(Group | null)[]>([]);
  const r = useMemo(
    () => ({
      geo: {
        torus: new TorusGeometry(1, 0.32, 16, 48),
        ico: new IcosahedronGeometry(1, 0),
        octa: new OctahedronGeometry(1, 0),
        capsule: new CapsuleGeometry(0.45, 1.1, 6, 16),
      } as Record<(typeof BACKDROP)[number]["shape"], BufferGeometry>,
      mat: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.25, metalness: 0, transparent: true, opacity: 0.08, depthWrite: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(r.geo).forEach((g) => g.dispose());
      r.mat.dispose();
    },
    [r],
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    BACKDROP.forEach((b, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.rotation.set(t * b.spin[0], t * b.spin[1], 0);
      g.position.y = b.at[1] + Math.sin(t * 0.12 + i * 1.9) * 0.8;
    });
  });
  return (
    <group>
      {BACKDROP.map((b, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} position={b.at} scale={b.size * 0.8}>
          <mesh geometry={r.geo[b.shape]} material={r.mat} renderOrder={-1} />
        </group>
      ))}
    </group>
  );
}

function Droplets() {
  const drops = useRef<(Mesh | null)[]>([]);
  // One unit sphere for all of them, scaled to each droplet's size.
  const dropGeo = useMemo(() => new SphereGeometry(1, 32, 20), []);
  useEffect(() => () => dropGeo.dispose(), [dropGeo]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    DROPLETS.forEach(([x, y, z], i) => {
      // Each bobs at its own pace and phase.
      drops.current[i]?.position.set(x, y + Math.sin(t * (0.6 + 0.07 * i) + i * 1.7) * 0.25, z);
    });
  });
  return (
    <group>
      {DROPLETS.map(([x, y, z, r], i) => (
        <mesh key={i} ref={(m) => { drops.current[i] = m; }} position={[x, y, z]} scale={r} geometry={dropGeo} castShadow>
          <Glass ior={1.33} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The hub's shot: behind and above the players, looking out over the islands.
 * Focus: while a player points at (or has picked) an island, the camera leans
 * gently toward it and narrows a little.
 */
function HubView() {
  const s = useMemo(() => ({ centers: Object.fromEntries(ISLANDS.map((i) => [i.id, islandCenter(i)])) as Record<IslandId, Vector3>, look: new Vector3() }), []);
  useFrame(() => {
    const { selected, hovered } = useGameStore.getState();
    const focus = selected ?? hovered[0] ?? hovered[1];
    if (!focus) return setView(0, 3.6, 8.6, 0, 1.7, -8, 42);
    s.look.set(0, 1.7, -8).lerp(s.centers[focus], 0.3);
    setView(s.centers[focus].x * 0.08, 3.5, 8.3, s.look.x, s.look.y, s.look.z, 39);
  });
  return null;
}

export default function Hub({ players }: { players: PlayerSlot[] }) {
  return (
    <>
      <HubView />
      {/* White gallery floor below the glass disc (its top face is y = 0): a
          soft, blurred mirror. Exempt from tone mapping so lit areas are
          exactly the background's white. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[220, 220]} />
        <MeshReflectorMaterial
          blur={[400, 400]}
          mixBlur={1}
          mixStrength={0.2}
          resolution={256}
          mirror={0.5}
          depthScale={1.2}
          color="#ffffff"
          roughness={1}
          toneMapped={false}
        />
      </mesh>
      <Nexus />
      <Backdrop />
      <OrbitalRings />
      <Droplets />
      {ISLANDS.map((island) => (
        <IslandView key={island.id} island={island} />
      ))}
      {players.map((slot) => (
        <Pointer key={slot} slot={slot} />
      ))}
    </>
  );
}
