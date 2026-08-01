const KEYMAP = {
  KeyW: 'n', ArrowUp: 'n',
  KeyS: 's', ArrowDown: 's',
  KeyA: 'w', ArrowLeft: 'w',
  KeyD: 'e', ArrowRight: 'e'
};

const REPEAT_MS = 95;
const SWIPE_PX = 26;

export function bindInput(onDir) {
  const held = [];

  const typing = () => {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  };

  document.addEventListener('keydown', e => {
    const dir = KEYMAP[e.code];
    if (!dir || typing()) return;
    e.preventDefault();
    if (e.repeat) return;
    const i = held.indexOf(dir);
    if (i !== -1) held.splice(i, 1);
    held.unshift(dir);
    onDir(dir);
  });

  document.addEventListener('keyup', e => {
    const dir = KEYMAP[e.code];
    if (!dir) return;
    const i = held.indexOf(dir);
    if (i !== -1) held.splice(i, 1);
  });

  window.addEventListener('blur', () => {
    held.length = 0;
  });

  setInterval(() => {
    if (held.length && !typing()) onDir(held[0]);
  }, REPEAT_MS);

  // Touch: swipe on the scene to hop; keep dragging past the threshold to
  // chain hops. Screen-up is north (matches the diorama camera).
  const scene = document.getElementById('scene');
  let touch = null;

  scene.addEventListener(
    'touchstart',
    e => {
      const t = e.changedTouches[0];
      touch = { id: t.identifier, x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );

  scene.addEventListener(
    'touchmove',
    e => {
      if (!touch) return;
      const t = [...e.changedTouches].find(c => c.identifier === touch.id);
      if (!t) return;
      e.preventDefault();
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return;
      const dir =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0 ? 'e' : 'w'
          : dy > 0 ? 's' : 'n';
      touch = { id: touch.id, x: t.clientX, y: t.clientY };
      onDir(dir);
    },
    { passive: false }
  );

  const endTouch = e => {
    if (touch && [...e.changedTouches].some(c => c.identifier === touch.id)) {
      touch = null;
    }
  };
  scene.addEventListener('touchend', endTouch, { passive: true });
  scene.addEventListener('touchcancel', endTouch, { passive: true });
}
