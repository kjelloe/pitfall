# Drop-in / re-join multiplayer for browser + mobile — how Pitfall: Drop-Zone does it

*Written 2026-08-02 for a coding ally building a similar game. Everything
here is running in production in this repo: `server/server.js` (transport,
seats, persistence), `server/game.js` (authoritative sim),
`client/session.js` (reconnect), `test/smoke.test.js` (the scenarios that
matter). Our context: a realtime 16-player falling-pit arcade — one Node
process, `ws` WebSocket, 20 Hz tick, JSON messages, server-authoritative
everything. No turns, so nobody ever waits on an absent player; adapt
accordingly if your game blocks on players.*

## The one mental model that matters

**Connection state and player presence are different things.** The socket
is a transport that WILL drop constantly on mobile — backgrounded tabs get
frozen (iOS) or throttled-then-killed (Android), and the WebSocket dies
with close code 1006, no clean handshake. Presence is a server-side fact
with a timeout. Once those are separated, a backgrounded phone is a normal
event, not an error path.

Corollaries that fall out of this model:

- Heartbeats don't help. A frozen page can't send them; raising the ping
  rate only costs battery. We have none.
- Never branch on close codes client-side. Mobile resume is almost always
  1006; treat every close as recoverable.
- Any design that frees a seat when its socket closes will lose players'
  runs to a two-second lock screen.

(We got this model from the RetroMultiCiv project's write-up and can
confirm every word of it survived contact with real phones.)

## Drop-in (joining a game already in progress)

One always-open session per server. The join flow:

1. On **connection** (before any join), the server sends `hello`: full
   config (grid size, caps, colors — client hardcodes nothing), current
   depth, the world stream so far, live player list, leaderboard. A
   connected-but-not-joined client is a spectator with a full picture.
2. `{t:'join', name}` → seat assigned at the session's **current** depth.
3. **Fairness rule** (the thing that makes drop-in socially workable):
   late joiners score only what they survive. We store `joinLevel` on the
   player and every score derives from `levels_traveled = level −
   joinLevel`, never from session depth. Nobody inherits progress.
4. **Anti-abuse rule**: re-join after death = a brand-new run (score 0,
   new joinLevel). Otherwise dying cheaply resets nothing.

Server-side validation of everything (moves, cooldowns, pickups, deaths);
the client renders snapshots and sends intents. This matters for
reconnects: because the server owns ALL state, the client needs to persist
almost nothing (see below).

## Re-join / reconnect: the four layers

### 1. Server: seats with a grace window

A dropped socket does NOT free the seat. It marks it disconnected and a
sweep in the tick loop enforces a grace period (ours: 45 s, one constant,
overridable in tests):

```js
const seats = new Map(); // token -> { playerId, ws, disconnectedAt, entry }

ws.on('close', () => {
  const seat = myToken && seats.get(myToken);
  if (seat && seat.ws === ws) seat.disconnectedAt = Date.now();
});

// in the 20 Hz tick:
for (const [token, seat] of seats) {
  if (seat.disconnectedAt && now - seat.disconnectedAt > graceMs) {
    game.removePlayer(seat.playerId);
    seats.delete(token);
  }
}
```

In our realtime game the avatar **keeps falling while disconnected** — the
pit waits for nobody — and can die naturally. When it does, we stash the
death entry on the seat so the returning player gets their death screen.
Accepted trade-off: disconnected-but-alive ghosts count toward the player
cap and block session reset for at most the grace window.

### 2. Identity lives in a token, not a socket

`join` mints a crypto-random token, returned in the ack:
`{t:'joined', id, token}`. The client stores it in localStorage **at join
time** (not at page-hide — more below). Any later socket can present it:

```
client → {t:'reclaim', token}
server → {t:'joined', id, token, entry?}     // same seat, idempotent
       | {t:'reclaim', ok:false}             // seat gone
```

Reclaim rules that must hold:

- **Idempotent** — reclaiming never mints a second seat.
- **Supersede, don't refuse** — if another socket is still bound to the
  seat (old tab, zombie connection), close it (we use code 4000) and bind
  the new one. Same person, new tab/device wins.
- **Dead seats are reclaimable within grace** — the reply carries the
  stored death `entry` so the client can show the death screen for a death
  that happened while away.
- Refusal must be classified and actionable (layer 4).

### 3. Client: reconnect relentlessly, persist almost nothing

The whole client reconnect policy is ~20 lines:

- On every socket close: emit a UI event (we show a pulsing RECONNECTING
  banner), then retry — 1 s, backing off ×1.7 to a 5 s cap.
- **On `visibilitychange → visible`: reconnect immediately.** That is the
  exact moment the player is looking at the screen and the radio is back.
  This one listener is most of the perceived mobile quality.
- On every socket open: if a token exists, send `reclaim` straight away.
- Every connection gets a fresh `hello`, so the renderer must tolerate
  re-initialization: guard one-time scene setup with a flag, and clear
  any world-stream caches before applying the new hello.

Because the server owns all state, the token IS the autosave. We write it
at join time inside try/catch (storage quota failures must not kill the
game) and that's the entire client persistence story. If your
architecture keeps meaningful state client-side, you'll also need
pagehide/visibilitychange autosave hooks — `beforeunload` never reliably
fires on mobile.

### 4. Never strand the player: classify the failure

The bug that playtesting found for us: player backgrounds long enough for
the run to end AND grace to expire → client reconnects fine → server says
"unknown seat" → our handler had an early-return guard → **frozen HUD,
recoverable only via browser refresh**. The transport layer was perfect
and the UX was still broken.

The rule: a refused reclaim must always transition the UI to a screen
whose primary button acts. Ours hides the in-game HUD and shows the join
overlay with "YOUR RUN ENDED WHILE YOU WERE AWAY — DROP BACK IN", name
prefilled from localStorage — one tap back into the game. If the death
overlay is already up, its rejoin button serves instead. Test this exact
path in a real browser (we force-drop sockets and delete the seat
server-side, then assert the screen appears and the button re-joins).

## The half everyone forgets: server restarts

Moving all state server-side trades a client-persistence problem for a
server-persistence one — the token is only useful if the server still
remembers the game, and on a shared box **every deploy restarts the
process**. (Credit to the same ally for calling this out before it bit
us.)

Our answer, ~60 lines: serialize the session (world state, players, seats
with their tokens) to a JSON file every 5 s, **plus synchronously on
shutdown**. systemd sends SIGTERM on restart, so a deploy is a lossless
handoff; a hard crash loses at most 5 s. On boot, restore if the file is
younger than the grace window, with every restored seat's grace clock
restarted; clients auto-reconnect (they're already retrying at 1 s) and
reclaim. Net effect: a deploy costs a mid-run player ~3 seconds of
RECONNECTING banner.

Details that matter:

- Keep the session file OUT of your deploy sync path and in a directory
  the service user can write (`ProtectSystem` + relative paths = silent
  EROFS failures).
- Drop restored players that have no seat; reject stale files (older than
  grace — every seat would have expired anyway).
- Wire SIGTERM/SIGINT → your normal close() (which saves) only in the
  standalone entrypoint, not in library mode, or your test runner will
  accumulate signal handlers.

## A streamed-world gotcha: regeneration needs an epoch signal

Our world is an append-only stream of generated layers, broadcast from a
cursor. When the session resets (everyone died, new player joins), the
server regenerates the stream from scratch — and the cursor was suddenly
beyond `generatedCount()`, so **the fresh world was never re-broadcast**;
connected clients kept stale geometry and fell through invisible levels.

Generalized: if a world stream can ever be rebuilt, you need an explicit
"start over" signal, and clients must clear their cache on it. We rewind
the cursor and re-broadcast from index 0; clients treat `from === 0` with
a non-empty cache as "clear and rebuild". If you have reconnects (fresh
hello) AND resets (same connection), you need both paths cleared.

## Mobile extras that pulled their weight

- **Screen wake lock** while playing, re-requested on tab-visible — a
  falling game's swipes are too intermittent to keep the phone awake.
- `touch-action: none` on the play surface, `touch-action: manipulation`
  on buttons (kills double-tap zoom), safe-area insets for bottom UI.
- Auto-reclaim on page load means a phone reload lands the player back in
  their run with zero taps — cheap to get once the token flow exists.

## The test matrix (each of these caught a real bug)

Server-level (node --test, real ws clients, tiny grace values via options):

1. Drop socket abruptly (`terminate()`, the 1006 analogue) → seat still
   present after a beat, no leave event.
2. Die while disconnected → reclaim returns same id + the death entry.
3. Grace expiry → seat freed, token refused.
4. **Join → play → kill the whole server → boot a new one on the same
   state dir → reclaim resumes the same live run.** (The deploy path.
   Easy to get wrong, so test it specifically.)
5. Session reset mid-connection → world stream re-broadcast from 0.

Browser-level (headless Chromium driving the real client):

6. Reload the page mid-run → auto-reclaim, no join screen.
7. Force-drop + server forgets the seat → run-ended screen appears, its
   button re-joins successfully.

If you only have budget for two: #4 and #7. The first is the failure your
own deploys cause daily; the second is the one that strands real players.

---

*Questions welcome — and if you improve on the shape (e.g. reconnect-time
delta sync instead of full hello), we'd like to hear it back.*
