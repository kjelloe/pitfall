// Mobile client smoke: drives the real client in headless Chromium with
// phone emulation (touch, mobile viewport, 3x DPR). Verifies the touch-first
// flow — quick-start, tap-to-join, swipe-to-move, camera + rotate buttons —
// and screenshots portrait, landscape and small-phone layouts.
//
//   node tools/mobile_smoke.mjs [shot-dir]
//
// Requires playwright-core + a cached Playwright chromium (CHROMIUM_PATH to
// override), same as client_smoke.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import serverMod from '../server/server.js';

const BOTS = Number(process.env.BOTS || 3);

function spawnBot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const dirs = ['n', 's', 'e', 'w'];
  let timer = null;
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', name }));
    timer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ t: 'move', dir: dirs[Math.floor(Math.random() * 4)] })
        );
      }
    }, 250);
  });
  ws.on('close', () => clearInterval(timer));
  return ws;
}

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

const shotDir = process.argv[2] || path.join(os.tmpdir(), 'pitfall-mobile');
fs.mkdirSync(shotDir, { recursive: true });
const shot = name => path.join(shotDir, `${name}.png`);

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
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
});
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const bots = [];
for (let i = 1; i <= BOTS; i++) bots.push(spawnBot(srv.port, `BOT${i}`));

const me = () =>
  [...srv.game.state.players.values()].find(p => p.name === 'PHONE');
const swipe = (dx, dy) =>
  page.evaluate(([x, y]) => {
    const el = document.getElementById('scene');
    const mk = (cx, cy) =>
      new Touch({ identifier: 9, target: el, clientX: cx, clientY: cy });
    const opts = t => ({
      touches: t, changedTouches: t, bubbles: true, cancelable: true
    });
    el.dispatchEvent(new TouchEvent('touchstart', opts([mk(195, 420)])));
    el.dispatchEvent(new TouchEvent('touchmove', opts([mk(195 + x, 420 + y)])));
    el.dispatchEvent(
      new TouchEvent('touchend', {
        touches: [], changedTouches: [mk(195 + x, 420 + y)],
        bubbles: true, cancelable: true
      })
    );
  }, [dx, dy]);
const settled = async pred => {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < 2000) {
    await new Promise(r => setTimeout(r, 50));
  }
  return pred();
};
const overflow = () =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );

try {
  await page.goto(`http://127.0.0.1:${srv.port}/`);
  // Generous timeout: SwiftShader + the three.js module parse can be slow
  // on a loaded machine.
  await page.waitForSelector('#quickstart-overlay:not(.hidden)', {
    timeout: 15000
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('portrait-quickstart') });
  if (await overflow()) errors.push('horizontal overflow on quickstart');

  await page.tap('#quickstart-btn');
  await page.fill('#join-name', 'PHONE');
  await page.screenshot({ path: shot('portrait-join') });
  await page.tap('#join-btn');
  await page.waitForSelector('#topbar:not(.hidden)', { timeout: 5000 });

  const help = (await page.textContent('#help')).trim();
  if (!/SWIPE/.test(help)) {
    errors.push(`coarse-pointer help text wrong: "${help}"`);
  }

  const x0 = me().x;
  const goEast = x0 <= 3;
  await swipe(goEast ? 70 : -70, 0);
  if (!(await settled(() => me().x === x0 + (goEast ? 1 : -1)))) {
    errors.push(`swipe did not move player (x ${x0} -> ${me().x})`);
  } else {
    console.log('mobile swipe OK:', x0, '->', me().x);
  }

  await page.waitForTimeout(2500);

  // Touch devices show big hearts under the play area instead of the tiny
  // topbar LIVES text.
  const hearts = await page.evaluate(() => ({
    display: getComputedStyle(document.getElementById('lives-big')).display,
    count: document.querySelectorAll('#lives-big span').length,
    topbarLives: getComputedStyle(
      document.querySelector('#topbar .stat.lives')
    ).display
  }));
  if (hearts.display === 'none') errors.push('big hearts hidden on touch');
  if (hearts.count !== 3) {
    errors.push(`expected 3 hearts, got ${hearts.count}`);
  }
  if (hearts.topbarLives !== 'none') {
    errors.push('topbar LIVES text should be hidden on touch');
  }

  await page.screenshot({ path: shot('portrait-chase') });
  if (await overflow()) errors.push('horizontal overflow in game (portrait)');

  await page.tap('#cam-btn');
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot('portrait-diorama') });

  await page.tap('#rot-right');
  await page.waitForTimeout(700);
  const z0 = me().z;
  const north = z0 > 0;
  await swipe(north ? 70 : -70, 0);
  if (!(await settled(() => me().z === z0 + (north ? -1 : 1)))) {
    errors.push(`rotated swipe did not remap (z ${z0} -> ${me().z})`);
  } else {
    console.log('rotated mobile swipe OK: z', z0, '->', me().z);
  }
  await page.tap('#cam-btn');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('landscape-chase') });
  if (await overflow()) errors.push('horizontal overflow in game (landscape)');

  // Small phone (320px class) — overlays must not overflow.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('small-chase') });
  if (await overflow()) errors.push('horizontal overflow in game (320px)');

  const hud = await page.evaluate(() => ({
    canvas: !!document.querySelector('#scene canvas'),
    depth: document.getElementById('hud-depth').textContent
  }));
  if (!hud.canvas) errors.push('no canvas rendered');
  if (!(Number(hud.depth) > 0)) errors.push('depth did not advance');

  console.log('screenshots in:', shotDir);
  if (errors.length) {
    console.error('MOBILE SMOKE FAILED:');
    for (const e of errors) console.error(' -', e);
    process.exitCode = 1;
  } else {
    console.log('MOBILE SMOKE OK');
  }
} catch (e) {
  console.error('MOBILE SMOKE CRASHED:', e.message);
  for (const err of errors) console.error(' - page error:', err);
  process.exitCode = 1;
} finally {
  for (const b of bots) b.close();
  await browser.close();
  await srv.close();
}
