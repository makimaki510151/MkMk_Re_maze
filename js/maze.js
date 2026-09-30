/** MkMk Re Maze — 迷路生成・マスク */

export const PATH = 0;
export const WALL = 1;

/** 決定的 RNG（Mulberry32） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 奇数サイズの迷路を生成。
 * スタートは左上 (0,0)、ゴールは右下 (size-1, size-1)。
 * 通路=0 / 壁=1。
 */
export function generateMaze(size, seed = (Date.now() >>> 0)) {
  let n = Math.max(5, size | 0);
  if (n % 2 === 0) n += 1;
  const rand = mulberry32(seed);
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));

  // 奇数列・奇数行を通路候補として掘る（外周は壁のまま）
  const carve = (x, y) => {
    grid[y][x] = PATH;
    const dirs = shuffle(
      [
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
      ],
      rand,
    );
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx > 0 && ny > 0 && nx < n - 1 && ny < n - 1 && grid[ny][nx] === WALL) {
        grid[y + dy / 2][x + dx / 2] = PATH;
        carve(nx, ny);
      }
    }
  };

  carve(1, 1);

  // 左上・右下を必ず通路にし、内部迷路へ接続
  grid[0][0] = PATH;
  grid[0][1] = PATH;
  grid[1][0] = PATH;
  grid[n - 1][n - 1] = PATH;
  grid[n - 1][n - 2] = PATH;
  grid[n - 2][n - 1] = PATH;
  // (1,1) と角を繋ぐ
  grid[1][1] = PATH;
  grid[n - 2][n - 2] = PATH;

  return {
    size: n,
    seed,
    grid,
    start: { x: 0, y: 0 },
    goal: { x: n - 1, y: n - 1 },
  };
}

export function createMask(size) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

/** 中心セル周囲 radius（デフォルト1 → 3×3）のマスクを開く。新規座標の flat リストを返す */
export function revealAround(mask, cx, cy, radius = 1) {
  const n = mask.length;
  const opened = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      if (!mask[y][x]) {
        mask[y][x] = true;
        opened.push(x, y);
      }
    }
  }
  return opened;
}

export function isPassable(grid, x, y) {
  const n = grid.length;
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  return grid[y][x] === PATH;
}

export function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

export function cloneMask(mask) {
  return mask.map((row) => row.slice());
}

/** mask を疎なリストへ（転送用） */
export function maskToList(mask) {
  const list = [];
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < mask[y].length; x++) {
      if (mask[y][x]) list.push(x, y);
    }
  }
  return list;
}

export function applyMaskList(mask, list) {
  for (let i = 0; i < list.length; i += 2) {
    const x = list[i];
    const y = list[i + 1];
    if (y >= 0 && y < mask.length && x >= 0 && x < mask[y].length) {
      mask[y][x] = true;
    }
  }
}
