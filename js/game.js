/** MkMk Re Maze — ゲーム状態 */

import {
  generateMaze,
  createMask,
  revealAround,
  isPassable,
  cloneGrid,
  cloneMask,
  maskToList,
  applyMaskList,
} from './maze.js';

export const PLAYER_COLORS = [
  '#e85d4c',
  '#3db8e8',
  '#f0c040',
  '#5ecf7a',
  '#c77dff',
  '#ff8c42',
  '#4ecdc4',
  '#ff6b9d',
];

export const MAX_PLAYERS = 8;
export const SINGLE_SIZE = 45;
export const DEFAULT_ONLINE_SIZE = 55;
export const LOCAL_VIEW = 5; // 5×5
export const REVEAL_RADIUS = 1; // 3×3
/** 2手の最短間隔（ホスト検証・連打抑制） */
export const MOVE_COOLDOWN_MS = 140;
/** 押しっぱなしで2手目に入るまでの待ち */
export const MOVE_REPEAT_DELAY_MS = 300;
/** 2手目以降の連移間隔 */
export const MOVE_REPEAT_RATE_MS = 160;

/**
 * @param {{
 *   mode: 'single'|'online',
 *   size?: number,
 *   seed?: number,
 *   players: Array<{name:string, color?:string, peerId?:string|null, isHost?:boolean}>,
 * }} opts
 */
export function createGame(opts) {
  const size = opts.size || (opts.mode === 'single' ? SINGLE_SIZE : DEFAULT_ONLINE_SIZE);
  const seed = opts.seed ?? (Math.random() * 0xffffffff) >>> 0;
  const maze = generateMaze(size, seed);
  const mask = createMask(maze.size);
  const players = opts.players.map((p, i) => ({
    id: i,
    name: p.name || `P${i + 1}`,
    color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
    peerId: p.peerId ?? null,
    isHost: !!p.isHost,
    x: maze.start.x,
    y: maze.start.y,
    finished: false,
    finishMs: null,
    offline: false,
  }));

  // スタート位置の周囲を開く
  for (const pl of players) {
    revealAround(mask, pl.x, pl.y, REVEAL_RADIUS);
  }

  return {
    mode: opts.mode,
    phase: 'playing', // playing | finished
    maze,
    mask,
    players,
    startedAt: performance.now(),
    winnerId: null,
    rankings: [],
    moveSeq: 0,
    lastMoveAt: players.map(() => 0),
  };
}

export function elapsedMs(game, now = performance.now()) {
  return Math.max(0, now - game.startedAt);
}

export function formatTime(ms) {
  const t = Math.max(0, Math.floor(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function tryMove(game, playerId, dir, now = performance.now()) {
  if (game.phase !== 'playing') return { ok: false, reason: 'finished' };
  const pl = game.players[playerId];
  if (!pl || pl.finished || pl.offline) return { ok: false, reason: 'invalid' };
  const d = DIRS[dir];
  if (!d) return { ok: false, reason: 'dir' };

  if (!game.lastMoveAt) game.lastMoveAt = game.players.map(() => 0);
  if (now - (game.lastMoveAt[playerId] || 0) < MOVE_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown' };
  }

  const nx = pl.x + d.x;
  const ny = pl.y + d.y;
  if (!isPassable(game.maze.grid, nx, ny)) return { ok: false, reason: 'wall' };

  pl.x = nx;
  pl.y = ny;
  game.lastMoveAt[playerId] = now;
  game.moveSeq += 1;
  const opened = revealAround(game.mask, nx, ny, REVEAL_RADIUS);

  let finished = false;
  if (nx === game.maze.goal.x && ny === game.maze.goal.y) {
    pl.finished = true;
    pl.finishMs = elapsedMs(game, now);
    finished = true;
    game.rankings.push({
      id: pl.id,
      name: pl.name,
      color: pl.color,
      finishMs: pl.finishMs,
    });
    if (game.winnerId == null) {
      game.winnerId = pl.id;
      game.phase = 'finished';
    }
  }

  return {
    ok: true,
    x: nx,
    y: ny,
    opened,
    finished,
    winnerId: game.winnerId,
  };
}

export function serializeState(game) {
  return {
    mode: game.mode,
    phase: game.phase,
    seed: game.maze.seed,
    size: game.maze.size,
    grid: game.maze.grid,
    start: game.maze.start,
    goal: game.maze.goal,
    maskList: maskToList(game.mask),
    players: game.players.map((p) => ({ ...p })),
    startedAtOffset: elapsedMs(game),
    winnerId: game.winnerId,
    rankings: game.rankings.slice(),
    moveSeq: game.moveSeq,
  };
}

/** 移動ごとの軽量同期（格子は初回のみ） */
export function serializeDelta(game, opened = []) {
  return {
    type: 'delta',
    players: compactPlayers(game.players),
    opened,
    phase: game.phase,
    winnerId: game.winnerId,
    rankings: game.rankings.slice(),
    moveSeq: game.moveSeq,
    startedAtOffset: elapsedMs(game),
  };
}

export function restoreState(data) {
  const size = data.size;
  const mask = createMask(size);
  applyMaskList(mask, data.maskList || []);
  const now = performance.now();
  return {
    mode: data.mode,
    phase: data.phase,
    maze: {
      size,
      seed: data.seed,
      grid: cloneGrid(data.grid),
      start: { ...data.start },
      goal: { ...data.goal },
    },
    mask,
    players: data.players.map((p) => ({ ...p })),
    startedAt: now - (data.startedAtOffset || 0),
    winnerId: data.winnerId,
    rankings: (data.rankings || []).slice(),
    moveSeq: data.moveSeq || 0,
    lastMoveAt: data.players.map(() => 0),
  };
}

export function applyDelta(game, delta) {
  if (!game || !delta) return;
  if (delta.opened?.length) applyMaskList(game.mask, delta.opened);
  if (delta.players) {
    for (const sp of delta.players) {
      const pl = game.players[sp.id];
      if (!pl) continue;
      pl.x = sp.x;
      pl.y = sp.y;
      pl.finished = sp.finished;
      pl.finishMs = sp.finishMs;
      pl.offline = sp.offline;
      if (sp.peerId !== undefined) pl.peerId = sp.peerId;
      if (sp.name) pl.name = sp.name;
      if (sp.color) pl.color = sp.color;
    }
  }
  if (delta.phase) game.phase = delta.phase;
  if (delta.winnerId !== undefined) game.winnerId = delta.winnerId;
  if (delta.rankings) game.rankings = delta.rankings.slice();
  if (typeof delta.moveSeq === 'number') game.moveSeq = delta.moveSeq;
  if (typeof delta.startedAtOffset === 'number') {
    game.startedAt = performance.now() - delta.startedAtOffset;
  }
}

export function compactPlayers(players) {
  return players.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    finished: p.finished,
    finishMs: p.finishMs,
    offline: p.offline,
    peerId: p.peerId,
    name: p.name,
    color: p.color,
  }));
}

export { cloneMask, cloneGrid };
