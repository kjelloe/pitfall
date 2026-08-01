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
    assert.match(body, /MULTI-PITFALL/);
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
    c1.ws.close();
  } finally {
    await srv.close();
  }
});
