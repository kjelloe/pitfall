const KEYMAP = {
  KeyW: 'n', ArrowUp: 'n',
  KeyS: 's', ArrowDown: 's',
  KeyA: 'w', ArrowLeft: 'w',
  KeyD: 'e', ArrowRight: 'e'
};

const REPEAT_MS = 95;

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
}
