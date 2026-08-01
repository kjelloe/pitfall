const $ = id => document.getElementById(id);

export function createHud() {
  const hud = {
    onJoin: () => {},
    onRejoin: () => {}
  };

  let lastName = '';
  let lastBoard = [];
  let lastEntry = null;
  let inGame = false;

  const joinOverlay = $('join-overlay');
  const deathOverlay = $('death-overlay');
  const nameInput = $('join-name');

  const show = (el, on) => el.classList.toggle('hidden', !on);

  function submitJoin() {
    const name = nameInput.value.trim() || 'ANON';
    lastName = name;
    $('join-err').textContent = '';
    hud.onJoin(name);
  }
  $('join-btn').addEventListener('click', submitJoin);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitJoin();
  });
  $('rejoin-btn').addEventListener('click', () => {
    show(deathOverlay, false);
    hud.onRejoin(lastName);
  });
  nameInput.focus();

  function renderBoard(table, youEntry) {
    let html =
      '<tr><th>#</th><th>NAME</th><th>SCORE</th><th>DEPTH</th><th>JOIN</th></tr>';
    lastBoard.slice(0, 10).forEach((e, i) => {
      const you =
        youEntry &&
        e.name === youEntry.name &&
        e.score === youEntry.score &&
        e.date === youEntry.date;
      html += `<tr${you ? ' class="you"' : ''}><td>${i + 1}</td><td>${
        e.name
      }</td><td>${e.score}</td><td>L${e.deepest}</td><td>L${e.joinLevel}</td></tr>`;
    });
    table.innerHTML = html;
  }

  hud.setScores = board => {
    lastBoard = board || [];
    if (!deathOverlay.classList.contains('hidden') && lastEntry) {
      renderBoard($('death-board'), lastEntry);
    }
  };

  hud.onJoined = () => {
    inGame = true;
    show(joinOverlay, false);
    show(deathOverlay, false);
    show($('topbar'), true);
    show($('players'), true);
    show($('help'), true);
    nameInput.blur();
  };

  hud.joinError = reason => {
    const msgs = { full: 'PIT IS FULL (16 MAX) — TRY AGAIN SOON' };
    $('join-err').textContent = msgs[reason] || 'JOIN FAILED: ' + reason;
    show(joinOverlay, true);
  };

  hud.showDeath = entry => {
    inGame = false;
    lastEntry = entry;
    $('death-stats').textContent =
      `SCORE ${entry.score} · REACHED L${entry.deepest} · ` +
      `JOINED L${entry.joinLevel} · SURVIVED ${entry.traveled} LEVEL${
        entry.traveled === 1 ? '' : 'S'
      }`;
    renderBoard($('death-board'), entry);
    show(deathOverlay, true);
  };

  hud.disconnected = () => {
    show(deathOverlay, false);
    show(joinOverlay, true);
    $('join-err').textContent = 'DISCONNECTED — REFRESH THE PAGE';
    $('join-btn').disabled = true;
  };

  hud.applySnap = (snap, myId) => {
    const me = snap.players.find(p => p.id === myId);
    if (me && inGame) {
      $('hud-score').textContent = me.score;
      $('hud-gold').textContent = me.gold;
      $('hud-lives').textContent = '♥'.repeat(Math.max(0, me.lives)) || '0';
      $('hud-level').textContent = snap.level;
      $('hud-depth').textContent = Math.floor(snap.depth);
    }
    const rows = snap.players
      .slice()
      .sort((a, b) => b.score - a.score)
      .map(
        p =>
          `<div class="row${p.status === 'dead' ? ' dead' : ''}">` +
          `<span class="nm" style="color:${window.__colors[p.color]}">` +
          `${p.id === myId ? '&#9654; ' : ''}${p.name}</span>` +
          `<span>${p.score}</span></div>`
      );
    $('players').innerHTML =
      `<div class="row"><span>PLAYERS ${
        snap.players.filter(p => p.status === 'alive').length
      }/16</span><span>L${snap.level}</span></div>` + rows.join('');
  };

  hud.toast = (text, color) => {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.color = color;
    $('toasts').appendChild(div);
    setTimeout(() => div.remove(), 3100);
  };

  return hud;
}
