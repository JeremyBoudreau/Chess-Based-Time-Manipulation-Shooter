# Buckshot Gambit

**You are the black king. You have a shotgun. Time only moves when you move.**

A first-person 3D chess shooter for the browser. It mixes three games I love:

- **Shotgun King**: a lone king with a buckshot shotgun against a white army.
- **FPS Chess**: you stand on the board as a chess piece, with the pieces towering over you.
- **SUPERHOT**: time stops while you stand still, and bullets hang in the air.

White pieces shake and flash red before they act. If you are standing on a square they attack when they act, you die, because the king has one hit point. Otherwise they close in. Kill the white king to win.

## How to play

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move. Time runs while you move. |
| Mouse | Aim. Turning the camera also moves time. |
| Left click | Fire 5 pellets in a flat, wide spread. |
| `R` | Reload. Time runs at full speed for the whole reload. |
| `Esc` | Pause. |

- The gun holds **2 shells**. Up to **6 reserve shells** regenerate over game time.
- Pellets travel 5 squares and hit the first occupied **square** they enter. You cannot shoot over a pawn or between two pieces.
- Red floor tiles show the squares that a shaking piece is about to attack. Don't be standing on one when it acts.

## Stack

Bun · Turborepo · Next.js 16 (App Router) · TypeScript · Effect 4 · Drizzle ORM + SQLite (libSQL) · Better Auth · three.js · shadcn/ui + Tailwind v4 · Ultracite (Biome)

```
apps/web          Next.js app: landing, auth, /play, leaderboard, profile, server actions
packages/core     Pure game rules and simulation, plus the Effect seams (unit tested)
packages/engine   three.js renderer, input, WebAudio, game loop, HUD store
packages/db       Drizzle schema, libSQL client, RunRepository seam
packages/auth     Better Auth config and the Auth seam
packages/ui       shadcn/ui components and theme
```

**Seams.** Every swappable dependency is an Effect `Context.Service` with a `Default` layer: `Rng`, `PieceCatalog`, `Loadout`, `SetupRegistry`, `TimePolicy`, `PieceBrain`, `GameFactory`, `Database`, `RunRepository` and `Auth`. Each app builds exactly one `ManagedRuntime`, so each seam is a singleton. Tests and future features swap layers instead of editing call sites:

- shotgun upgrades and classes go through `Loadout`
- new white armies go through `SetupRegistry`
- roguelike difficulty goes through `PieceCatalog` and `TimePolicy`

## Run locally

Requires [Bun](https://bun.sh) 1.4+.

```bash
bun install
cp apps/web/.env.example apps/web/.env.local   # then set BETTER_AUTH_SECRET (required): openssl rand -base64 32
bun run db:push                                # creates ./buckshot.db (SQLite)
bun run dev                                    # http://localhost:3000
```

Other scripts:

- `bun run test`: core rule and simulation tests
- `bun run typecheck`
- `bun run check`: lint and format check with Ultracite/Biome

## Deploy (Vercel + Turso)

SQLite runs through libSQL. The same code that opens a local `file:` database in dev connects to a hosted [Turso](https://turso.tech) database in production, because a plain SQLite file does not survive serverless deploys.

1. Create a Turso database, then get its URL and a token:
   ```bash
   turso db create buckshot-gambit
   turso db show buckshot-gambit --url
   turso db tokens create buckshot-gambit
   ```
2. Push the schema to it:
   ```bash
   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... bun run db:push
   ```
3. Import the repo in Vercel and set **Root Directory** to `apps/web`. Vercel detects Bun and Turborepo from the lockfile.
4. Set these environment variables:
   - `DATABASE_URL`
   - `DATABASE_AUTH_TOKEN`
   - `BETTER_AUTH_SECRET`: generate with `openssl rand -base64 32`
   - `BETTER_AUTH_URL`: the deployed origin, e.g. `https://buckshot-gambit.vercel.app`
5. Deploy.

## Submission notes

### What works

- **Accounts.** Email and password sign-up, sign-in and sign-out (Better Auth). The callsign is validated on the server. Sign-in sends you back to the page you came from.
- **The game.** All of this is playable in first person:
  - Pieces telegraph by shaking and blinking red, and the squares they threaten glow red.
  - When a piece acts it captures the king if it can. Otherwise it moves to the legal square closest to the king, or makes a random move that leans toward the king.
  - The shotgun fires 5 horizontal pellets in a stratified-random ±24° fan. Pellets travel 10 squares/s with a 5-square range. Hitboxes are whole squares, and a grid traversal stops pellets slipping between pieces.
  - 2 shells loaded, 6 regenerating reserve shells, and a break-action reload.
  - SUPERHOT time: the world only runs while you move, turn or reload, plus a short burst after each shot.
  - Pawns promote to queens. Killing the white king wins.
- **Feel.**
  - Low-poly Staunton pieces rebuilt procedurally from the reference set.
  - Pellets are black slugs with red trails that hang in mid-air while time is stopped.
  - Shatter debris and damage numbers.
  - Synthesized sound, muffled while time is stopped.
  - A **CHECK / MATE** victory chant and a SUPERHOT-style death camera.
- **Persistence.** Finished runs are saved for signed-in players: outcome, game time, real time, kills per piece, accuracy and the piece that killed you. The server decodes each run against a shared schema, checks it for plausibility and rate-limits saves.
- **Leaderboard and profile.** The leaderboard shows the fastest regicides by game time and the players with the most kills. The profile shows win rate, best time, accuracy, nemesis, favourite victim and run history.
- **Checks.** 58 core rule and simulation tests plus 7 repository tests. Strict type-check, Biome lint and `next build` all pass.

### What is incomplete

- Roguelike runs, upgrades, classes and alternative white setups are designed in but not built. They would plug into the `Loadout`, `SetupRegistry`, `PieceCatalog` and `TimePolicy` seams.
- There is no anti-cheat. The client runs the simulation and the server only sanity-checks results. The seeded `Rng` seam would allow a server-side replay of the inputs later.
- Balance has only been tuned lightly. The knobs are in `packages/core/src/config.ts`.
- No mobile or touch controls. The game needs a mouse and keyboard with pointer lock.
- **Deployment:** see [Deploy](#deploy-vercel--turso). It needs a Vercel and Turso account.

### How to run

See [Run locally](#run-locally).
