/** MkMk Re Maze — UI / エントリ */

import {
  createGame,
  serializeState,
  serializeDelta,
  restoreState,
  applyDelta,
  tryMove,
  formatTime,
  elapsedMs,
  PLAYER_COLORS,
  MAX_PLAYERS,
  SINGLE_SIZE,
  DEFAULT_ONLINE_SIZE,
  MOVE_COOLDOWN_MS,
  MOVE_REPEAT_DELAY_MS,
  MOVE_REPEAT_RATE_MS,
} from './game.js';
import { generateMaze, PATH, isPassable } from './maze.js';
import { createNet } from './net.js';
import { createRenderer } from './render.js';
import { createInput, prefersTouchUI } from './input.js';
import { bindAudioUnlock, ensureAudio, playSound } from './audio.js';

const MOVE_DELTA = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const BEST_KEY = 'mkmk_remaze_best_single';

const app = {
  mode: null, // single | host | guest
  net: null,
  game: null,
  localSeat: 0,
  localName: 'プレイヤー',
  lobbyPlayers: [],
  renderer: null,
  input: null,
  raf: 0,
  lastMoveAt: 0,
  pendingDir: null,
  holdDir: null,
  holdStartedAt: 0,
  stepsThisHold: 0,
  holdActive: false,
  resultShown: false,
  unbindTouch: [],
};

function showScreen(id) {
  $$('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
}

function setStatus(msg, kind = 'info') {
  const el = $('#net-status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function saveRejoinSession() {
  if (app.mode === 'single' || !app.net?.roomCode) return;
  try {
    sessionStorage.setItem(
      'mkmk_remaze_rejoin',
      JSON.stringify({ room: app.net.roomCode, name: app.localName, seat: app.localSeat }),
    );
  } catch (_) {
    /* ignore */
  }
}

function readRejoinSession(roomCode) {
  try {
    const raw = sessionStorage.getItem('mkmk_remaze_rejoin');
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j?.room === roomCode) return j;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function findRejoinSeat(g, name, rejoinSeat) {
  const nm = String(name || '').trim();
  if (!nm) return -1;
  if (typeof rejoinSeat === 'number' && rejoinSeat >= 0 && rejoinSeat < g.players.length) {
    const p = g.players[rejoinSeat];
    if (p && p.name === nm && (p.offline || !p.peerId)) return rejoinSeat;
  }
  return g.players.findIndex((p) => p.name === nm && (p.offline || !p.peerId));
}

/* ===== Title maze backdrop ===== */
function paintTitleMaze() {
  const canvas = $('#title-maze');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const maze = generateMaze(41, 510151);
  const n = maze.size;
  const cell = canvas.width / n;
  ctx.fillStyle = '#0a0c0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (maze.grid[y][x] === PATH) {
        const fog = Math.hypot(x - n * 0.35, y - n * 0.4) / n;
        const a = Math.max(0.05, 0.55 - fog * 0.7);
        ctx.fillStyle = `rgba(242,240,234,${a})`;
        ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
  }
}

/* ===== Screens ===== */
function bindTitle() {
  $('#btn-single').onclick = () => {
    ensureAudio();
    playSound('ui');
    app.mode = 'single';
    startSingle();
  };
  $('#btn-host').onclick = () => {
    ensureAudio();
    playSound('ui');
    openLobby('host');
  };
  $('#btn-join').onclick = () => {
    ensureAudio();
    playSound('ui');
    openLobby('guest');
  };
  $('#btn-howto').onclick = () => {
    ensureAudio();
    playSound('ui');
    showScreen('screen-howto');
  };
  $('#btn-howto-back').onclick = () => {
    playSound('ui');
    showScreen('screen-title');
  };
}

function startSingle() {
  app.net?.destroy();
  app.net = null;
  app.game = createGame({
    mode: 'single',
    size: SINGLE_SIZE,
    players: [{ name: app.localName || 'プレイヤー', color: PLAYER_COLORS[0] }],
  });
  app.localSeat = 0;
  app.resultShown = false;
  enterGame();
}

async function openLobby(role) {
  app.mode = role;
  app.game = null;
  app.resultShown = false;
  showScreen('screen-lobby');
  $('#lobby-role').textContent = role === 'host' ? 'ホスト（部屋を作る）' : 'ゲスト（部屋に入る）';
  $('#lobby-room-wrap').hidden = role === 'host';
  $('#lobby-host-tools').hidden = role !== 'host';
  $('#btn-lobby-start').hidden = role !== 'host';
  $('#lobby-code-display').textContent = '------';
  $('#lobby-players').innerHTML = '';
  $('#lobby-size').value = String(DEFAULT_ONLINE_SIZE);
  setStatus(role === 'host' ? '「接続」で部屋を開きます' : '部屋コードを入れて「接続」');

  $('#btn-lobby-back').onclick = () => {
    playSound('ui');
    app.net?.destroy();
    app.net = null;
    showScreen('screen-title');
  };

  $('#btn-lobby-connect').onclick = async () => {
    ensureAudio();
    playSound('ui');
    try {
      const name = $('#lobby-name').value.trim() || 'プレイヤー';
      app.localName = name;
      const roomInput = $('#lobby-room').value.trim().toUpperCase();
      if (role === 'guest' && roomInput.length < 4) return toast('部屋コードを入力してください');

      app.net?.destroy();
      app.net = createNet({
        role,
        roomCode: role === 'guest' ? roomInput : undefined,
        onStatus: ({ msg, kind }) => setStatus(msg, kind),
        onEvent: handleNetEvent,
      });
      const info = await app.net.start();
      $('#lobby-code-display').textContent = info.roomCode;
      if (role === 'host') {
        app.lobbyPlayers = [
          { peerId: info.peerId, name, color: PLAYER_COLORS[0], isHost: true },
        ];
        renderLobbyPlayers();
        app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
      } else {
        const rejoin = readRejoinSession(roomInput);
        app.net.sendToHost({
          type: 'hello',
          name,
          peerId: info.peerId,
          rejoinSeat: rejoin?.seat,
        });
      }
    } catch (e) {
      setStatus(e.message || String(e), 'error');
      toast('接続に失敗しました');
    }
  };

  $('#btn-lobby-start').onclick = () => {
    if (app.mode !== 'host') return;
    ensureAudio();
    playSound('ui');
    if (app.lobbyPlayers.length < 1) return toast('プレイヤーがいません');
    let size = Number($('#lobby-size').value) || DEFAULT_ONLINE_SIZE;
    if (size % 2 === 0) size += 1;
    size = Math.min(99, Math.max(15, size));
    const players = app.lobbyPlayers.map((p, i) => ({
      peerId: p.peerId,
      name: p.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      isHost: !!p.isHost,
    }));
    app.game = createGame({ mode: 'online', size, players });
    app.localSeat = 0;
    app.resultShown = false;
    app.net.broadcast({ type: 'game_start', state: serializeState(app.game) });
    enterGame();
    saveRejoinSession();
  };

  $('#btn-copy-code').onclick = async () => {
    const code = $('#lobby-code-display').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast('部屋コードをコピーしました');
    } catch {
      toast(code);
    }
  };
}

function renderLobbyPlayers() {
  const box = $('#lobby-players');
  box.innerHTML = app.lobbyPlayers
    .map(
      (p, i) => `
    <div class="lobby-player" style="--pc:${p.color || PLAYER_COLORS[i]}">
      <span class="lp-dot"></span>
      <span>${escapeHtml(p.name)}${p.isHost ? '（ホスト）' : ''}</span>
    </div>`,
    )
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function handleNetEvent({ from, data }) {
  if (!data) return;

  if (app.mode === 'host') {
    if (data.type === 'hello') {
      if (app.game) {
        const seat = findRejoinSeat(app.game, data.name, data.rejoinSeat);
        if (seat >= 0) {
          const pl = app.game.players[seat];
          pl.peerId = data.peerId || from;
          pl.offline = false;
          app.net.sendTo(from, {
            type: 'game_rejoin',
            state: serializeState(app.game),
            seat,
          });
          syncState();
          return;
        }
        app.net.sendTo(from, { type: 'game_already' });
        return;
      }
      if (app.lobbyPlayers.length >= MAX_PLAYERS) {
        app.net.sendTo(from, { type: 'lobby_full' });
        return;
      }
      // 同名の切断枠がなければ新規
      const i = app.lobbyPlayers.length;
      app.lobbyPlayers.push({
        peerId: data.peerId || from,
        name: data.name || `P${i + 1}`,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      });
      renderLobbyPlayers();
      app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
      return;
    }
    if (data.type === 'move') {
      handleHostMove(from, data);
      return;
    }
    if (data.type === 'peer_left') {
      if (!app.game) {
        app.lobbyPlayers = app.lobbyPlayers.filter((p) => p.peerId !== data.peerId);
        renderLobbyPlayers();
        app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
        return;
      }
      const seat = app.game.players.findIndex((p) => p.peerId === data.peerId);
      if (seat >= 0) {
        app.game.players[seat].offline = true;
        app.game.players[seat].peerId = null;
        syncState();
      }
    }
  }

  if (app.mode === 'guest') {
    if (data.type === 'lobby_sync') {
      app.lobbyPlayers = data.players;
      renderLobbyPlayers();
      return;
    }
    if (data.type === 'lobby_full') {
      toast('部屋が満員です（最大8人）');
      return;
    }
    if (data.type === 'game_start' || data.type === 'game_rejoin') {
      app.game = restoreState(data.state);
      const myPeer = app.net.peerId;
      if (data.type === 'game_rejoin' && typeof data.seat === 'number') {
        app.localSeat = data.seat;
        app.game.players[app.localSeat].peerId = myPeer;
        app.game.players[app.localSeat].offline = false;
      } else {
        app.localSeat = app.game.players.findIndex((p) => p.peerId === myPeer);
        if (app.localSeat < 0) app.localSeat = 0;
      }
      app.resultShown = false;
      enterGame();
      if (data.type === 'game_rejoin') toast('再接続しました');
      saveRejoinSession();
      return;
    }
    if (data.type === 'game_already') {
      toast('進行中です。同じ名前で再接続を試してください');
      return;
    }
    if (data.type === 'state') {
      app.game = restoreState(data.state);
      if (app.game.phase === 'finished' && !app.resultShown) showResult();
      return;
    }
    if (data.type === 'delta') {
      if (!app.game) return;
      applyDelta(app.game, data);
      if (app.game.phase === 'finished' && !app.resultShown) showResult();
      return;
    }
    if (data.type === 'reject') {
      toast(data.reason || '操作が拒否されました');
    }
  }
}

function handleHostMove(from, data) {
  if (!app.game || app.game.phase !== 'playing') return;
  const seat = app.game.players.findIndex((p) => p.peerId === from || p.peerId === data.peerId);
  if (seat < 0) return;
  const result = tryMove(app.game, seat, data.dir);
  if (!result.ok) return;
  syncDelta(result.opened);
  if (result.finished && !app.resultShown) showResult();
}

function syncState() {
  if (app.mode === 'host' && app.net && app.game) {
    app.net.broadcast({ type: 'state', state: serializeState(app.game) });
  }
}

function syncDelta(opened = []) {
  if (app.mode === 'host' && app.net && app.game) {
    app.net.broadcast(serializeDelta(app.game, opened));
  }
}

function enterGame() {
  ensureAudio();
  playSound('start');
  showScreen('screen-game');
  document.body.classList.add('playing');
  $('#hud-mode').textContent = app.mode === 'single' ? 'SINGLE' : 'ONLINE';
  $('#hud-size').textContent = `${app.game.maze.size}×${app.game.maze.size}`;
  refreshTouchChrome();

  if (!app.renderer) {
    app.renderer = createRenderer($('#canvas-overview'), $('#canvas-local'));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  }
  onResize();
  updateRoster();
  startLoop();
  saveRejoinSession();
}

function onResize() {
  app.renderer?.resize();
  refreshTouchChrome();
}

function refreshTouchChrome() {
  const touch = prefersTouchUI() || window.innerWidth <= 900;
  const box = $('#touch-controls');
  if (box) box.hidden = !touch || !$('#screen-game')?.classList.contains('active');
  document.body.classList.toggle('touch-ui', touch);
}

function startLoop() {
  cancelAnimationFrame(app.raf);
  const tick = () => {
    if (!app.game) return;
    // ゲームパッド／押しっぱなしを毎フレーム同期（方向変化時のみホールドをリセット）
    const heldDir = app.input?.tick?.();
    if (heldDir) {
      if (heldDir !== app.holdDir) {
        app.holdDir = heldDir;
        app.holdStartedAt = performance.now();
        app.stepsThisHold = 0;
      }
      app.pendingDir = heldDir;
    } else if (!app.input?.isHeld?.()) {
      app.holdDir = null;
    }
    processPendingMove();
    $('#hud-timer').textContent = formatTime(elapsedMs(app.game));
    app.renderer?.draw(app.game, app.localSeat);
    updateRoster();
    updateInputBadge();
    const me = app.game.players[app.localSeat];
    if (me) {
      const screen = $('#screen-game');
      if (screen) {
        screen.dataset.px = String(me.x);
        screen.dataset.py = String(me.y);
      }
    }
    if (app.game.phase === 'finished' && !app.resultShown) showResult();
    app.raf = requestAnimationFrame(tick);
  };
  app.raf = requestAnimationFrame(tick);
}

function updateInputBadge() {
  const el = $('#input-badge');
  if (!el) return;
  const n = app.input?.padCount || 0;
  if (n > 0) {
    el.hidden = false;
    el.textContent = 'コントローラー接続中';
  } else {
    el.hidden = true;
  }
}

function updateRoster() {
  if (!app.game) return;
  const box = $('#roster');
  const rows = [...app.game.players].sort((a, b) => {
    if (a.finished && b.finished) return a.finishMs - b.finishMs;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return a.id - b.id;
  });
  box.innerHTML = rows
    .map((p) => {
      const time = p.finished ? formatTime(p.finishMs) : p.offline ? '切断' : '探索中';
      return `<div class="roster-row${p.id === app.localSeat ? ' me' : ''}${p.finished ? ' done' : ''}" style="--pc:${p.color}">
        <span class="roster-dot"></span>
        <span>${escapeHtml(p.name)}</span>
        <span class="roster-time">${time}</span>
      </div>`;
    })
    .join('');
}

function requestMove(dir) {
  if (!app.game || app.game.phase !== 'playing') return;
  if (dir !== app.holdDir) {
    app.holdDir = dir;
    app.holdStartedAt = performance.now();
    app.stepsThisHold = 0;
  }
  app.pendingDir = dir;
}

function processPendingMove() {
  if (!app.pendingDir || !app.game) return;
  const now = performance.now();
  const dir = app.pendingDir;
  const held = !!app.input?.isHeld?.();

  // 単押しは1マスのみ。連移は長押し後にゆっくり
  if (app.stepsThisHold === 0) {
    if (now - app.lastMoveAt < 50) return;
  } else if (held && app.holdDir === dir) {
    const elapsed = now - app.holdStartedAt;
    const need = MOVE_REPEAT_DELAY_MS + (app.stepsThisHold - 1) * MOVE_REPEAT_RATE_MS;
    if (elapsed < need) return;
    if (now - app.lastMoveAt < MOVE_COOLDOWN_MS) return;
  } else {
    app.pendingDir = null;
    return;
  }

  if (app.mode === 'guest') {
    playLocalMoveSe(dir);
    app.net?.sendToHost({ type: 'move', dir, peerId: app.net.peerId });
    app.lastMoveAt = now;
    app.stepsThisHold += 1;
    if (!held) {
      app.pendingDir = null;
      app.holdDir = null;
    }
    return;
  }

  const result = tryMove(app.game, app.localSeat, dir, now);
  if (result.reason === 'cooldown') return;

  // 壁ヒットも1操作として数え、単押しが連打扱いになるのを防ぐ
  app.lastMoveAt = now;
  app.stepsThisHold += 1;
  if (!held) {
    app.pendingDir = null;
    app.holdDir = null;
  }
  playMoveResultSe(result);
  if (result.ok) {
    if (app.mode === 'host') syncDelta(result.opened);
    if (result.finished && !app.resultShown) showResult();
  }
}

/** ゲスト向け：ローカル予測で移動／壁SE */
function playLocalMoveSe(dir) {
  ensureAudio();
  const me = app.game?.players[app.localSeat];
  const d = MOVE_DELTA[dir];
  if (!me || !d) return;
  if (!isPassable(app.game.maze.grid, me.x + d.x, me.y + d.y)) {
    playSound('hit');
  } else {
    playSound('move');
  }
}

function playMoveResultSe(result) {
  ensureAudio();
  if (result?.ok) playSound('move');
  else if (result?.reason === 'wall') playSound('hit');
}

function bindControls() {
  app.input = createInput({
    onMove: (dir) => requestMove(dir),
    onHoldChange: (held) => {
      app.holdActive = held;
    },
    isTypingTarget: (el) => ['INPUT', 'TEXTAREA'].includes(el?.tagName),
  });

  app.unbindTouch = [
    app.input.bindDpad($('#dpad')),
    app.input.bindSwipeSurface($('#overview-wrap'), 36),
    app.input.bindSwipeSurface($('#local-wrap'), 32),
  ];

  $('#btn-quit').onclick = () => {
    playSound('ui');
    quitToTitle();
  };

  // タッチUIの初期判定
  refreshTouchChrome();
  window.addEventListener('resize', refreshTouchChrome);

  // iOS のダブルタップズーム抑制（ゲーム中）
  document.addEventListener(
    'gesturestart',
    (e) => {
      if (document.body.classList.contains('playing')) e.preventDefault();
    },
    { passive: false },
  );
}

function quitToTitle() {
  cancelAnimationFrame(app.raf);
  app.game = null;
  app.resultShown = false;
  app.pendingDir = null;
  app.holdDir = null;
  app.stepsThisHold = 0;
  document.body.classList.remove('playing');
  const box = $('#touch-controls');
  if (box) box.hidden = true;
  if (app.mode === 'host' || app.mode === 'guest') {
    app.net?.destroy();
    app.net = null;
  }
  app.mode = null;
  showScreen('screen-title');
}

function showResult() {
  if (!app.game || app.resultShown) return;
  app.resultShown = true;
  ensureAudio();
  playSound('clear');
  document.body.classList.remove('playing');
  const box = $('#touch-controls');
  if (box) box.hidden = true;
  showScreen('screen-result');

  const winner = app.game.players[app.game.winnerId];
  const myFinish = app.game.players[app.localSeat]?.finishMs;

  if (app.mode === 'single') {
    $('#result-title').textContent = 'クリア！';
    $('#result-time').textContent = formatTime(myFinish ?? elapsedMs(app.game));
    const best = saveBestTime(myFinish);
    $('#result-best').textContent = best != null ? `自己ベスト: ${formatTime(best)}` : '';
    $('#result-rankings').innerHTML = '';
  } else {
    const isWin = app.game.winnerId === app.localSeat;
    $('#result-title').textContent = isWin ? '勝利！' : `${winner?.name || '誰か'} の勝利`;
    $('#result-time').textContent = winner ? formatTime(winner.finishMs) : '—';
    $('#result-best').textContent = '';
    const ranks = app.game.rankings.length
      ? app.game.rankings
      : app.game.players
          .filter((p) => p.finished)
          .sort((a, b) => a.finishMs - b.finishMs)
          .map((p) => ({ name: p.name, finishMs: p.finishMs, color: p.color }));
    $('#result-rankings').innerHTML = ranks
      .map(
        (r, i) => `
      <div class="rank-row">
        <span class="n">${i + 1}</span>
        <span style="color:${r.color || '#fff'}">${escapeHtml(r.name)}</span>
        <span>${formatTime(r.finishMs)}</span>
      </div>`,
      )
      .join('');
  }

  $('#btn-result-again').onclick = () => {
    ensureAudio();
    playSound('ui');
    if (app.mode === 'single') {
      startSingle();
    } else if (app.mode === 'host') {
      // 同じメンバー・サイズでもう一戦
      const size = app.game.maze.size;
      const players = app.game.players.map((p) => ({
        peerId: p.peerId,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
      }));
      app.game = createGame({ mode: 'online', size, players });
      app.localSeat = 0;
      app.resultShown = false;
      app.net.broadcast({ type: 'game_start', state: serializeState(app.game) });
      enterGame();
    } else {
      toast('ホストが次のゲームを開始するまでお待ちください');
      // 観戦用に結果画面から戻せるようにゲーム画面へ
      app.resultShown = true;
      showScreen('screen-game');
    }
  };
  $('#btn-result-title').onclick = () => {
    playSound('ui');
    quitToTitle();
  };
}

function saveBestTime(ms) {
  if (ms == null) return readBestTime();
  const prev = readBestTime();
  if (prev == null || ms < prev) {
    try {
      localStorage.setItem(BEST_KEY, String(Math.floor(ms)));
    } catch (_) {
      /* ignore */
    }
    return Math.floor(ms);
  }
  return prev;
}

function readBestTime() {
  try {
    const v = localStorage.getItem(BEST_KEY);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function init() {
  bindAudioUnlock();
  paintTitleMaze();
  bindTitle();
  bindControls();
  showScreen('screen-title');
}

init();
