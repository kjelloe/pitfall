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
| Platforms | Desktop keyboard first; swipe touch controls added 2026-08-01 (same client — swipe always listens). Mobile pass same day: responsive HUD at ≤600px/≤360px, and `(pointer: coarse)` gates the help text, swipe-first quick-start wording and thumb-height rotate buttons. Verified via `tools/mobile_smoke.mjs` phone emulation |

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
`{t:'rejoin', name}` · `{t:'reclaim', token}`

Server → client:
- `{t:'welcome', id, cfg, depth, players, layers, scores}` — cfg carries grid
  size, layersPerLevel, etc. so client hardcodes nothing.
- `{t:'layers', from, rows}` — append-only stream of generated layers; each
  layer is a 49-char string (`.#^$*`).
- `{t:'snap', depth, speed, players, ev}` — 20Hz. `ev` is this tick's events
  (pickup/hit/death/join/leave/levelup) for HUD toasts and effects.
- `{t:'joined', id, token, entry?}` — token reclaims the seat on any later
  socket; `entry` present when reclaiming a seat that died while away.
- `{t:'scores', board}` · `{t:'reject', reason}` · `{t:'reclaim', ok:false}`
  (unknown/expired token — client clears it and shows the join screen)

Client renders `displayDepth` by extrapolating snap depth with `speed` and
easing toward corrections — layers scroll smoothly between 20Hz snaps.

## Connection resilience (2026-08-01, from playtest A)

Adopted RetroMultiCiv's model (their write-up, adapted to a realtime
faller): **presence is a server-side fact with a timeout; the socket is a
disposable transport**. Mobile browsers kill backgrounded sockets (1006, no
handshake) — that is a normal event, not an error path.

- **Seat grace**: a dropped socket does not free the seat. It is marked
  disconnected and held for `RECONNECT_GRACE_MS` (45 s, `shared/const.mjs`;
  `options.graceMs` for tests). The avatar keeps falling meanwhile — the
  pit waits for nobody — and can die naturally; the run entry is stored on
  the seat. After grace the seat is removed (normal leave).
- **Token identity**: `joined` carries a private seat token (crypto-random,
  stored client-side in localStorage at join time — nothing else needs
  persisting, the server owns all state). `{t:'reclaim', token}` on any new
  socket rebinds the same seat idempotently — same tab, new tab, or after
  reload; a superseded socket is closed (4000). Reclaiming a seat that died
  while away returns the stored entry so the client can show the death
  screen. Unknown/expired token → `{t:'reclaim', ok:false}` → client clears
  the token and shows the join screen ("SEAT EXPIRED").
- **Client reconnect**: every close is treated as recoverable (never branch
  on close codes). Retry at 1 s with backoff to 5 s, plus an immediate
  reconnect on `visibilitychange → visible`. A pulsing RECONNECTING banner
  replaces the old fatal "refresh the page" state. Each reconnect gets a
  fresh `hello`; the renderer guards re-init and resets its layer cache.
- **Pit-reset layer stream fix** (playtest A bug): `resetPit()` regenerates
  layers from scratch, dropping `generatedCount()` below the broadcast
  cursor — clients kept stale geometry and the first levels looked empty.
  The server now rewinds the cursor and re-broadcasts from 0; clients treat
  a `layers` message with `from === 0` as "clear and rebuild".
- Known trade-off: disconnected-but-alive ghosts count toward the 16 cap
  and block pit reset until they die or grace expires — bounded at 45 s.

Covered by test 8 (drop → seat held → dies while away → reclaim returns
same id + entry; short-grace server → seat freed, token refused) and the
reset-rebroadcast assertion in test 5; the browser smoke reloads the page
and verifies the seat auto-reclaims.

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

`./ssh-deploy.sh` (repo root, mirrors `multiciv/ssh-deploy.sh`; tightened
2026-08-01 per the RetroMultiCiv ally's requirements): provenance guard
(dirty-tree prompt, `--yes` to skip) → allowlist rsync (`client/ server/
shared/ package*.json` only; `/server/highscores.json` and WSL
`*:Zone.Identifier` files excluded) → `npm ci --omit=dev` → `systemctl
restart pitfall` → four-stage verify: `sleep 3` + loopback healthz (catches
crash-loops), then the MANDATORY public check
`https://pitfall.kjell.today/healthz` (loopback can't see nginx/TLS/DNS),
then the neighbour check (`https://multiciv.kjell.today` must still
answer), then a package.json sha1 content check against partial syncs. The
whole deploy multiplexes over one ssh connection (ControlMaster). Neighbour
ports 8123/8200 are never touched. Shared-state steps (nginx reload,
certbot --expand) are run by the operator with the ally watching, per
their request.

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

Shops + items (Shield/Parachute/Magnet), zone themes per 10 levels, audio —
a human composer is engaged (2026-08-01): track/zone mapping, lengths and
themes in `game-soundtrack-design.md`; retro blip SFX stay code-generated —
spectator camera, join codes/multiple rooms, global leaderboard,
seeded/deterministic pits, replays.
(Touch controls landed 2026-08-01: swipe to hop, drag past the threshold to
chain hops, verified by a synthetic-swipe check in `tools/client_smoke.mjs`.
Playtest rounds 2026-08-01 added: a semi-transparent helper column marking
the local player's tile down the shaft; the chase cam, now the default view;
90° view rotation with screen-relative input remapping; and a first-visit
quick-start overlay. The client smoke verifies all of it: quick-start shows
once and never again after reload, chase is default, camera toggles,
rotation remaps a swipe to the correct world direction, and it screenshots
chase, diorama, and rotated views.

Mobile pass 2026-08-01, ahead of the user's phone playtest: responsive HUD
via media queries — topbar stats fit at ≤600px (12px/10px gap) and ≤360px
(11px/7px); players roster shrinks to 124px; overlay panels get screen-edge
padding, full-width panels and a smaller h1 so the title doesn't wrap;
rotate buttons drop to 62% height on coarse pointers (thumb reach);
`touch-action: manipulation` on all buttons kills double-tap zoom; the
quick-start MOVE line is rewritten swipe-first on coarse pointers.
`tools/mobile_smoke.mjs` drives the real client under phone emulation
(390x844 @3x, touch, mobile UA): quick-start tap-through, tap-to-join,
swipe + rotated swipe verified against server state, horizontal-overflow
assertions, coarse help text, and screenshots of portrait, landscape and
320px layouts. Desktop layout is untouched (all changes behind max-width /
pointer media queries).)
