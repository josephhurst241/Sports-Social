# CLAUDE.md

Sports Social (formerly Glass Motion, Prototype 6): the hub and three
baseline games (ping pong, bowling, golf). Laptop = host (3D scene), phone = motion controller over
WebRTC. Next.js 16 (App Router, Cache Components), React Three Fiber + drei, @react-three/rapier,
PeerJS, Zustand, Tailwind v4, TypeScript.

## Commands

- `npm run dev`: HTTPS dev server on the LAN (`scripts/dev.mjs` makes a self-signed cert for every local IP)
- `npm run play`: production build + server; measure performance here
- `npx tsc --noEmit`, `npx eslint .`: fast checks
- `node scripts/check.mjs --url=<url>`: headless end-to-end check (see README). Uses `window.__glass` from `Stage.tsx`

## Map

- `src/app/page.tsx` laptop, `src/app/play/page.tsx` phone
- `src/components/host/HostScreen.tsx` handshake card, room badge, player chips
- `src/components/controller/ControllerScreen.tsx` connect screen, then the frosted grip pane
- `src/components/three/Stage.tsx` the Canvas, light, shadows, scene switch; `Hub.tsx` the disc, islands, pointing and the zen garden (mirror floor, orbital rings, water droplets); `Avatar.tsx` the avatar and its three arm models; `CameraRig.tsx` glides to `src/lib/game/view.ts`; `Glass.tsx` the two glass materials; `useKinematicFollow.ts` substep-correct kinematic bodies
- `src/components/three/games/` `PingPongScene.tsx` (+ `PingPong.tsx`, CPU player), `Bowling.tsx`, `Golf.tsx`
- `src/lib/game/rig.ts` per-player pose and hooks (`rigs`, `placeRig`, arm modes); `src/lib/game/scenes.ts` enter/exit games
- `src/lib/games/` rules: `pingpong.ts` (arc solver, scoring), `bowling.ts` (10-frame scoring, tested), `golf.ts` (holes, par)
- `src/lib/input/` the CPU's one-button paddle; `src/lib/hub/islands.ts` island layout and hit radius
- `src/lib/net/` PeerJS host/client and the wire protocol; `src/lib/sensors/motion.ts` sensors and the quaternion conversion
- `src/store/gameStore.ts` Zustand: connection state via setState, telemetry mutated in place

## Conventions that bite

- **Telemetry**: one 9-float `Float32Array` (time, linear accel xyz, quaternion xyzw, grip) at 60 Hz on a negotiated `{ ordered: false, maxRetransmits: 0 }` channel. The PeerJS connection itself is `{ reliable: false }` (= ordered: false) and carries only control messages; PeerJS still retransmits on it, so it is not UDP-like, which is why telemetry has its own channel.
- **Telemetry never goes through setState.** It is copied into preallocated arrays and read in `useFrame` via `getState()`.
- **Quaternions are built on the phone** (`writeOrientationQuat`), already in three.js axes (+Y up, north = -Z). Never apply alpha/beta/gamma as Euler angles.
- **iOS motion permission** must be requested as the first statement of the tap handler, before any await.
- **Grip**: `onTouchStart`/`onTouchEnd` on the pane; `onTouchEnd` calls `preventDefault()` so the browser's imitation mouse events cannot re-grip; mouse events only for the desktop test pad.
- **Tone mapping is Khronos PBR Neutral.** The ground plane (y = -0.5) is `toneMapped={false}` so lit areas are exactly the background's #FFFFFF.
- **Glass**: `Glass` (MeshTransmissionMaterial with `transmissionSampler`) for foreground objects, `BackgroundGlass` (native physical transmission) for island slabs. Both sample three's one shared transmission buffer, which only contains opaque objects: glass behind other glass is not refracted. Prototype 3's notes (fill rate, MSAA, tone mapping) apply if the hub grows.
- **Pointing**: the ray runs along the phone's top axis (hold it like a remote). It only aims while the phone is tipped toward the screen (`dir.y < 0.75`), so the upright rest pose never selects anything. Hover goes to the store only on change; selection on the grip's rising edge; a second tap on the selected island calls `enterGame`.
- **Working face**: the side of the phone that "faces forward". In ping pong it is the screen (+Z, held screen toward the table, like a bat); everywhere else the back (-Z, held screen toward you). Calibration (recenter) and `rig.heading` both use it, so a recenter in either pose agrees on which way the laptop is. The CPU's paddle packets carry the same half turn.
- **Arm models** (`rig.arm`): `pointer` (hub: phone = forearm from the elbow along its top edge), `paddle` (ping pong: hand swings around the shoulder by the phone's facing), `pendulum` (bowling, golf: arm hangs from the shoulder along the phone's bottom edge, putter continues along it). Phones report orientation, not position, so every model turns rotation into hand position.
- **Hold, swing, let go** (bowling, golf): power comes from the peak forward speed of the hand (bowling) or putter head (golf) in the last ~0.3 s before the grip is released; the phone's heading (`rig.heading`, where its back points) aims. Too gentle a release cancels instead of rolling.
- **CPU telemetry** is written into slot 1 with `source = "local"`, so the avatar skips phone compass calibration for it.
- **Buttons mode** (`src/lib/input/buttons.ts`, the phone's default): the phone generates ideal motion packets from on-screen buttons, per scene, and sends `{ t: "input", mode: "buttons" }` so the laptop marks its telemetry `virtual` (no compass calibration, like the CPU). The laptop's games are unchanged by it; tune the recipes in `SWINGS` if a game's pace feels off.
- **Ping pong serve toss floats** (gravity x0.35 until hit) so a serve is about when you swing, not a 70 ms window.
- **Golf ball physics**: struck with matching topspin (no skid) and slowed by a constant turf deceleration (`ROLL_DECEL`) plus light damping; a ball over the cup below `CUP_SPEED` drops.
- **State machines advance once**: when a phase change triggers React state that only takes effect next frame (golf's next hole), switch to a holding phase first, or `useFrame` repeats the transition every frame.
- **Shadows**: one directional light with a fixed ±35 m box and a 2048 map covers the whole hub (about 3.4 cm per texel), so nothing clips.
- **Coordinates**: meters, +Y up, avatar faces -Z (away from the camera). Forward for yaw `f` is `(-sin f, 0, -cos f)`.
- **Color signatures**: `src/lib/game/theme.ts` maps each scene to a color. Stage's `Atmosphere` springs the fog (30-90 m, past the hub's islands) and a soft overhead spotlight to a pastel wash of it (`PASTEL`) with `@react-spring/three`, and `SkyDome` (follows the camera) is white overhead and takes the fog color at the horizon. Keep the sky's horizon tied to the fog: a fog color that differs from the sky draws a hard line where the fogged floor meets it.
- **Glass looks**: `glassStyle` in the store, G on the laptop (remembered in localStorage). `Glass.tsx` holds both prop sets, "classic" (the prototype) and "liquid" (clearcoat, thicker lensing, more dispersion; the base to build the liquid-glass look on). Every prop is listed in both sets so switching back resets it.: the host page reads the LAN IP per request with `connection()` inside `<Suspense>` (route segment `dynamic` config is not allowed). `react-hooks/refs`, `immutability` and `set-state-in-effect` are off in `eslint.config.mjs`: they are React Compiler rules, and R3F code mutates scratch objects in the frame loop by design.
- **Frame rate looks capped at 30?** Chrome halves page frame rates on a Mac at low battery; the scene itself renders hundreds of fps uncapped.
