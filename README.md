# Multi-Pitfall

A fun, lightweight multiplayer re-imagining of the falling-down-the-well
pitfall genre — low-poly neon-retro three.js, up to 16 players, drop-in
multiplayer. Design lineage: `retrogradegames/pitfall/multi-pitfall-design.md`;
build plan: `specs/v1-plan.md`.

Fall down an endless shaft, steer on a 7x7 grid to dodge walls and hazards,
grab coins and gems, go deeper. Anyone can drop in mid-run at the current
depth — but **you only score what you survive**.

## Run

```bash
npm install
npm start          # serves http://localhost:8080  (PORT=n to override)
```

Open the URL in any browser, type a name, DROP IN. Friends on the LAN use
`http://<your-ip>:8080`. Controls: WASD / arrow keys.

## Test

```bash
npm test                    # server smoke suite (join/move/pickup/death/drop-in/reset)
node tools/client_smoke.mjs  # real client in headless Chromium + screenshot
                            # (needs a cached Playwright chromium; BOTS=n for crowd)
```

## Layout

- `server/` — CommonJS: `server.js` (HTTP static + ws + 20Hz tick pump),
  `game.js` (authoritative game logic). High scores persist to
  `server/highscores.json`.
- `shared/const.mjs` — tuning constants, served to the browser as-is.
- `client/` — no-build ES modules; `vendor/three.module.js` pinned at r162
  (last WebGL1-fallback release).
- `specs/` — design of record.

Dependencies: `ws` (runtime), `playwright-core` (dev). That's the tree.
