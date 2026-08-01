export function createSession() {
  const listeners = new Map();
  const emit = (ev, data) => {
    for (const fn of listeners.get(ev) || []) fn(data);
  };

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws`;
  const TOKEN_KEY = 'dz-token';

  let ws = null;
  let myId = null;
  let retryMs = 1000;
  let token = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch (e) { /* storage unavailable — session won't survive reloads */ }

  function saveToken(t) {
    token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* non-fatal */ }
  }

  const send = msg => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Every close is recoverable — mobile suspends kill sockets with 1006 and
  // no clean handshake. The token reclaims the seat; the socket is disposable.
  function connect() {
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      retryMs = 1000;
      if (token) send({ t: 'reclaim', token });
    });
    ws.addEventListener('message', e => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'joined') {
        myId = msg.id;
        if (msg.token) saveToken(msg.token);
      }
      if (msg.t === 'reclaim' && msg.ok === false) saveToken(null);
      emit(msg.t, msg);
    });
    ws.addEventListener('close', () => {
      emit('closed', {});
      setTimeout(() => {
        if (ws.readyState === WebSocket.CLOSED) connect();
      }, retryMs);
      retryMs = Math.min(5000, Math.round(retryMs * 1.7));
    });
  }

  document.addEventListener('visibilitychange', () => {
    // Reconnect the moment the player is looking again — don't wait a timer.
    if (
      document.visibilityState === 'visible' &&
      ws &&
      ws.readyState === WebSocket.CLOSED
    ) {
      connect();
    }
  });

  connect();

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
