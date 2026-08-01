export function createSession() {
  const listeners = new Map();
  const emit = (ev, data) => {
    for (const fn of listeners.get(ev) || []) fn(data);
  };

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  let myId = null;

  ws.addEventListener('message', e => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.t === 'joined') myId = msg.id;
    emit(msg.t, msg);
  });
  ws.addEventListener('close', () => emit('closed', {}));
  ws.addEventListener('error', () => emit('closed', {}));

  const send = msg => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  return {
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    join(name) {
      send({ t: 'join', name });
    },
    rejoin(name) {
      send({ t: 'rejoin', name });
    },
    move(dir) {
      send({ t: 'move', dir });
    },
    get id() {
      return myId;
    }
  };
}
