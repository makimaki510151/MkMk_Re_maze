import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMaze,
  createMask,
  revealAround,
  isPassable,
  PATH,
  WALL,
  mulberry32,
  countJunctions,
  shortestPathLength,
  isPerfectMaze,
} from '../js/maze.js';
import {
  createGame,
  tryMove,
  serializeState,
  restoreState,
  applyDelta,
  serializeDelta,
  SINGLE_SIZE,
  formatTime,
} from '../js/game.js';

describe('maze generation', () => {
  it('uses odd size and corner start/goal', () => {
    const m = generateMaze(45, 42);
    assert.equal(m.size, 45);
    assert.equal(m.grid[0][0], PATH);
    assert.equal(m.grid[m.size - 1][m.size - 1], PATH);
    assert.deepEqual(m.start, { x: 0, y: 0 });
    assert.deepEqual(m.goal, { x: 44, y: 44 });
  });

  it('bumps even size to odd', () => {
    const m = generateMaze(54, 1);
    assert.equal(m.size, 55);
  });

  it('is deterministic for the same seed', () => {
    const a = generateMaze(21, 999);
    const b = generateMaze(21, 999);
    assert.deepEqual(a.grid, b.grid);
  });

  it('has a path from start to goal (BFS)', () => {
    const m = generateMaze(31, 7);
    const key = (x, y) => `${x},${y}`;
    const seen = new Set([key(0, 0)]);
    const q = [[0, 0]];
    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    let found = false;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === m.goal.x && y === m.goal.y) {
        found = true;
        break;
      }
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isPassable(m.grid, nx, ny)) continue;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    assert.equal(found, true);
    assert.ok(seen.size > 10);
  });

  it('mulberry32 is stable', () => {
    const r = mulberry32(123);
    const vals = [r(), r(), r()];
    const r2 = mulberry32(123);
    assert.deepEqual([r2(), r2(), r2()], vals);
  });

  it('has many junctions and a winding route to goal', () => {
    const seeds = [3, 11, 42, 77, 202];
    for (const seed of seeds) {
      const m = generateMaze(45, seed);
      const junctions = countJunctions(m.grid);
      const dist = shortestPathLength(m.grid, m.start, m.goal);
      const manhattan = (m.size - 1) * 2;
      assert.ok(junctions >= 80, `junctions ${junctions} seed=${seed}`);
      assert.ok(dist >= Math.floor(manhattan * 1.15), `dist ${dist} vs manhattan ${manhattan} seed=${seed}`);
    }
  });

  it('never creates loops (perfect maze / tree)', () => {
    for (const seed of [1, 5, 9, 42, 100, 999]) {
      for (const size of [21, 45, 55]) {
        const m = generateMaze(size, seed);
        assert.equal(isPerfectMaze(m.grid), true, `loop detected size=${size} seed=${seed}`);
      }
    }
  });
});

describe('mask reveal', () => {
  it('opens 3x3 around a cell', () => {
    const mask = createMask(9);
    const opened = revealAround(mask, 4, 4, 1);
    assert.equal(opened.length / 2, 9);
    assert.equal(mask[4][4], true);
    assert.equal(mask[3][3], true);
    assert.equal(mask[5][5], true);
    assert.equal(mask[0][0], false);
  });

  it('does not re-open already revealed cells', () => {
    const mask = createMask(5);
    revealAround(mask, 2, 2, 1);
    const second = revealAround(mask, 2, 2, 1);
    assert.equal(second.length, 0);
  });
});

describe('game', () => {
  it('creates single 45x45 game with start mask open', () => {
    const g = createGame({
      mode: 'single',
      players: [{ name: 'A' }],
    });
    assert.equal(g.maze.size, SINGLE_SIZE);
    assert.equal(g.players[0].x, 0);
    assert.equal(g.players[0].y, 0);
    assert.equal(g.mask[0][0], true);
    assert.equal(g.mask[1][1], true);
  });

  it('blocks wall moves and allows path moves', () => {
    const g = createGame({
      mode: 'single',
      size: 15,
      seed: 3,
      players: [{ name: 'A' }],
    });
    // Force a controlled grid: open right, wall down
    g.maze.grid = Array.from({ length: 15 }, () => Array(15).fill(WALL));
    g.maze.grid[0][0] = PATH;
    g.maze.grid[0][1] = PATH;
    g.maze.grid[14][14] = PATH;
    g.maze.start = { x: 0, y: 0 };
    g.maze.goal = { x: 14, y: 14 };
    g.lastMoveAt[0] = 0;

    const wall = tryMove(g, 0, 'down', 1000);
    assert.equal(wall.ok, false);

    const ok = tryMove(g, 0, 'right', 2000);
    assert.equal(ok.ok, true);
    assert.equal(g.players[0].x, 1);
    assert.equal(g.players[0].y, 0);
  });

  it('serializes and restores', () => {
    const g = createGame({
      mode: 'online',
      size: 21,
      seed: 5,
      players: [
        { name: 'H', peerId: 'h' },
        { name: 'G', peerId: 'g' },
      ],
    });
    tryMove(g, 0, 'right', 5000);
    const raw = serializeState(g);
    const g2 = restoreState(raw);
    assert.equal(g2.maze.size, 21);
    assert.equal(g2.players[0].x, g.players[0].x);
    assert.equal(g2.mask[0][0], true);
  });

  it('applies delta opens', () => {
    const g = createGame({
      mode: 'online',
      size: 15,
      seed: 2,
      players: [{ name: 'A' }],
    });
    const delta = serializeDelta(g, [7, 7, 8, 8]);
    applyDelta(g, delta);
    assert.equal(g.mask[7][7], true);
    assert.equal(g.mask[8][8], true);
  });

  it('formats time', () => {
    assert.equal(formatTime(0), '00:00.00');
    assert.equal(formatTime(65123), '01:05.12');
  });

  it('first to goal wins', () => {
    const g = createGame({
      mode: 'online',
      size: 5,
      seed: 1,
      players: [
        { name: 'A' },
        { name: 'B' },
      ],
    });
    // Tiny open maze
    g.maze.grid = [
      [PATH, PATH, PATH, PATH, PATH],
      [PATH, PATH, PATH, PATH, PATH],
      [PATH, PATH, PATH, PATH, PATH],
      [PATH, PATH, PATH, PATH, PATH],
      [PATH, PATH, PATH, PATH, PATH],
    ];
    g.maze.goal = { x: 1, y: 0 };
    g.players[0].x = 0;
    g.players[0].y = 0;
    g.lastMoveAt = [0, 0];
    const r = tryMove(g, 0, 'right', 3000);
    assert.equal(r.finished, true);
    assert.equal(g.phase, 'finished');
    assert.equal(g.winnerId, 0);
  });
});
