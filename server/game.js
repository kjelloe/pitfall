'use strict';

const DIRS = {
  n: { x: 0, z: -1 },
  s: { x: 0, z: 1 },
  w: { x: -1, z: 0 },
  e: { x: 1, z: 0 }
};

function createGame(C, opts = {}) {
  const rand = opts.rand || Math.random;
  const now = opts.now || (() => Date.now());
  const onRunEnd = opts.onRunEnd || (() => {});

  const state = {
    depth: 0,
    layers: [],
    players: new Map(),
    board: Array.isArray(opts.initialBoard) ? opts.initialBoard.slice(0, 50) : [],
    nextId: 1,
    nextSeat: 1
  };

  const events = [];

  function level() {
    return Math.floor(state.depth / C.LAYERS_PER_LEVEL) + 1;
  }

  function alivePlayers() {
    return [...state.players.values()].filter(p => p.status === 'alive');
  }

  function fallSpeed() {
    if (alivePlayers().length === 0) return 0;
    return Math.min(
      C.MAX_FALL_SPEED,
      C.BASE_FALL_SPEED + (level() - 1) * C.FALL_SPEED_PER_LEVEL
    );
  }

  function carve(cells, x, z) {
    const clear = (cx, cz) => {
      if (cx < 0 || cz < 0 || cx >= C.GRID || cz >= C.GRID) return;
      const i = cz * C.GRID + cx;
      if (cells[i] === C.CELL.WALL || cells[i] === C.CELL.HAZARD) {
        cells[i] = C.CELL.EMPTY;
      }
    };
    clear(x, z);
    clear(x + 1, z);
    clear(x - 1, z);
    clear(x, z + 1);
    clear(x, z - 1);
  }

  function genLayer(idx) {
    const lvl = Math.floor(idx / C.LAYERS_PER_LEVEL) + 1;
    const cells = new Array(C.GRID * C.GRID).fill(C.CELL.EMPTY);
    if (idx < 4) return cells.join('');
    const wallP = Math.min(0.3, 0.05 + lvl * 0.012);
    const hazP = Math.min(0.12, 0.012 + lvl * 0.005);
    const coinP = 0.06;
    const gemP = 0.012;
    for (let i = 0; i < cells.length; i++) {
      const r = rand();
      if (r < wallP) cells[i] = C.CELL.WALL;
      else if (r < wallP + hazP) cells[i] = C.CELL.HAZARD;
      else if (r < wallP + hazP + coinP) cells[i] = C.CELL.COIN;
      else if (r < wallP + hazP + coinP + gemP) cells[i] = C.CELL.GEM;
    }
    const zones = Math.max(2, 5 - Math.floor(lvl / 8));
    for (let z = 0; z < zones; z++) {
      carve(cells, Math.floor(rand() * C.GRID), Math.floor(rand() * C.GRID));
    }
    return cells.join('');
  }

  function ensureLayers(upTo) {
    while (state.layers.length <= upTo) {
      state.layers.push(genLayer(state.layers.length));
    }
  }

  function pickColor() {
    const used = new Map();
    for (const p of state.players.values()) {
      used.set(p.color, (used.get(p.color) || 0) + 1);
    }
    let best = 0;
    let bestCount = Infinity;
    for (let i = 0; i < C.PLAYER_COLORS.length; i++) {
      const c = used.get(i) || 0;
      if (c < bestCount) {
        best = i;
        bestCount = c;
      }
    }
    return best;
  }

  function spawnCell() {
    const mid = Math.floor(C.GRID / 2);
    const occupied = new Set(alivePlayers().map(p => p.z * C.GRID + p.x));
    for (let r = 0; r <= mid; r++) {
      for (let z = mid - r; z <= mid + r; z++) {
        for (let x = mid - r; x <= mid + r; x++) {
          if (x < 0 || z < 0 || x >= C.GRID || z >= C.GRID) continue;
          if (!occupied.has(z * C.GRID + x)) return { x, z };
        }
      }
    }
    return { x: mid, z: mid };
  }

  function sanitizeName(raw) {
    const s = String(raw || '')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[<>&"'`]/g, '')
      .trim()
      .toUpperCase()
      .slice(0, 12);
    return s || 'ANON';
  }

  function resetPit() {
    state.depth = 0;
    state.layers = [];
    ensureLayers(C.GEN_AHEAD);
    events.push({ k: 'reset' });
  }

  function addPlayer(name) {
    if (alivePlayers().length >= C.MAX_PLAYERS) return { error: 'full' };
    if (alivePlayers().length === 0 && state.depth > 0) resetPit();
    const id = 'p' + state.nextId++;
    const cell = spawnCell();
    const p = {
      id,
      name: sanitizeName(name),
      color: pickColor(),
      x: cell.x,
      z: cell.z,
      score: 0,
      gold: 0,
      lives: C.START_LIVES,
      status: 'alive',
      joinLevel: level(),
      invulnUntil: now() + C.INVULN_MS,
      lastMove: 0,
      seat: state.nextSeat++
    };
    state.players.set(id, p);
    events.push({ k: 'join', id, name: p.name });
    return { player: p };
  }

  function recordRun(p, status) {
    const deepest = level();
    const entry = {
      name: p.name,
      score: p.score,
      gold: p.gold,
      joinLevel: p.joinLevel,
      deepest,
      traveled: Math.max(0, deepest - p.joinLevel),
      status,
      date: new Date().toISOString().slice(0, 10)
    };
    state.board.push(entry);
    state.board.sort((a, b) => b.score - a.score);
    state.board = state.board.slice(0, 50);
    onRunEnd(entry, state.board);
    return entry;
  }

  function removePlayer(id) {
    const p = state.players.get(id);
    if (!p) return;
    if (p.status === 'alive' && p.score > 0) recordRun(p, 'left');
    state.players.delete(id);
    events.push({ k: 'leave', id, name: p.name });
  }

  function move(id, dir) {
    const p = state.players.get(id);
    if (!p || p.status !== 'alive') return;
    const d = DIRS[dir];
    if (!d) return;
    const t = now();
    if (t - p.lastMove < C.MOVE_COOLDOWN_MS) return;
    const nx = p.x + d.x;
    const nz = p.z + d.z;
    if (nx < 0 || nx >= C.GRID || nz < 0 || nz >= C.GRID) return;
    p.x = nx;
    p.z = nz;
    p.lastMove = t;
  }

  function die(p) {
    p.status = 'dead';
    const entry = recordRun(p, 'lost');
    events.push({ k: 'death', id: p.id, name: p.name, score: p.score, entry });
  }

  function hitPlayer(p) {
    if (now() < p.invulnUntil) return;
    p.lives -= 1;
    if (p.lives <= 0) {
      die(p);
    } else {
      p.invulnUntil = now() + C.INVULN_MS;
      events.push({ k: 'hit', id: p.id, lives: p.lives });
    }
  }

  function resolveLayer(d) {
    ensureLayers(d);
    const cells = state.layers[d].split('');
    const ordered = alivePlayers().sort((a, b) => a.seat - b.seat);
    for (const p of ordered) {
      const i = p.z * C.GRID + p.x;
      const c = cells[i];
      if (c === C.CELL.COIN) {
        p.gold += C.SCORE.COIN_GOLD;
        p.score += C.SCORE.COIN;
        cells[i] = C.CELL.EMPTY;
        events.push({ k: 'pickup', id: p.id, d, i, cell: C.CELL.COIN });
      } else if (c === C.CELL.GEM) {
        p.score += C.SCORE.GEM;
        cells[i] = C.CELL.EMPTY;
        events.push({ k: 'pickup', id: p.id, d, i, cell: C.CELL.GEM });
      } else if (c === C.CELL.WALL || c === C.CELL.HAZARD) {
        hitPlayer(p);
      }
    }
    state.layers[d] = cells.join('');
  }

  function tick(dtMs) {
    const speed = fallSpeed();
    if (speed > 0) {
      const beforeFloor = Math.floor(state.depth);
      const beforeLevel = level();
      state.depth += (speed * dtMs) / 1000;
      const afterFloor = Math.floor(state.depth);
      for (let d = beforeFloor + 1; d <= afterFloor; d++) resolveLayer(d);
      const gained = level() - beforeLevel;
      if (gained > 0) {
        for (const p of alivePlayers()) {
          p.score +=
            gained * (C.SCORE.DEPTH_PER_LEVEL + C.SCORE.SURVIVAL_PER_LEVEL);
        }
        events.push({ k: 'levelup', level: level() });
      }
    }
    ensureLayers(Math.floor(state.depth) + C.GEN_AHEAD);
  }

  function snapshot() {
    return {
      depth: Math.round(state.depth * 1000) / 1000,
      speed: fallSpeed(),
      level: level(),
      players: [...state.players.values()].map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        z: p.z,
        score: p.score,
        gold: p.gold,
        lives: p.lives,
        status: p.status,
        joinLevel: p.joinLevel,
        inv: now() < p.invulnUntil ? 1 : 0
      })),
      ev: events.splice(0)
    };
  }

  function getLayers(from, to) {
    ensureLayers(to);
    return state.layers.slice(from, to + 1);
  }

  ensureLayers(C.GEN_AHEAD);

  return {
    state,
    level,
    fallSpeed,
    addPlayer,
    removePlayer,
    move,
    tick,
    snapshot,
    getLayers,
    generatedCount: () => state.layers.length
  };
}

module.exports = { createGame };
