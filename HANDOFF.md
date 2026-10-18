# Handoff (2026-10-18)

For the next Claude Code session. Read `CLAUDE.md` first: it holds the architecture and the conventions that bite. This file covers where the work stopped and what is left.

## Ground rules from the user (still in force)

- Ask before installing packages, changing PATH or system settings, creating env files or external services, changing the database schema, or committing. Read-only checks are fine.
- Secrets go only in `.env.local`. Never put a service_role or secret key in `.env.example`.
- Ask before deleting anything substantial. Keep everything related to the **liquid glass** style (`glassStyle`, the "liquid" set in `Glass.tsx`); it will be built on later.
- SQL migrations are written, never applied. `supabase/migrations/20261017000001_accounts.sql` has never been run.

## Windows dev notes

- `npm run dev` fails on Windows (spawn npx ENOENT). Run `node scripts/dev.mjs` once to make the cert, then from Git Bash:
  `export PATH="/c/Program Files/nodejs:$PATH" && npx next dev -H 0.0.0.0 -p 3000 --experimental-https --experimental-https-key .cert/key.pem --experimental-https-cert .cert/cert.pem`
- The repo is on OneDrive, and its file watcher misses edits. Restart the dev server after big changes.
- Checks: `npm test` (Node's test runner, 30 tests), `npx tsc --noEmit`, `npx eslint .`, `npx next build`. All passed at handoff.
- Nothing has been tested on a real phone this round. All motion checks used synthetic telemetry.

## The task list being worked (from the user)

**Phase 1**
1. Golf and bowling orientation: the player holds the phone comfortably, screen toward them, using zero-offset subtraction and a baseline rotation. **Done:** the rest-pose delta in `Avatar.tsx` (`relQ = handQ * inverse(neutral)`, recaptured via `rig.neutralSeq`), plus the per-game `aimZero` from calibration subtracted from `rig.heading`.
2. Ping pong: camera much closer, with a split view of both players. **Done:** always split, including against the CPU. `closeView` in `PingPongScene.tsx` puts each camera over its player's shoulder, following them. *Tune by eye:* `back` and height in `closeView`.
3. Bigger equipment and more swing leeway. **Done:**
   - `BLADE_RADIUS` 0.13; bowling `BALL_R` 0.125; putter head 0.2 × 0.045 × 0.06;
   - swing windows 500 ms (bowling) and 450 ms (golf); lower minimums (`BOWL_MIN` 1.6, `PUTT_MIN` 0.25);
   - ping pong `MAGNET_PLAYER` 0.4 and `SWING_MIN_PLAYER` 0.5; golf `DROP_DEPTH` 0.85 and `LIP_DEPTH` 0.3.
4. 3D hand movement plus much stronger aim assist. **Done:** `AIM_PULL` 0.8, golf `AIM_SNAP` 0.15, bowling 0.032, hub `STICKY` 1.75.
5. Subtle make/miss feedback. **Done** in an earlier round (`Feedback.tsx` rings, `callout(text, kind)`).

**Phase 2: visual calibration per game.** **Mostly done, not yet run end to end.**
- **Rules** are in `src/lib/game/calibration.ts` (tested); the **runner** is `src/lib/game/calibrating.ts`.
- **Diagrams:** `src/components/CalDiagram.tsx`, animated by the `.cal-*` keyframes in `globals.css`.
- **Flow:** hold diagram → Ready → hold still 1.5 s → the game's action, repeated (3+ reps until consistent, at most 6) → result `rig.games[game] = { swing, aimZero }`.
- **When it starts:** the first time a Motion player enters a game (`host.ts` store subscription), and on Settings → Calibrate, which now runs for the current game only, not in the hub.
- **Next steps:**
  - Run it in the browser: a headless check via `window.__glass.startCalibration(slot, game)` and `confirmReady(slot)`, feeding synthetic swings. Note that `startCalibration` now takes `(slot, game)`, so the old scratch tests that call it with one argument are out of date.
  - Check the phone's calibration screen layout with the diagram.
  - Tune `TARGET_SWING` and `REP_MIN` on a real phone.
  - Ping pong's rep detection uses the blade's forward speed with no grip. Make sure ordinary hand jitter doesn't count as a rep.

**Phase 3**
1. Logo animation: a solid **3 seconds** on every load, and again **every time a player enters or leaves a game**, with the audio cue. **Not started.**
   - Today the splash is pure CSS, about 1.5 s, once per session: `.splash` in `globals.css`, `INTRO_SCRIPT` in `src/components/brand/intro.ts`, `Splash.tsx`, and `chime.ts` for the sound.
   - Plan: make it 3 s, drop the once-per-session sessionStorage gate, and replay it from `enterGame`/`exitToHub` in `src/lib/game/scenes.ts`, for example by remounting Splash with a store counter. Keep `CameraRig`'s `INTRO_OFFSET` in step, and keep the phone's own splash short.
2. Settings re-trigger of calibration. **Done** (phone `Settings.tsx`, laptop `SettingsPanel` in `HostScreen.tsx`).
3. Faint 3D backdrop shapes in the hub. **Done** (`Backdrop` in `Hub.tsx`).

**Phase 4: optimization pass, then a final cleanup pass.** **Not started.**
- **Last measurements:** hub about 184 fps; split ping pong about 90 fps. The split now renders twice every ping pong frame, the CPU match included, so profile that first.
- **Cleanup:** remove the stale "From the hub" style wording; confirm `README.md`/`SETUP.md` match per-game calibration; delete the scratch-only debug paths if unused.

## Guardrail from the user

If a session's limit is near: create a new GitHub branch, push, and summarize. At the very end, do one comprehensive optimization and cleanup pass.
