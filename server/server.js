'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { WebSocketServer } = require('ws');
const { createGame } = require('./game');

const ROOT = path.join(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath;
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(CLIENT_DIR, 'index.html');
  } else if (urlPath.startsWith('/shared/')) {
    filePath = path.join(SHARED_DIR, urlPath.slice('/shared/'.length));
  } else {
    filePath = path.join(CLIENT_DIR, urlPath.slice(1));
  }
  const resolved = path.normalize(filePath);
  if (!resolved.startsWith(CLIENT_DIR) && !resolved.startsWith(SHARED_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream'
    });
    res.end(data);
  });
}

function loadBoard(file) {
  try {
    const board = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(board) ? board : [];
  } catch {
    return [];
  }
}

async function start(options = {}) {
  const C = await import(
    pathToFileURL(path.join(SHARED_DIR, 'const.mjs')).href
  );
  const port = options.port !== undefined ? options.port : 8080;
  const scoresFile =
    options.scoresFile || path.join(__dirname, 'highscores.json');

  let saveQueued = false;
  const game = createGame(C, {
    initialBoard: loadBoard(scoresFile),
    onRunEnd: (entry, board) => {
      if (saveQueued) return;
      saveQueued = true;
      setTimeout(() => {
        saveQueued = false;
        fs.writeFile(scoresFile, JSON.stringify(game.state.board, null, 1), err => {
          if (err) console.error('highscore save failed:', err.message);
        });
      }, 250);
    }
  });

  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, players: game.state.players.size }));
      return;
    }
    serveStatic(req, res);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
  const maxSockets = options.maxSockets || 64;
  const rateMax = options.rateMax || 300;
  const RATE_WINDOW_MS = 10000;
  const graceMs =
    options.graceMs !== undefined ? options.graceMs : C.RECONNECT_GRACE_MS;
  // Presence is a server-side fact with a timeout, not a socket. A dropped
  // socket marks the seat disconnected; the token reclaims it within grace.
  const seats = new Map(); // token -> { playerId, ws, disconnectedAt, entry }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = msg => {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  };

  const cfg = {
    grid: C.GRID,
    layersPerLevel: C.LAYERS_PER_LEVEL,
    maxPlayers: C.MAX_PLAYERS,
    startLives: C.START_LIVES,
    viewAhead: C.VIEW_AHEAD,
    colors: C.PLAYER_COLORS,
    cell: C.CELL
  };

  let layerCursor = 0;

  wss.on('connection', ws => {
    if (wss.clients.size > maxSockets) {
      ws.close(1013, 'server busy');
      return;
    }
    let playerId = null;
    let myToken = null;
    let msgCount = 0;
    let windowStart = Date.now();

    const from = Math.max(0, Math.floor(game.state.depth) - 2);
    layerCursor = game.generatedCount();
    send(ws, {
      t: 'hello',
      cfg,
      depth: game.state.depth,
      layersFrom: from,
      rows: game.getLayers(from, layerCursor - 1),
      players: game.snapshot().players,
      scores: game.state.board.slice(0, 10)
    });

    ws.on('message', data => {
      const now = Date.now();
      if (now - windowStart > RATE_WINDOW_MS) {
        windowStart = now;
        msgCount = 0;
      }
      if (++msgCount > rateMax) {
        ws.terminate();
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.t === 'join' || msg.t === 'rejoin') {
        if (playerId) {
          game.removePlayer(playerId);
          playerId = null;
        }
        if (myToken) {
          seats.delete(myToken);
          myToken = null;
        }
        const res = game.addPlayer(msg.name);
        if (res.error) {
          send(ws, { t: 'reject', reason: res.error });
          return;
        }
        playerId = res.player.id;
        myToken = crypto.randomBytes(12).toString('hex');
        seats.set(myToken, {
          playerId, ws, disconnectedAt: null, entry: null
        });
        send(ws, { t: 'joined', id: playerId, token: myToken });
      } else if (msg.t === 'reclaim') {
        const seat = seats.get(String(msg.token || ''));
        if (!seat || !game.state.players.has(seat.playerId)) {
          send(ws, { t: 'reclaim', ok: false });
          return;
        }
        if (seat.ws && seat.ws !== ws && seat.ws.readyState === seat.ws.OPEN) {
          seat.ws.close(4000, 'superseded');
        }
        seat.ws = ws;
        seat.disconnectedAt = null;
        playerId = seat.playerId;
        myToken = String(msg.token);
        const joined = { t: 'joined', id: playerId, token: myToken };
        if (seat.entry) joined.entry = seat.entry;
        send(ws, joined);
      } else if (msg.t === 'move' && playerId) {
        game.move(playerId, msg.dir);
      }
    });

    ws.on('close', () => {
      if (!playerId) return;
      const seat = myToken && seats.get(myToken);
      if (seat && seat.ws === ws) {
        seat.disconnectedAt = Date.now(); // hold the seat; sweep enforces grace
      } else if (!seat) {
        game.removePlayer(playerId);
      }
    });
  });

  let last = Date.now();
  const timer = setInterval(() => {
    const t = Date.now();
    const dt = Math.min(250, t - last);
    last = t;
    game.tick(dt);

    for (const [token, seat] of seats) {
      if (seat.disconnectedAt && t - seat.disconnectedAt > graceMs) {
        game.removePlayer(seat.playerId);
        seats.delete(token);
      }
    }

    // A pit reset regenerates layers from scratch; rewind the cursor so the
    // fresh rows are re-broadcast (clients clear their copy on from === 0).
    if (game.generatedCount() < layerCursor) layerCursor = 0;
    if (game.generatedCount() > layerCursor) {
      broadcast({
        t: 'layers',
        from: layerCursor,
        rows: game.getLayers(layerCursor, game.generatedCount() - 1)
      });
      layerCursor = game.generatedCount();
    }

    const snap = game.snapshot();
    for (const e of snap.ev) {
      if (e.k === 'death') {
        for (const seat of seats.values()) {
          if (seat.playerId === e.id) seat.entry = e.entry;
        }
      }
    }
    broadcast({ t: 'snap', ...snap });
    if (snap.ev.some(e => e.k === 'death' || e.k === 'leave')) {
      broadcast({ t: 'scores', board: game.state.board.slice(0, 10) });
    }
  }, 1000 / C.TICK_HZ);

  await new Promise(resolve => server.listen(port, options.host, resolve));
  const actualPort = server.address().port;
  console.log(`pitfall-drop-zone serving on http://localhost:${actualPort}`);

  return {
    port: actualPort,
    game,
    close: () =>
      new Promise(resolve => {
        clearInterval(timer);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(resolve));
      })
  };
}

if (require.main === module) {
  start({
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    host: process.env.HOST || undefined,
    scoresFile: process.env.SCORES_FILE || undefined
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { start };
