# Pitfall: Drop-Zone v1 — Build Plan

*Written 2026-08-01 as "Multi-Pitfall"; briefly "Pitfall Retro 8" (cap 8),
then renamed "Pitfall: Drop-Zone" with the cap restored to 16 the same day.
A fun, lightweight re-imagining of the falling-down-the-well pitfall genre
("Deep II: 3D Descent" design in
`retrogradegames/pitfall/multi-pitfall-design.md`), rendered with low-poly
three.js instead of ASCII. Up to 16 players, drop-in multiplayer.*

## Locked decisions

| Question | Decision |
|---|---|
| Camera | Tilted ~30° orthographic 2.5D diorama looking down at the 7x7 grid; the shaft's layers scroll up past the fixed grid plane. Post-playtest (2026-08-01): a perspective chase cam behind/above your avatar is the **default on every load** (toggle via the CHASE CAM / 3D VIEW button; not persisted — chase always wins on startup). Rotate buttons on the screen edges orbit either camera in 90° steps; movement input is remapped so controls stay screen-relative, and the wall behind the camera auto-hides |
| Movement | Discrete grid hops (WASD/arrows), lerp-animated, non-lethal player overlap |
| Descent | Continuous layer stream: obstacle layers rush up at ramping fall speed; every 10 layers = 1 level |
| Architecture | Lightweight server-authoritative: one Node process (HTTP static + `ws`), 20Hz tick, JSON messages. No determinism/replay machinery in v1 |
| Art | Neon-retro low poly: flat-shaded meshes, bright ANSI-like palette on dark shaft, fog-to-black below, CSS scanline overlay |
| v1 scope | Core fall + drop-in: move/dodge, coins/gems, lives, death, personal-depth scoring, session leaderboard, high-score persistence. No shops/items/zone themes |
| Join flow | One always-open session per server; open the URL, type a name, drop in at current depth. First-ever visit shows a QUICK START overlay (movement, survival rules, helper column, camera/rotate buttons); dismissal is remembered in localStorage (`dz-quickstart`) |
| Platforms | Desktop keyboard first; swipe touch controls added 2026-08-01 (same client, `(pointer: coarse)` gates the help text only — swipe always listens) |

## Game rules (v1)

- Grid 7x7. Players hop N/S/E/W, server-validated, ~90ms move cooldown.
- The pit is an endless stream of generated layers. Each layer cell is
  `EMPTY | WALL | HAZARD | COIN | GEM`.
- When a layer crosses the player plane, each player's cell resolves:
  - WALL / HAZARD → lose 1 life, ~2s invulnerability blink. 0 lives → dead.
  - COIN → +10 gold, +10 score. GEM → +50 score. First come (join order) wins
    when players share a tile.
- Fall speed ramps with level (base ~0.8 layers/s, +~0.08/level, capped).
- Layer generation: wall/hazard density ramps with level; carved safe zones
  guarantee reachable gaps every layer.
- Scoring follows the design doc: per level survived +100 depth +500 survival;
  coins ×10; gems ×50. **Depth score derives from `levels_traveled =
  level - join_level`, never from session depth** (the "you only score what you
  survive" fairness rule).
- Death → spectator + session leaderboard; Rejoin = a brand-new run (score 0,
  new join_level) per the anti-abuse rule.
- Session: max 16 active players. When nobody is left alive, the pit resets to
  level 1 for the next joiner.
- High scores persist to `server/highscores.json` (name, score, join level,
  deepest level, traveled, date).

## Architecture

```
server/server.js    CommonJS. One process: HTTP static file server + ws.
                    Owns the tick loop timer, sockets, message routing.
server/game.js      CommonJS. Pure-ish game logic: createGame() → addPlayer,
                    move, tick(dt), snapshots, layer generation, scoring.
shared/const.mjs    ESM (browser-importable; server dynamic-imports it):
                    grid size, speeds, densities, palette, message types.
client/index.html   No build step. Import map → vendored three.js.
client/vendor/      three.module.js pinned at r162 (last WebGL1-fallback
                    release — repo doctrine: real users have old GPUs).
client/session.js   The session seam: ws connect/join/move + change events.
                    UI/renderer only talk to session, so a local-stub or
                    richer transport can swap in later.
client/renderer.js  Ortho diorama camera, per-layer InstancedMeshes (walls/
                    hazards/coins/gems), low-poly player avatars + name
                    sprites, shaft walls, level rings, fog.
client/input.js     Keyboard state → move intents (hold-to-repeat).
client/hud.js       DOM HUD: score/gold/lives/level, player list, join
                    overlay, death screen + leaderboard, toasts.
client/main.js      Boot + render loop + wiring.
test/smoke.test.js  node --test: boots the real server, drives real ws
                    clients: join, snapshots flow, moves apply, pickup and
                    death resolve, drop-in join_level is honored.
```

Dependency tree: `ws` (runtime) + vendored three.js. Nothing else.

## Protocol (JSON over ws)

Client → server: `{t:'join', name}` · `{t:'move', dir:'n'|'s'|'e'|'w'}` ·
`{t:'rejoin', name}`

Server → client:
- `{t:'welcome', id, cfg, depth, players, layers, scores}` — cfg carries grid
  size, layersPerLevel, etc. so client hardcodes nothing.
- `{t:'layers', from, rows}` — append-only stream of generated layers; each
  layer is a 49-char string (`.#^$*`).
- `{t:'snap', depth, speed, players, ev}` — 20Hz. `ev` is this tick's events
  (pickup/hit/death/join/leave/levelup) for HUD toasts and effects.
- `{t:'scores', board}` · `{t:'reject', reason}`

Client renders `displayDepth` by extrapolating snap depth with `speed` and
easing toward corrections — layers scroll smoothly between 20Hz snaps.

## Renderer economics

Visible window ~24 layers × ≤49 cells as small per-layer InstancedMeshes:
a few thousand instances worst case — comfortably WebGL1-class. Layers build
lazily as they enter the window and dispose after passing the plane.

## Deployment (added 2026-08-01, doctrine-conformant same day)

Target: the shared Hetzner box behind **pitfall.kjell.today**, per the
sibling doctrine `multiciv/ops/multi-game-hosting.md` (subdomain per game;
pitfall owns loopback port **8130**, recorded in that doc's port table; never
touch neighbouring games' nginx/systemd/files; `nginx -t` before reload;
reload never restart). An earlier `npm pack` + tarball approach was replaced
the same day to copy the sibling's pattern instead.

`./ssh-deploy.sh` (repo root, mirrors `multiciv/ssh-deploy.sh`): provenance
guard (dirty-tree prompt, `--yes` to skip) → allowlist rsync (`client/
server/ shared/ package*.json` only; `/server/highscores.json` excluded) →
`npm ci --omit=dev` → `systemctl restart pitfall` → deploy guard (`sleep 3` +
`curl 127.0.0.1:8130/healthz` catches crash-loops) → package.json sha1
content check against partial syncs.

`deploy/pitfall.service`: User=kjelloe, WorkingDirectory=/opt/pitfall,
Environment PORT=8130 / HOST=127.0.0.1 /
SCORES_FILE=/opt/pitfall/saves/highscores.json (saves/ is outside the rsync
allowlist so scores survive redeploys), MemoryMax=512M + CPUQuota=50%
(shared-box caps), NoNewPrivileges/PrivateTmp/ProtectSystem/ProtectHome
hardening. `deploy/nginx-pitfall`: server block with the mandatory `/ws`
Upgrade/Connection headers (the `map $connection_upgrade` lives in the
existing multiciv config — do not redeclare). One-time setup steps (unit,
nginx, certbot `--expand` with both names, neighbour check):
`deploy/README.md`.

Server env: `PORT`, `HOST` (loopback bind on the box), `SCORES_FILE`;
`/healthz` returns counts-only JSON (`{ok, players}` — public through
nginx). All covered by test 6 in `test/smoke.test.js` (spawns the real
server process with all three env vars, asserts /healthz and a seeded
scores board).

App-level hardening (2026-08-01, doctrine §6 "app caps alongside systemd
caps"): ws `maxPayload` 1 KB; concurrent-socket cap 64 (`options.maxSockets`,
excess closed 1013); per-socket rate limit 300 msgs / 10 s
(`options.rateMax`, flooders terminated); `sanitizeName` strips
`<>&"'` + backtick on top of the printable-ASCII filter (HUD renders names
via innerHTML — markup must die server-side); V8 heap capped at 384 MB in
the unit's ExecStart, below MemoryMax=512M, so memory pressure means GC not
a cgroup OOM-kill. Covered by test 7 (evil name, 5th socket on a
4-socket server, flooder on a 10-msg limit).

Hosting-specific files are kept OUT of version control (user ruling
2026-08-01): `ssh-deploy.sh`, `deploy.md` (the operator's step-by-step
first-deploy walkthrough) and `deploy/` (unit + nginx reference copies) are
gitignored — they exist only in the local working tree and on the box.

Repo/publication (2026-08-01): public GitHub `kjelloe/pitfall`. Work lands
on the `dev_night` branch (Claude is authorized to commit and push there;
the user handles all merges to `dev`/`main`). Before the branch was first
published, local history containing deploy tooling was squashed away so no
hosting-specific file or ssh detail exists in any pushed commit — keep it
that way: scan `git log --name-only origin/main..HEAD` for deploy paths
before any push.

## Out of scope for v1 (round two candidates)

Shops + items (Shield/Parachute/Magnet), zone themes per 10 levels, sound
(PC-speaker-style WebAudio blips), spectator camera, join codes/multiple
rooms, global leaderboard, seeded/deterministic pits, replays.
(Touch controls landed 2026-08-01: swipe to hop, drag past the threshold to
chain hops, verified by a synthetic-swipe check in `tools/client_smoke.mjs`.
Playtest rounds 2026-08-01 added: a semi-transparent helper column marking
the local player's tile down the shaft; the chase cam, now the default view;
90° view rotation with screen-relative input remapping; and a first-visit
quick-start overlay. The client smoke verifies all of it: quick-start shows
once and never again after reload, chase is default, camera toggles,
rotation remaps a swipe to the correct world direction, and it screenshots
chase, diorama, and rotated views.)
