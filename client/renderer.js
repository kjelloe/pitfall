import * as THREE from 'three';

const CELL_W = 1.15;
const LAYER_H = 2.4;
const BG = 0x05060a;
const MOVE_LERP_MS = 90;
const RING_COLORS = [0xffe93d, 0x2bfcff, 0xff3df0, 0x3dff6e, 0xff8a3d];

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 20, 56);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(0, 16, 10);
  camera.lookAt(0, -3, 0);

  const FRUSTUM_H = 19;
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const aspect = w / h;
    camera.left = (-FRUSTUM_H * aspect) / 2;
    camera.right = (FRUSTUM_H * aspect) / 2;
    camera.top = FRUSTUM_H / 2;
    camera.bottom = -FRUSTUM_H / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  scene.add(new THREE.AmbientLight(0xaab4ff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(5, 12, 4);
  scene.add(sun);

  const geos = {
    wall: new THREE.BoxGeometry(1.06, 1.15, 1.06),
    hazard: new THREE.ConeGeometry(0.42, 0.9, 6),
    coin: new THREE.CylinderGeometry(0.28, 0.28, 0.09, 10),
    gem: new THREE.OctahedronGeometry(0.32, 0)
  };
  const mats = {
    wall: new THREE.MeshLambertMaterial({
      color: 0x38418f, emissive: 0x11173f, flatShading: true
    }),
    hazard: new THREE.MeshLambertMaterial({
      color: 0xff2d55, emissive: 0x6e0d20, flatShading: true
    }),
    coin: new THREE.MeshLambertMaterial({
      color: 0xffe93d, emissive: 0x6e5f00, flatShading: true
    }),
    gem: new THREE.MeshLambertMaterial({
      color: 0x2bfcff, emissive: 0x0b5b60, flatShading: true
    })
  };
  const CELL_Y = { wall: 0, hazard: 0.45 - 0.575, coin: 0, gem: 0 };

  let cfg = null;
  let layerBase = 0;
  const layerRows = [];
  const layerMeshes = new Map();
  const avatars = new Map();

  let displayDepth = 0;
  let snapDepth = 0;
  let snapSpeed = 0;
  let snapTime = 0;
  let lastFrame = 0;
  let latestPlayers = [];
  let myId = null;

  const gx = i => (i - Math.floor(cfg.grid / 2)) * CELL_W;

  function buildStatics() {
    const half = (cfg.grid * CELL_W) / 2;
    const grid = new THREE.GridHelper(
      cfg.grid * CELL_W, cfg.grid, 0x33407a, 0x1a2350
    );
    grid.position.y = -0.02;
    scene.add(grid);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x0c1030 });
    const mk = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 70, d), wallMat);
      m.position.set(x, -32, z);
      scene.add(m);
    };
    const t = 0.6;
    mk(cfg.grid * CELL_W + 2 * t + 1, t, 0, -(half + t));
    mk(t, cfg.grid * CELL_W + 1, -(half + t), 0);
    mk(t, cfg.grid * CELL_W + 1, half + t, 0);
  }

  function rowOf(d) {
    return layerRows[d - layerBase] || null;
  }

  function setRow(d, row) {
    layerRows[d - layerBase] = row;
  }

  function buildLayer(d) {
    const row = rowOf(d);
    if (!row) return null;
    const group = new THREE.Group();
    const byType = { '#': [], '^': [], $: [], '*': [] };
    for (let i = 0; i < row.length; i++) {
      if (byType[row[i]]) byType[row[i]].push(i);
    }
    const typeKey = { '#': 'wall', '^': 'hazard', $: 'coin', '*': 'gem' };
    const m4 = new THREE.Matrix4();
    for (const [ch, cells] of Object.entries(byType)) {
      if (!cells.length) continue;
      const key = typeKey[ch];
      const mesh = new THREE.InstancedMesh(geos[key], mats[key], cells.length);
      cells.forEach((ci, n) => {
        const x = gx(ci % cfg.grid);
        const z = gx(Math.floor(ci / cfg.grid));
        m4.makeTranslation(x, CELL_Y[key], z);
        mesh.setMatrixAt(n, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
    if (d > 0 && d % cfg.layersPerLevel === 0) {
      const lvl = d / cfg.layersPerLevel + 1;
      const c = RING_COLORS[lvl % RING_COLORS.length];
      const rm = new THREE.MeshBasicMaterial({ color: c });
      const span = cfg.grid * CELL_W + 0.9;
      const bar = new THREE.BoxGeometry(span, 0.12, 0.12);
      const barZ = new THREE.BoxGeometry(0.12, 0.12, span);
      const off = span / 2;
      for (const [g, x, z] of [
        [bar, 0, -off], [bar, 0, off], [barZ, -off, 0], [barZ, off, 0]
      ]) {
        const seg = new THREE.Mesh(g, rm);
        seg.position.set(x, 0, z);
        group.add(seg);
      }
    }
    scene.add(group);
    layerMeshes.set(d, group);
    return group;
  }

  function dropLayer(d) {
    const group = layerMeshes.get(d);
    if (!group) return;
    for (const child of group.children) {
      if (child.isInstancedMesh) child.dispose();
    }
    scene.remove(group);
    layerMeshes.delete(d);
  }

  function makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    );
    sprite.scale.set(2.8, 0.7, 1);
    sprite.position.y = 2.0;
    return sprite;
  }

  function makeAvatar(p, isMe) {
    const color = new THREE.Color(cfg.colors[p.color]);
    const mat = new THREE.MeshLambertMaterial({
      color, emissive: color.clone().multiplyScalar(0.25), flatShading: true
    });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 5), mat);
    body.position.y = 0.42;
    group.add(body);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), mat);
    head.position.y = 1.02;
    group.add(head);
    if (isMe) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.045, 6, 24),
        new THREE.MeshBasicMaterial({ color: 0xffe93d })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);
    }
    group.add(makeLabel(p.name, cfg.colors[p.color]));
    group.position.set(gx(p.x), 0, gx(p.z));
    scene.add(group);
    return {
      group,
      cell: { x: p.x, z: p.z },
      animFrom: null,
      animT0: 0,
      seed: Math.random() * Math.PI * 2
    };
  }

  function dropAvatar(id) {
    const a = avatars.get(id);
    if (!a) return;
    scene.remove(a.group);
    avatars.delete(id);
  }

  return {
    init(config) {
      cfg = config;
      buildStatics();
    },

    primeDepth(depth) {
      displayDepth = depth;
      snapDepth = depth;
      snapTime = performance.now();
    },

    setLayers(from, rows) {
      if (!rows || !rows.length) return;
      if (layerRows.length === 0) layerBase = from;
      for (let i = 0; i < rows.length; i++) setRow(from + i, rows[i]);
    },

    applyPickup(ev) {
      const row = rowOf(ev.d);
      if (!row) return;
      setRow(ev.d, row.slice(0, ev.i) + '.' + row.slice(ev.i + 1));
      dropLayer(ev.d);
    },

    applySnap(snap, me) {
      myId = me;
      snapDepth = snap.depth;
      snapSpeed = snap.speed;
      snapTime = performance.now();
      latestPlayers = snap.players;

      const seen = new Set();
      for (const p of snap.players) {
        if (p.status !== 'alive') continue;
        seen.add(p.id);
        let a = avatars.get(p.id);
        if (!a) {
          a = makeAvatar(p, p.id === me);
          avatars.set(p.id, a);
        }
        if (a.cell.x !== p.x || a.cell.z !== p.z) {
          a.animFrom = {
            x: a.group.position.x,
            z: a.group.position.z
          };
          a.animT0 = performance.now();
          a.cell = { x: p.x, z: p.z };
        }
      }
      for (const id of [...avatars.keys()]) {
        if (!seen.has(id)) dropAvatar(id);
      }
    },

    frame(now) {
      if (!cfg) return;
      const dt = Math.min(100, now - (lastFrame || now));
      lastFrame = now;

      const target = snapDepth + (snapSpeed * (now - snapTime)) / 1000;
      if (Math.abs(target - displayDepth) > 3) displayDepth = target;
      else displayDepth += (target - displayDepth) * Math.min(1, dt / 90);

      const dMin = Math.floor(displayDepth);
      const dMax = dMin + cfg.viewAhead;
      for (const d of [...layerMeshes.keys()]) {
        if (d < dMin || d > dMax) dropLayer(d);
      }
      for (let d = dMin; d <= dMax; d++) {
        let group = layerMeshes.get(d);
        if (!group) group = buildLayer(d);
        if (group) group.position.y = (displayDepth - d) * LAYER_H;
      }

      const pmap = new Map(latestPlayers.map(p => [p.id, p]));
      for (const [id, a] of avatars) {
        const p = pmap.get(id);
        const tx = gx(a.cell.x);
        const tz = gx(a.cell.z);
        if (a.animFrom) {
          const k = Math.min(1, (now - a.animT0) / MOVE_LERP_MS);
          a.group.position.x = a.animFrom.x + (tx - a.animFrom.x) * k;
          a.group.position.z = a.animFrom.z + (tz - a.animFrom.z) * k;
          if (k >= 1) a.animFrom = null;
        } else {
          a.group.position.x = tx;
          a.group.position.z = tz;
        }
        a.group.position.y = Math.sin(now / 320 + a.seed) * 0.07;
        a.group.visible = !(p && p.inv && Math.floor(now / 120) % 2 === 0);
      }

      renderer.render(scene, camera);
    }
  };
}
