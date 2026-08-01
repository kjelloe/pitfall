// Manual client smoke: boots the real server, drives the real client in
// headless Chromium (SwiftShader — correctness only, never perf), joins the
// pit, lets it fall a bit and screenshots the result.
//
//   node tools/client_smoke.mjs [screenshot.png]
//
// Requires playwright-core (devDependency) + a cached Playwright chromium;
// set CHROMIUM_PATH to override the browser binary.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import serverMod from '../server/server.js';

const BOTS = Number(process.env.BOTS || 6);

function spawnBot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const dirs = ['n', 's', 'e', 'w'];
  let timer = null;
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', name }));
    timer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            t: 'move',
            dir: dirs[Math.floor(Math.random() * 4)]
          })
        );
      }
    }, 200);
  });
  ws.on('close', () => clearInterval(timer));
  return ws;
}

const shot =
  process.argv[2] || path.join(os.tmpdir(), 'pitfall-drop-zone-smoke.png');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs
    .readdirSync(root)
    .filter(d => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(root, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no cached chromium found; set CHROMIUM_PATH');
}

const srv = await serverMod.start({
  port: 0,
  scoresFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-')), 'hs.json')
});

const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader'
  ]
});

const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const bots = [];
for (let i = 1; i <= BOTS; i++) bots.push(spawnBot(srv.port, `BOT${i}`));

try {
  await page.goto(`http://127.0.0.1:${srv.port}/`);

  // First visit: quick-start overlay must appear; dismiss it to reach join.
  // Generous timeout: SwiftShader + the three.js module parse can be slow
  // on a loaded machine.
  await page.waitForSelector('#quickstart-overlay:not(.hidden)', {
    timeout: 15000
  });
  await page.click('#quickstart-btn');

  await page.fill('#join-name', 'SMOKE');
  await page.click('#join-btn');
  await page.waitForSelector('#topbar:not(.hidden)', { timeout: 5000 });

  // Touch check: swipe toward the grid centre, expect a one-cell hop
  // (verified against authoritative server state).
  const me = () =>
    [...srv.game.state.players.values()].find(p => p.name === 'SMOKE');
  const swipe = dx =>
    page.evaluate(d => {
      const el = document.getElementById('scene');
      const mk = (x, y) =>
        new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
      const opts = t => ({
        touches: t, changedTouches: t, bubbles: true, cancelable: true
      });
      el.dispatchEvent(new TouchEvent('touchstart', opts([mk(300, 300)])));
      el.dispatchEvent(new TouchEvent('touchmove', opts([mk(300 + d, 300)])));
      el.dispatchEvent(
        new TouchEvent('touchend', {
          touches: [], changedTouches: [mk(300 + d, 300)],
          bubbles: true, cancelable: true
        })
      );
    }, dx);
  const settled = async pred => {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < 2000) {
      await new Promise(r => setTimeout(r, 50));
    }
    return pred();
  };

  const x0 = me().x;
  const goEast = x0 <= 3;
  await swipe(goEast ? 60 : -60);
  const wantX = x0 + (goEast ? 1 : -1);
  if (!(await settled(() => me().x === wantX))) {
    errors.push(`touch swipe did not move player (x ${x0} -> ${me().x})`);
  } else {
    console.log('touch swipe OK:', x0, '->', me().x);
  }

  await page.waitForTimeout(3000);

  const hud = await page.evaluate(() => ({
    canvas: !!document.querySelector('#scene canvas'),
    score: document.getElementById('hud-score').textContent,
    level: document.getElementById('hud-level').textContent,
    depth: document.getElementById('hud-depth').textContent,
    lives: document.getElementById('hud-lives').textContent,
    bigHearts: getComputedStyle(document.getElementById('lives-big')).display
  }));
  if (hud.bigHearts !== 'none') {
    errors.push('big hearts should stay hidden on desktop');
  }

  await page.screenshot({ path: shot });
  console.log('hud:', hud);
  console.log('screenshot:', shot);

  // Camera: chase is the default, so the button offers the 3D diorama.
  let camLabel = (await page.textContent('#cam-btn')).trim();
  if (camLabel !== '3D VIEW') {
    errors.push(`cam button initial label: "${camLabel}"`);
  }
  await page.click('#cam-btn');
  camLabel = (await page.textContent('#cam-btn')).trim();
  if (camLabel !== 'CHASE CAM') {
    errors.push(`cam button label after toggle: "${camLabel}"`);
  }
  await page.waitForTimeout(1200);
  const dioramaShot = shot.replace(/\.png$/, '-diorama.png');
  await page.screenshot({ path: dioramaShot });
  console.log('diorama screenshot:', dioramaShot);

  // Rotate right once: a screen-east swipe must now map to world north.
  await page.click('#rot-right');
  await page.waitForTimeout(400);
  const z0 = me().z;
  const north = z0 > 0;
  await swipe(north ? 60 : -60);
  const wantZ = z0 + (north ? -1 : 1);
  if (!(await settled(() => me().z === wantZ))) {
    errors.push(`rotated swipe did not remap (z ${z0} -> ${me().z})`);
  } else {
    console.log('rotated swipe OK: z', z0, '->', me().z);
  }
  await page.waitForTimeout(600);
  const rotShot = shot.replace(/\.png$/, '-rotated.png');
  await page.screenshot({ path: rotShot });
  console.log('rotated screenshot:', rotShot);

  // Revisit: the stored seat token must auto-reclaim the run (no join
  // screen), and the quick-start must stay hidden once dismissed.
  await page.reload();
  await page.waitForSelector('#topbar:not(.hidden)', { timeout: 5000 });
  const revisit = await page.evaluate(() => ({
    qs: !document.getElementById('quickstart-overlay').classList.contains('hidden'),
    join: !document.getElementById('join-overlay').classList.contains('hidden')
  }));
  if (revisit.qs) errors.push('quickstart overlay shown again on revisit');
  if (revisit.join) errors.push('join overlay shown despite valid seat token');
  if (!me()) errors.push('seat not reclaimed after reload');
  else console.log('reload reclaim OK: seat retained');

  if (!hud.canvas) errors.push('no canvas rendered');
  if (!(Number(hud.depth) > 0)) errors.push('depth did not advance');
  if (errors.length) {
    console.error('CLIENT SMOKE FAILED:');
    for (const e of errors) console.error(' -', e);
    process.exitCode = 1;
  } else {
    console.log('CLIENT SMOKE OK');
  }
} catch (e) {
  console.error('CLIENT SMOKE CRASHED:', e.message);
  for (const err of errors) console.error(' - page error:', err);
  process.exitCode = 1;
} finally {
  for (const b of bots) b.close();
  await browser.close();
  await srv.close();
}
