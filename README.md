# Sports Social

A motion-controlled browser game: the laptop shows a glass hub, your phone is
the controller. Your avatar stands on a glass disc and its hand follows the
phone. Point the phone at a floating island to pick a game: Ping Pong,
Bowling or Golf. Next.js 16, React Three Fiber, Rapier, PeerJS (WebRTC), Zustand.

## Run

First time, or on Windows, or to turn on player accounts:
see **[SETUP.md](SETUP.md)** for the full setup.

```bash
npm install
npm run dev      # HTTPS dev server on your Wi-Fi; phones need HTTPS for motion sensors
npm run play     # optimized build at http://localhost:3000 (desktop testing, best frame rate)
PORT=3005 npm run dev   # either command, on another port
```

1. Open the laptop page. It shows a room code and a QR code.
2. Scan the QR with your phone (or open `https://<laptop IP>:3000/play` and type the code).
   Accept the self-signed certificate warning once.
3. Tap **Start** and allow motion access.
4. In the hub, hold the phone upright, screen toward you: that is the rest pose. Tip and turn it and the hand follows. (In bowling and golf any comfortable grip works.)
5. Point the top of the phone at the laptop like a remote: a beam comes out of the hand. Aim it at an island, tap the phone to select it, tap again to play.

### Buttons or Motion

Switch between them in the phone's **Settings** (the gear, top right). The
first time you use Motion, a 15-second **calibration** tunes aim and swing to
how you move; run it again from Settings.

The phone starts in **Buttons** mode: on-screen controls for each game (aim
with ‹ ›, hold the big button to wind up, let go to swing). It needs no
motion permission and no HTTPS. **Motion** (in Settings, or on the connect screen)
uses the phone's sensors as below. Buttons mode generates the same packets
the sensors would, so the games cannot tell the difference.

### The games (Motion controls)

| Game | Hold the phone | Play |
|---|---|---|
| **Ping Pong** (vs the CPU, or a second phone) | like a paddle, screen facing the table | tap to serve; swing (sweep the screen from facing right to facing left) to hit. You slide to the ball automatically. First to 11. |
| **Bowling** (10 frames) | however is comfortable (your rest pose is taken as you line up) | hold the screen to pick up the ball, swing underhand, let go. Swing speed is pace; turn the phone to angle the shot. |
| **Golf** (3 holes, par 7) | however is comfortable, like a putter grip | hold the screen, swing the putter back and through, let go. Swing speed is power; turn the phone to aim (the line on the green). |

In any game: **three-finger tap** on the phone (or **Esc** on the laptop) goes back to the hub; **two-finger tap** (or **R**) recenters.

On the phone, touching the screen anywhere is the **grip**; a **two-finger tap** recenters.
On the laptop, **R** recenters every phone. A second phone joins as Player 2.

No phone? Open `/play?sim=1&code=<code>` in another browser window: the mouse
aims the stand-in phone (it sweeps by itself when idle; the button is the grip).

Phones and laptop must reach each other on the network. Some campus and
office Wi-Fi blocks device-to-device traffic; a phone hotspot works.

## Check it

`node scripts/check.mjs --url=http://localhost:3000` drives the laptop page
and a simulated phone in headless Chrome and verifies: one room and one peer
connection per side, ~60 Hz binary telemetry, the hand moving and turning,
a real touch registering as the grip, pointing and selecting islands, a
second tap starting a game, and then a bowling roll, golf putts to a holed
ball and the next hole, and a ping pong serve and rally (the game swings are
scripted phone packets written into the laptop's telemetry slot).

## History

This is Glass Motion Prototype 6 (commit `c0ca602` of `~/glass-motion`) under a
new name, moved to Next.js 16. Its git history stays in `~/glass-motion`.
Earlier prototypes are frozen in sibling folders: `~/glass-motion-prototype1` (keyboard ping pong),
`~/glass-motion-prototype2` (walkable glass hub), `~/glass-motion-prototype3`
(big hub, glass, sound), `~/glass-motion-prototype4` (flat core engine). Prototype 5
(the hub alone) is commit `bc5f16f` in `~/glass-motion`. Run one with `npx next dev --turbopack -p <port>` inside it.
