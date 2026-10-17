# Setting up Sports Social

Everything needed to run the game from a fresh machine, then (optionally)
turn on player accounts, career history and leaderboards. How to play is in
[README.md](README.md).

The game works fully without step 3: players are guests, nothing is saved,
and the account buttons and leaderboards stay hidden.

---

## 1. Install

You need **Node.js 20 or newer** (24 LTS is what this was built on) and, on
Windows, **Git for Windows** (it provides `openssl`, used to make the HTTPS
certificate).

```bash
node -v          # check Node is installed
npm install      # in the project folder
```

On Windows, if `node` is not found, install Node.js LTS from
[nodejs.org](https://nodejs.org) or with `winget install OpenJS.NodeJS.LTS`,
then open a new terminal.

## 2. Run the game

### macOS / Linux

```bash
npm run dev
```

It prints the laptop address (`https://localhost:3000`) and the phone
address (`https://<your LAN IP>:3000/play`).

### Windows

`npm run dev` currently stops with `spawn npx ENOENT` after making the
certificate. Until that script is fixed, run these from **Git Bash** in the
project folder:

```bash
node scripts/dev.mjs     # makes the certificate in .cert/, prints the addresses, then exits with that error
npx next dev -H 0.0.0.0 -p 3000 --experimental-https --experimental-https-key .cert/key.pem --experimental-https-cert .cert/cert.pem
```

Run the first line again whenever your laptop's LAN IP changes (it remakes
the certificate for the new address).

### First connection

1. Open `https://localhost:3000` on the laptop. Accept the certificate
   warning once (Advanced → Proceed). It shows a room code and a QR code.
2. On the phone (same Wi-Fi), scan the QR code, or open
   `https://<laptop LAN IP>:3000/play` and type the code. Accept the
   warning once (iPhone: Show Details → visit this website; Android:
   Advanced → Proceed).
3. Tap **Start**.

**Phone can't connect?**
- Windows Firewall: allow "Node.js" on **private** networks when asked, or in
  Windows Security → Firewall & network protection → Allow an app.
- Some campus and office Wi-Fi blocks device-to-device traffic. A phone
  hotspot works.
- The PeerJS broker (connection setup) needs internet access on both devices.

### Other commands

| Command | What it does |
|---|---|
| `npm run play` | Production build + server at `http://localhost:3000` (best frame rate; phones need HTTPS for Motion mode, Buttons mode works) |
| `npm test` | Unit tests (golf cup model, bowling rules, narrator) |
| `npx tsc --noEmit`, `npx eslint .` | Type check, lint |
| `node scripts/check.mjs --url=<url>` | Headless end-to-end check (expects Chrome at the macOS path; edit the path on Windows) |

### Laptop keys

**R** recenter phones · **Esc** back to the hub · **G** switch the glass
look · **N** mute the narrator (the volume slider is in the footer).
The narrator's voice starts after the first click or key on the laptop page
(browsers block sound until then); until then its lines show as subtitles.

---

## 3. Optional: accounts, career history, leaderboards

Uses [Supabase](https://supabase.com) (free tier is plenty) for sign-in and
the database. About 15 minutes. Players sign in on their **phone**, either
with **Google** or with a **6-digit code emailed to them**.

### 3.1 Create the project

1. Sign up at supabase.com and create a new project. Note the database
   password (you won't need it for the steps below).
2. Wait for it to finish setting up.

### 3.2 Create the tables and functions

In the dashboard, open **SQL Editor** → **New query**, and run these two
files from this repository **in this order** (paste the whole file, Run):

1. `supabase/migrations/20261017000001_accounts.sql`
   (player names, game history, the `record_game` function that checks and
   saves results, career totals)
2. `supabase/migrations/20261017000002_leaderboard.sql`
   (the `leaderboard` function)

Each should finish with "Success. No rows returned". (If you use the
Supabase CLI instead: `supabase link`, then `supabase db push`.)

> These files have not yet been run against a real database. If either
> reports an error, keep the message: it will point at the line to fix.

### 3.3 Connect the app to the project

1. In the dashboard: **Project Settings → API Keys** (or the **Connect**
   button). Copy the **Project URL** and the **publishable key**
   (`sb_publishable_…`; the older **anon** key also works).
2. In the project folder, copy `.env.example` to `.env.local` and fill both in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklm.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   Never put the **secret** / **service_role** key here; the app doesn't
   need it. `.env.local` is ignored by git.
3. Restart the dev server (these values are read at start-up).

### 3.4 Allow the addresses players come back to

**Authentication → URL Configuration:**

- **Site URL:** `https://localhost:3000` (later, your real domain)
- **Redirect URLs**, add each of:
  ```
  https://localhost:3000/**
  https://192.168.*.*:3000/**
  https://10.*.*.*:3000/**
  ```
  The wildcards cover your laptop's LAN address as it changes. If your
  network uses `172.16–31.x.x` addresses, add `https://172.*.*.*:3000/**` too.

### 3.5 Email codes (works on any network, no redirect)

1. **Authentication → Email Templates.** In both **Magic Link** and
   **Confirm signup**, make sure the message includes the code, for example:

   ```html
   <h2>Your Sports Social code</h2>
   <p>Enter this code on your phone: <strong>{{ .Token }}</strong></p>
   ```

   (You can keep the `{{ .ConfirmationURL }}` link too. It only works if it
   is opened in the same browser the player is using to play.)
2. **Sending to other people:** Supabase's built-in email only delivers to
   members of your Supabase team, a few per hour. For friends to sign in,
   set up your own sender under **Project Settings → Authentication → SMTP
   Settings** (Resend, Postmark, SendGrid, or your mail provider all work).

### 3.6 Google sign-in (optional; one tap for players)

1. In [Google Cloud Console](https://console.cloud.google.com): create a
   project → **APIs & Services → OAuth consent screen** (External, add your
   app name and email) → **Credentials → Create credentials → OAuth client
   ID → Web application**.
2. Under **Authorized redirect URIs** add
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (the ref is the part before `.supabase.co` in your Project URL).
3. Copy the **Client ID** and **Client secret** into Supabase:
   **Authentication → Providers (Sign In / Providers) → Google** → enable,
   paste, save.

### 3.7 Check it works

1. Reload the phone page: a **Sign in** button appears under the logo.
2. Sign in with an email code (or Google). The button becomes your name, and
   the laptop's player chip shows it too.
3. Finish a game (any of the three). The phone shows **Saved to your
   career**.
4. Tap your name: **Career** shows the game; **Leaderboard** lists you.
5. On the laptop hub, point at that game's island: its leaderboard appears
   under the logo, with you marked in your player color.

### Good to know

- **Sessions are per address.** A phone signed in at
  `https://192.168.1.20:3000` is signed out if the laptop's address changes
  (sign in again, one tap). On a deployed domain it stays signed in.
- **Guests** play as before; at the end of a game they're offered to sign in.
- **Results are reported by the player's phone.** The database checks every
  score (it re-scores bowling from the rolls, checks golf cards and ping pong
  end scores, and allows at most 60 saves an hour), but a determined player
  could still submit made-up games. Fine among friends; a public competitive
  leaderboard would need the games run on a server.
- **Leaderboards:** bowling best single game; golf best full round vs par;
  ping pong wins vs the CPU, and win rate (5+ games). Each for all time and
  this week (from Monday 00:00 UTC).

### Deploying to a real domain later

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   in the host's environment **before building** (they are built into the
   page).
2. In Supabase, set the **Site URL** to `https://yourdomain` and add
   `https://yourdomain/**` to the redirect URLs.
3. A real certificate on the domain replaces the self-signed one, so no
   warnings on phones.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `spawn npx ENOENT` from `npm run dev` | Windows: use the two commands in **2. Run the game → Windows**. |
| `openssl` not found | Run the commands from Git Bash, or install OpenSSL. |
| Phone stuck on "Connecting…" | Same Wi-Fi? Firewall allows Node.js? Both devices online (for the PeerJS broker)? |
| Motion mode refused | Motion needs the `https://` address and the motion permission; Buttons mode works anywhere. |
| No **Sign in** button on the phone | `.env.local` missing or misspelled, or the dev server wasn't restarted after creating it. |
| "Can't reach the server" in Career or Leaderboard | Check the Project URL in `.env.local` and that the project isn't paused (free projects pause after a week unused; resume it in the dashboard). |
| Google sign-in returns an error about the redirect | Add the address you play on to **Redirect URLs** (3.4). |
| "PKCE code verifier not found" after an email link | The link opened in a different browser than the game. Use the 6-digit code instead. |
| Emails never arrive | Built-in email only reaches your team; set up SMTP (3.5). Check spam. |
| "Not saved: …" after a game | The message says why; a database error usually means a migration (3.2) didn't run fully. |
| An edit doesn't show up while developing | The project is in OneDrive, which can make the file watcher miss changes. Restart the dev server. |
| Frame rate stuck at 30 on a Mac | Chrome halves frame rates on low battery; plug in. |
