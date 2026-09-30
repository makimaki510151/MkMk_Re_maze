/** MkMk Re Maze — 迷路生成・マスク */

export const PATH = 0;
export const WALL = 1;

const STEP_DIRS = [
  [0, -2],
  [0, 2],
  [-2, 0],
  [2, 0],
];

/** Growing Tree: ランダム選択比率（高いほど分岐が多くなる。ループは作らない） */
const RANDOM_ACTIVE = 0.88;
/** ゴールに近づく掘削を抑える重み */
const AWAY_FROM_GOAL_WEIGHT = 3.6;
/** 最短路が短すぎるときの再生成上限 */
const MAX_REGEN = 14;

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

function inCarveBounds(n, x, y) {
  return x > 0 && y > 0 && x < n - 1 && y < n - 1;
}

function unvisitedNeighbors(grid, n, x, y) {
  const out = [];
  for (const [dx, dy] of STEP_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inCarveBounds(n, nx, ny) && grid[ny][nx] === WALL) {
      out.push({ dx, dy, nx, ny });
    }
  }
  return out;
}

function manhattan(x, y, gx, gy) {
  return Math.abs(gx - x) + Math.abs(gy - y);
}

/**
 * 分岐先を選ぶ。ゴールへ直進しにくい方向を優先しつつ乱択。
 */
function pickConfusingNeighbor(neighbors, x, y, goal, rand) {
  if (neighbors.length === 1) return neighbors[0];

  let total = 0;
  const weights = neighbors.map((d) => {
    const before = manhattan(x, y, goal.x, goal.y);
    const after = manhattan(d.nx, d.ny, goal.x, goal.y);
    // ゴールから遠ざかる／横に逸れるほど重い
    let w = 1;
    if (after > before) w = AWAY_FROM_GOAL_WEIGHT;
    else if (after === before) w = AWAY_FROM_GOAL_WEIGHT * 0.75;
    else w = 1;
    // わずかにノイズ
    w *= 0.85 + rand() * 0.3;
    total += w;
    return w;
  });

  let r = rand() * total;
  for (let i = 0; i < neighbors.length; i++) {
    r -= weights[i];
    if (r <= 0) return neighbors[i];
  }
  return neighbors[neighbors.length - 1];
}

function carveGrowingTree(grid, n, rand, startX, startY, goal) {
  for (let y = 0; y < n; y++) grid[y].fill(WALL);
  grid[startY][startX] = PATH;
  const active = [{ x: startX, y: startY }];

  while (active.length) {
    const idx =
      rand() < RANDOM_ACTIVE
        ? Math.floor(rand() * active.length)
        : active.length - 1;
    const { x, y } = active[idx];
    const neighbors = unvisitedNeighbors(grid, n, x, y);
    if (!neighbors.length) {
      active.splice(idx, 1);
      continue;
    }
    const chosen = pickConfusingNeighbor(neighbors, x, y, goal, rand);
    grid[y + chosen.dy / 2][x + chosen.dx / 2] = PATH;
    grid[chosen.ny][chosen.nx] = PATH;
    active.push({ x: chosen.nx, y: chosen.ny });
  }
}

/**
 * 角を迷路本体へ1本だけ接続する。
 * 2方向つなぐと 2×2 の小ループができるため、必ず片側のみ開く。
 */
function connectCorners(grid, n) {
  grid[1][1] = PATH;
  grid[0][0] = PATH;
  grid[0][1] = PATH; // (0,0)-(0,1)-(1,1) のみ。 (1,0) は開けない
  grid[n - 2][n - 2] = PATH;
  grid[n - 1][n - 1] = PATH;
  grid[n - 1][n - 2] = PATH; // (n-1,n-1)-(n-1,n-2)-(n-2,n-2) のみ
}

/** BFS で最短路長（見つからなければ -1） */
export function shortestPathLength(grid, start, goal) {
  const n = grid.length;
  const key = (x, y) => y * n + x;
  if (grid[start.y]?.[start.x] !== PATH || grid[goal.y]?.[goal.x] !== PATH) return -1;
  const seen = new Uint8Array(n * n);
  const qx = [start.x];
  const qy = [start.y];
  const qd = [0];
  seen[key(start.x, start.y)] = 1;
  const ortho = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    const d = qd[head];
    head += 1;
    if (x === goal.x && y === goal.y) return d;
    for (const [dx, dy] of ortho) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (grid[ny][nx] !== PATH) continue;
      const k = key(nx, ny);
      if (seen[k]) continue;
      seen[k] = 1;
      qx.push(nx);
      qy.push(ny);
      qd.push(d + 1);
    }
  }
  return -1;
}

function degreeAt(grid, n, x, y) {
  let d = 0;
  if (x > 0 && grid[y][x - 1] === PATH) d += 1;
  if (x < n - 1 && grid[y][x + 1] === PATH) d += 1;
  if (y > 0 && grid[y - 1][x] === PATH) d += 1;
  if (y < n - 1 && grid[y + 1][x] === PATH) d += 1;
  return d;
}

/** 分岐点（次数≥3）の数 */
export function countJunctions(grid) {
  const n = grid.length;
  let c = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] === PATH && degreeAt(grid, n, x, y) >= 3) c += 1;
    }
  }
  return c;
}

/**
 * 通路グラフが連結な木（完璧迷路＝ループなし）かどうか。
 * 連結かつ edges === vertices - 1 なら閉路なし。
 */
export function isPerfectMaze(grid) {
  const n = grid.length;
  let cells = 0;
  let edges = 0;
  let start = null;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] !== PATH) continue;
      cells += 1;
      if (!start) start = { x, y };
      // 二重計上を避けるため右・下のみ
      if (x + 1 < n && grid[y][x + 1] === PATH) edges += 1;
      if (y + 1 < n && grid[y + 1][x] === PATH) edges += 1;
    }
  }
  if (cells < 2 || !start) return false;
  if (edges !== cells - 1) return false;

  // 連結確認
  const seen = new Uint8Array(n * n);
  const stack = [start.x, start.y];
  seen[start.y * n + start.x] = 1;
  let visited = 0;
  const ortho = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    visited += 1;
    for (const [dx, dy] of ortho) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (grid[ny][nx] !== PATH) continue;
      const k = ny * n + nx;
      if (seen[k]) continue;
      seen[k] = 1;
      stack.push(nx, ny);
    }
  }
  return visited === cells;
}

/**
 * 奇数サイズの迷路を生成。
 * スタートは左上 (0,0)、ゴールは右下 (size-1, size-1)。
 * 分岐は多いがループ（閉路）は作らない完璧迷路。
 */
export function generateMaze(size, seed = (Date.now() >>> 0)) {
  let n = Math.max(5, size | 0);
  if (n % 2 === 0) n += 1;
  const goal = { x: n - 2, y: n - 2 };
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));

  let best = null;
  let bestScore = -Infinity;
  const start = { x: 0, y: 0 };
  const end = { x: n - 1, y: n - 1 };
  const manhattanGoal = (n - 1) * 2;

  for (let attempt = 0; attempt < MAX_REGEN; attempt++) {
    const rand = mulberry32((seed + attempt * 9973) >>> 0);
    // 開始位置を散らして「スタートからゴールへ一直線」な骨格を避ける
    const oddCells = Math.floor((n - 1) / 2);
    const cx = 1 + 2 * Math.floor(rand() * oddCells);
    const cy = 1 + 2 * Math.floor(rand() * oddCells);

    carveGrowingTree(grid, n, rand, cx, cy, goal);
    connectCorners(grid, n);
    // braid はしない（ループ禁止）

    if (!isPerfectMaze(grid)) continue;

    const dist = shortestPathLength(grid, start, end);
    if (dist < 0) continue;

    const junctions = countJunctions(grid);
    const minDist = Math.max(Math.floor(n * 2.1), Math.floor(manhattanGoal * 1.25));
    const directness = manhattanGoal / Math.max(dist, 1);
    // 分岐多め・遠回りを強く評価。直進に近い最短路は大きく減点
    const score =
      junctions * 2.5 +
      dist * 1.2 -
      directness * 120 -
      (dist < minDist ? (minDist - dist) * 10 : 0);

    if (score > bestScore) {
      bestScore = score;
      best = {
        grid: grid.map((row) => row.slice()),
        dist,
        junctions,
      };
    }
    // 分岐が多く、最短路がマンハッタンより十分長い
    if (junctions >= Math.floor(n * 1.2) && dist >= minDist && directness <= 0.78) break;
  }

  if (best) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) grid[y][x] = best.grid[y][x];
    }
  } else {
    // フォールバック（通常到達しない）
    const rand = mulberry32(seed);
    carveGrowingTree(grid, n, rand, 1, 1, goal);
    connectCorners(grid, n);
  }

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
