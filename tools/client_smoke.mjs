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
  await page.fill('#join-name', 'SMOKE');
  await page.click('#join-btn');
  await page.waitForSelector('#topbar:not(.hidden)', { timeout: 5000 });

  // Touch check: swipe toward the grid centre, expect a one-cell hop
  // (verified against authoritative server state).
  const me = () =>
    [...srv.game.state.players.values()].find(p => p.name === 'SMOKE');
  const x0 = me().x;
  const goEast = x0 <= 3;
  await page.evaluate(east => {
    const el = document.getElementById('scene');
    const mk = (x, y) =>
      new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
    const opts = t => ({
      touches: t, changedTouches: t, bubbles: true, cancelable: true
    });
    const endX = east ? 360 : 240;
    el.dispatchEvent(new TouchEvent('touchstart', opts([mk(300, 300)])));
    el.dispatchEvent(new TouchEvent('touchmove', opts([mk(endX, 300)])));
    el.dispatchEvent(
      new TouchEvent('touchend', {
        touches: [], changedTouches: [mk(endX, 300)],
        bubbles: true, cancelable: true
      })
    );
  }, goEast);
  const wantX = x0 + (goEast ? 1 : -1);
  const t0 = Date.now();
  while (me().x !== wantX && Date.now() - t0 < 2000) {
    await new Promise(r => setTimeout(r, 50));
  }
  if (me().x !== wantX) {
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
    lives: document.getElementById('hud-lives').textContent
  }));

  await page.screenshot({ path: shot });
  console.log('hud:', hud);
  console.log('screenshot:', shot);

  if (!hud.canvas) errors.push('no canvas rendered');
  if (!(Number(hud.depth) > 0)) errors.push('depth did not advance');
  if (errors.length) {
    console.error('CLIENT SMOKE FAILED:');
    for (const e of errors) console.error(' -', e);
    process.exitCode = 1;
  } else {
    console.log('CLIENT SMOKE OK');
  }
} finally {
  for (const b of bots) b.close();
  await browser.close();
  await srv.close();
}
