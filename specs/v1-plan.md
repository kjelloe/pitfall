# Multi-Pitfall v1 — Build Plan

*Written 2026-08-01. A fun, lightweight re-imagining of the falling-down-the-well
pitfall genre ("Deep II: 3D Descent" design in
`retrogradegames/pitfall/multi-pitfall-design.md`), rendered with low-poly
three.js instead of ASCII. Up to 16 players, drop-in multiplayer.*

## Locked decisions

| Question | Decision |
|---|---|
| Camera | Tilted ~30° orthographic 2.5D diorama looking down at the 7x7 grid; the shaft's layers scroll up past the fixed grid plane |
| Movement | Discrete grid hops (WASD/arrows), lerp-animated, non-lethal player overlap |
| Descent | Continuous layer stream: obstacle layers rush up at ramping fall speed; every 10 layers = 1 level |
| Architecture | Lightweight server-authoritative: one Node process (HTTP static + `ws`), 20Hz tick, JSON messages. No determinism/replay machinery in v1 |
| Art | Neon-retro low poly: flat-shaded meshes, bright ANSI-like palette on dark shaft, fog-to-black below, CSS scanline overlay |
| v1 scope | Core fall + drop-in: move/dodge, coins/gems, lives, death, personal-depth scoring, session leaderboard, high-score persistence. No shops/items/zone themes |
| Join flow | One always-open session per server; open the URL, type a name, drop in at current depth |
| Platforms | Desktop keyboard only (grid hops make swipe trivial later) |

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

## Out of scope for v1 (round two candidates)

Shops + items (Shield/Parachute/Magnet), zone themes per 10 levels, touch
controls, sound (PC-speaker-style WebAudio blips), spectator camera, join
codes/multiple rooms, global leaderboard, seeded/deterministic pits, replays.
