'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { start } = require('../server/server');

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs = [];
    const waiters = [];
    ws.on('message', data => {
      const m = JSON.parse(data);
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) {
          waiters[i].resolve(m);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        send: o => ws.send(JSON.stringify(o)),
        waitFor: (pred, ms = 5000) => {
          const past = msgs.find(pred);
          if (past) return Promise.resolve(past);
          return new Promise((res, rej) => {
            const w = { pred, resolve: res };
            waiters.push(w);
            setTimeout(() => {
              const i = waiters.indexOf(w);
              if (i !== -1) {
                waiters.splice(i, 1);
                rej(new Error('waitFor timeout'));
              }
            }, ms);
          });
        }
      })
    );
  });
}

const myPlayer = (m, id) =>
  m.t === 'snap' && m.players.find(p => p.id === id);

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-'));
  const scoresFile = path.join(dir, 'highscores.json');
  const srv = await start({ port: 0, scoresFile });
  srv.scoresFile = scoresFile;
  return srv;
}

test('serves the client over http', async () => {
  const srv = await boot();
  try {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${srv.port}/`, res => {
        assert.strictEqual(res.statusCode, 200);
        let b = '';
        res.on('data', c => (b += c));
        res.on('end', () => resolve(b));
      }).on('error', reject);
    });
    assert.match(body, /PITFALL: DROP-ZONE/);
  } finally {
    await srv.close();
  }
});

test('join, move, pickup, death, scoring', async () => {
  const srv = await boot();
  try {
    const c1 = await connect(srv.port);
    const hello = await c1.waitFor(m => m.t === 'hello');
    assert.strictEqual(hello.cfg.grid, 7);
    assert.ok(hello.rows.length > 0);

    c1.send({ t: 'join', name: 'tester' });
    const joined = await c1.waitFor(m => m.t === 'joined');
    const id = joined.id;

    let snap = await c1.waitFor(m => myPlayer(m, id));
    let me = snap.players.find(p => p.id === id);
    assert.strictEqual(me.name, 'TESTER');
    assert.strictEqual(me.status, 'alive');
    assert.strictEqual(me.joinLevel, 1);

    const startX = me.x;
    c1.send({ t: 'move', dir: 'e' });
    snap = await c1.waitFor(
      m => myPlayer(m, id) && myPlayer(m, id).x === startX + 1
    );
    me = snap.players.find(p => p.id === id);

    const g = srv.game;
    const place = (layerOffset, cellCh, px, pz) => {
      const d = Math.floor(g.state.depth) + layerOffset;
      const i = pz * 7 + px;
      const row = g.state.layers[d];
      g.state.layers[d] =
        cellCh.length === 1
          ? row.slice(0, i) + cellCh + row.slice(i + 1)
          : cellCh;
    };

    place(2, '$', me.x, me.z);
    snap = await c1.waitFor(
      m => myPlayer(m, id) && myPlayer(m, id).gold >= 10,
      8000
    );
    me = snap.players.find(p => p.id === id);
    assert.ok(me.score >= 10);

    const live = [...g.state.players.values()].find(p => p.id === id);
    live.lives = 1;
    live.invulnUntil = 0;
    place(2, '#'.repeat(49));
    place(3, '#'.repeat(49));
    const deathSnap = await c1.waitFor(
      m => m.t === 'snap' && m.ev.some(e => e.k === 'death' && e.id === id),
      8000
    );
    const deathEv = deathSnap.ev.find(e => e.k === 'death');
    assert.strictEqual(deathEv.entry.joinLevel, 1);
    assert.ok(deathEv.entry.score >= 10);

    const scores = await c1.waitFor(m => m.t === 'scores');
    assert.ok(scores.board.some(e => e.name === 'TESTER'));

    await new Promise(r => setTimeout(r, 600));
    const saved = JSON.parse(fs.readFileSync(srv.scoresFile, 'utf8'));
    assert.ok(saved.some(e => e.name === 'TESTER'));
    c1.ws.close();
  } finally {
    await srv.close();
  }
});

test('caps the pit at 16 players and rejects the 17th', async () => {
  const srv = await boot();
  const clients = [];
  try {
    for (let i = 1; i <= 16; i++) {
      const c = await connect(srv.port);
      clients.push(c);
      await c.waitFor(m => m.t === 'hello');
      c.send({ t: 'join', name: `P${i}` });
      await c.waitFor(m => m.t === 'joined');
    }
    const extra = await connect(srv.port);
    clients.push(extra);
    const hello = await extra.waitFor(m => m.t === 'hello');
    assert.strictEqual(hello.cfg.maxPlayers, 16);
    extra.send({ t: 'join', name: 'SEVENTEENTH' });
    const reject = await extra.waitFor(m => m.t === 'reject');
    assert.strictEqual(reject.reason, 'full');
  } finally {
    for (const c of clients) c.ws.close();
    await srv.close();
  }
});

test('drop-in joins at current level and scores only traveled depth', async () => {
  const srv = await boot();
  try {
    const c1 = await connect(srv.port);
    await c1.waitFor(m => m.t === 'hello');
    c1.send({ t: 'join', name: 'HOST' });
    const j1 = await c1.waitFor(m => m.t === 'joined');
    await c1.waitFor(m => myPlayer(m, j1.id));

    srv.game.state.depth = 125;

    const c2 = await connect(srv.port);
    await c2.waitFor(m => m.t === 'hello');
    c2.send({ t: 'join', name: 'LATE' });
    const j2 = await c2.waitFor(m => m.t === 'joined');
    const snap = await c2.waitFor(m => myPlayer(m, j2.id));
    const late = snap.players.find(p => p.id === j2.id);
    assert.strictEqual(late.joinLevel, 13);
    assert.strictEqual(late.score, 0);

    const g = srv.game;
    const live = [...g.state.players.values()].find(p => p.id === j2.id);
    live.lives = 1;
    live.invulnUntil = 0;
    const d = Math.floor(g.state.depth);
    for (const off of [2, 3]) g.state.layers[d + off] = '#'.repeat(49);

    const deathSnap = await c2.waitFor(
      m => m.t === 'snap' && m.ev.some(e => e.k === 'death' && e.id === j2.id),
      8000
    );
    const entry = deathSnap.ev.find(e => e.k === 'death').entry;
    assert.strictEqual(entry.joinLevel, 13);
    assert.ok(entry.deepest >= 13);
    assert.strictEqual(entry.traveled, entry.deepest - 13);
    c1.ws.close();
    c2.ws.close();
  } finally {
    await srv.close();
  }
});

test('pit resets when a player joins after everyone died', async () => {
  const srv = await boot();
  try {
    const c1 = await connect(srv.port);
    await c1.waitFor(m => m.t === 'hello');
    c1.send({ t: 'join', name: 'DOOMED' });
    const j1 = await c1.waitFor(m => m.t === 'joined');
    await c1.waitFor(m => myPlayer(m, j1.id));

    const g = srv.game;
    g.state.depth = 55;
    const live = [...g.state.players.values()].find(p => p.id === j1.id);
    live.lives = 1;
    live.invulnUntil = 0;
    const d = Math.floor(g.state.depth);
    for (const off of [1, 2]) g.state.layers[d + off] = '#'.repeat(49);
    await c1.waitFor(
      m => m.t === 'snap' && m.ev.some(e => e.k === 'death' && e.id === j1.id),
      8000
    );

    c1.send({ t: 'rejoin', name: 'DOOMED' });
    await c1.waitFor(m => m.t === 'joined' && m.id !== j1.id);
    const snap = await c1.waitFor(
      m => m.t === 'snap' && m.players.some(p => p.status === 'alive')
    );
    assert.ok(snap.depth < 5, `expected reset depth, got ${snap.depth}`);
    assert.strictEqual(snap.level, 1);

    // Regression: the regenerated layers must be re-broadcast from 0 so
    // connected clients don't fall through invisible stale levels.
    const fresh = await c1.waitFor(m => m.t === 'layers' && m.from === 0);
    assert.ok(fresh.rows.length > 0);
    c1.ws.close();
  } finally {
    await srv.close();
  }
});

test('honors PORT, HOST and SCORES_FILE env and serves /healthz', async () => {
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-env-'));
  const scoresFile = path.join(dir, 'hs.json');
  const seeded = [
    { name: 'ENVSEED', score: 123, joinLevel: 1, deepest: 2, traveled: 1,
      date: '2026-08-01' }
  ];
  fs.writeFileSync(scoresFile, JSON.stringify(seeded));

  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      SCORES_FILE: scoresFile
    }
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', d => {
        out += d;
        const m = out.match(/localhost:(\d+)/);
        if (m) resolve(Number(m[1]));
      });
      child.on('exit', c => reject(new Error(`server exited (${c}): ${out}`)));
      setTimeout(() => reject(new Error('no listen line: ' + out)), 5000);
    });

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.strictEqual(health.status, 200);
    const body = await health.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(typeof body.players, 'number');

    const c1 = await connect(port);
    const hello = await c1.waitFor(m => m.t === 'hello');
    assert.ok(
      hello.scores.some(e => e.name === 'ENVSEED'),
      'seeded SCORES_FILE board not served'
    );
    c1.ws.close();
  } finally {
    child.kill();
    await new Promise(resolve => child.on('exit', resolve));
  }
});

test('hardening: strips markup from names, caps sockets, rate-limits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-hard-'));
  const srv = await start({
    port: 0,
    scoresFile: path.join(dir, 'hs.json'),
    maxSockets: 4,
    rateMax: 10
  });
  try {
    const c1 = await connect(srv.port);
    c1.send({ t: 'join', name: '<b>ev&"x</b>' });
    const joined = await c1.waitFor(m => m.t === 'joined');
    const snap = await c1.waitFor(m => myPlayer(m, joined.id));
    const name = snap.players.find(p => p.id === joined.id).name;
    assert.ok(!/[<>&"'`]/.test(name), `markup survived: "${name}"`);
    assert.ok(name.length > 0);

    const extras = [
      await connect(srv.port),
      await connect(srv.port),
      await connect(srv.port)
    ];
    const fifth = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((resolve, reject) => {
      fifth.on('close', resolve);
      fifth.on('error', reject);
      setTimeout(() => reject(new Error('5th socket not closed')), 3000);
    });
    for (const c of extras) c.ws.close();

    const flooder = await connect(srv.port);
    for (let i = 0; i < 15; i++) flooder.send({ t: 'noise' });
    await new Promise((resolve, reject) => {
      flooder.ws.on('close', resolve);
      setTimeout(() => reject(new Error('flooder not terminated')), 3000);
    });

    c1.ws.close();
  } finally {
    await srv.close();
  }
});

test('seat survives a dropped socket; token reclaims it, grace expires it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-grace-'));

  // Long grace: drop the socket, die while away, reclaim the same seat.
  const srv = await start({
    port: 0,
    scoresFile: path.join(dir, 'hs1.json'),
    graceMs: 8000
  });
  try {
    const c1 = await connect(srv.port);
    await c1.waitFor(m => m.t === 'hello');
    c1.send({ t: 'join', name: 'GHOST' });
    const joined = await c1.waitFor(m => m.t === 'joined');
    assert.ok(joined.token, 'join must return a seat token');
    await c1.waitFor(m => myPlayer(m, joined.id));

    const g = srv.game;
    const live = [...g.state.players.values()].find(p => p.id === joined.id);
    live.lives = 1;
    live.invulnUntil = 0;
    const d = Math.floor(g.state.depth);
    for (const off of [1, 2]) g.state.layers[d + off] = '#'.repeat(49);

    c1.ws.terminate(); // 1006-style drop, no clean handshake
    await new Promise(r => setTimeout(r, 300));
    assert.ok(
      g.state.players.has(joined.id),
      'seat freed immediately on socket drop'
    );

    // Dies while disconnected — the pit does not wait for anyone.
    const t0 = Date.now();
    while (
      g.state.players.get(joined.id)?.status !== 'dead' &&
      Date.now() - t0 < 8000
    ) {
      await new Promise(r => setTimeout(r, 100));
    }
    assert.strictEqual(g.state.players.get(joined.id)?.status, 'dead');

    const c2 = await connect(srv.port);
    await c2.waitFor(m => m.t === 'hello');
    c2.send({ t: 'reclaim', token: joined.token });
    const back = await c2.waitFor(m => m.t === 'joined');
    assert.strictEqual(back.id, joined.id, 'reclaim must return the same seat');
    assert.ok(back.entry, 'death-while-away must deliver the run entry');
    assert.strictEqual(back.entry.joinLevel, 1);
    c2.ws.close();
  } finally {
    await srv.close();
  }

  // Short grace: an expired seat is gone and the token stops working.
  const srv2 = await start({
    port: 0,
    scoresFile: path.join(dir, 'hs2.json'),
    graceMs: 300
  });
  try {
    const c1 = await connect(srv2.port);
    await c1.waitFor(m => m.t === 'hello');
    c1.send({ t: 'join', name: 'EXPIRED' });
    const joined = await c1.waitFor(m => m.t === 'joined');
    c1.ws.terminate();

    const t0 = Date.now();
    while (srv2.game.state.players.has(joined.id) && Date.now() - t0 < 3000) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(
      !srv2.game.state.players.has(joined.id),
      'seat must be freed after grace expires'
    );

    const c2 = await connect(srv2.port);
    await c2.waitFor(m => m.t === 'hello');
    c2.send({ t: 'reclaim', token: joined.token });
    const miss = await c2.waitFor(m => m.t === 'reclaim');
    assert.strictEqual(miss.ok, false);
    c2.ws.close();
  } finally {
    await srv2.close();
  }
});
