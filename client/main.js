import { createSession } from './session.js';
import { createRenderer } from './renderer.js';
import { createHud } from './hud.js';
import { bindInput } from './input.js';

const session = createSession();
const renderer = createRenderer(document.getElementById('scene'));
const hud = createHud();

session.on('hello', m => {
  window.__colors = m.cfg.colors;
  hud.setCfg(m.cfg);
  renderer.init(m.cfg);
  renderer.primeDepth(m.depth);
  renderer.setLayers(m.layersFrom, m.rows);
  hud.setScores(m.scores);
});

session.on('layers', m => renderer.setLayers(m.from, m.rows));

session.on('snap', m => {
  renderer.applySnap(m, session.id);
  hud.applySnap(m, session.id);
  for (const ev of m.ev) {
    if (ev.k === 'pickup') {
      renderer.applyPickup(ev);
    } else if (ev.k === 'join') {
      hud.toast(`${ev.name} DROPPED IN`, '#2bfcff');
    } else if (ev.k === 'leave') {
      hud.toast(`${ev.name} LEFT`, '#59639c');
    } else if (ev.k === 'levelup') {
      hud.toast(`LEVEL ${ev.level}`, '#ffe93d');
    } else if (ev.k === 'hit' && ev.id === session.id) {
      hud.toast(`OUCH — ${ev.lives} LEFT`, '#ff4d5e');
    } else if (ev.k === 'death') {
      hud.toast(`${ev.name} DIED AT ${ev.score}`, '#ff3df0');
      if (ev.id === session.id) hud.showDeath(ev.entry);
    } else if (ev.k === 'reset') {
      hud.toast('THE PIT RESETS', '#3dff6e');
    }
  }
});

session.on('scores', m => hud.setScores(m.board));
session.on('joined', () => hud.onJoined());
session.on('reject', m => hud.joinError(m.reason));
session.on('closed', () => hud.disconnected());

hud.onJoin = name => session.join(name);
hud.onRejoin = name => session.rejoin(name);

let camMode = 'chase';
renderer.setCamera(camMode);
hud.setCamMode(camMode);
hud.onCamToggle = () => {
  camMode = camMode === 'ortho' ? 'chase' : 'ortho';
  renderer.setCamera(camMode);
  hud.setCamMode(camMode);
};

let quarter = 0;
hud.onRotate = dq => {
  quarter += dq;
  renderer.setRotation(quarter);
};

const DIR_RING = ['n', 'e', 's', 'w'];
const remap = dir =>
  DIR_RING[(((DIR_RING.indexOf(dir) - quarter) % 4) + 4) % 4];

bindInput(dir => session.move(remap(dir)));

function loop(t) {
  renderer.frame(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
