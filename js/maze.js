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

const STEP_DIRS = [
  [0, -2],
  [0, 2],
  [-2, 0],
  [2, 0],
];

/** 直進しやすさ（高いほど長い廊下・分かれ道になる） */
const STRAIGHT_BIAS = 0.82;
/** 曲がり直後に最低このステップ数は直進を優先 */
const MIN_RUN = 3;

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

/** その方向へ何ステップ壁が続くか（長い分かれ道候補の評価） */
function openRunLength(grid, n, x, y, dx, dy) {
  let len = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (inCarveBounds(n, cx, cy) && grid[cy][cx] === WALL) {
    len += 1;
    cx += dx;
    cy += dy;
  }
  return len;
}

function pickNeighbor(grid, n, x, y, neighbors, ldx, ldy, runLen, rand) {
  if (neighbors.length === 1) return neighbors[0];

  const straight = neighbors.find((d) => d.dx === ldx && d.dy === ldy);
  const forceStraight = runLen < MIN_RUN && !!straight;
  if (straight && (forceStraight || rand() < STRAIGHT_BIAS)) {
    return straight;
  }

  // 曲がるときは「まだ長く伸ばせる」方向を優先 → 長い分かれ道が増える
  const turns = straight ? neighbors.filter((d) => d !== straight) : neighbors;
  const pool = turns.length ? turns : neighbors;
  let best = pool[0];
  let bestScore = -1;
  for (const cand of pool) {
    const run = openRunLength(grid, n, x, y, cand.dx, cand.dy);
    const score = run + rand() * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/**
 * 奇数サイズの迷路を生成。
 * スタートは左上 (0,0)、ゴールは右下 (size-1, size-1)。
 * 通路=0 / 壁=1。
 * 直進バイアス＋長い空き方向への分岐で、長い分かれ道が多くなる。
 */
export function generateMaze(size, seed = (Date.now() >>> 0)) {
  let n = Math.max(5, size | 0);
  if (n % 2 === 0) n += 1;
  const rand = mulberry32(seed);
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));

  // スタック式バックトラッカー（直進優先）
  grid[1][1] = PATH;
  const stack = [{ x: 1, y: 1, ldx: 0, ldy: 0, run: 0 }];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const { x, y, ldx, ldy, run } = cur;
    const neighbors = unvisitedNeighbors(grid, n, x, y);

    if (!neighbors.length) {
      stack.pop();
      continue;
    }

    const chosen = pickNeighbor(grid, n, x, y, neighbors, ldx, ldy, run, rand);
    const { dx, dy, nx, ny } = chosen;
    grid[y + dy / 2][x + dx / 2] = PATH;
    grid[ny][nx] = PATH;
    const nextRun = dx === ldx && dy === ldy ? run + 1 : 1;
    stack.push({ x: nx, y: ny, ldx: dx, ldy: dy, run: nextRun });
  }

  // 左上・右下を必ず通路にし、内部迷路へ接続
  grid[0][0] = PATH;
  grid[0][1] = PATH;
  grid[1][0] = PATH;
  grid[n - 1][n - 1] = PATH;
  grid[n - 1][n - 2] = PATH;
  grid[n - 2][n - 1] = PATH;
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

/**
 * 分かれ道・廊下の長さ統計（テスト／調整用）
 * - branchWays: 通路次数≥3 の分岐点から伸びる各枝の長さ
 * - deadEndDepths: 行き止まりから分岐／端までの距離
 */
export function analyzeBranchiness(grid) {
  const n = grid.length;
  const ortho = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];

  const degree = (x, y) => {
    let d = 0;
    for (const [dx, dy] of ortho) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (grid[ny][nx] === PATH) d += 1;
    }
    return d;
  };

  const walkArm = (sx, sy, fromX, fromY) => {
    let x = sx;
    let y = sy;
    let px = fromX;
    let py = fromY;
    let len = 1;
    while (true) {
      const deg = degree(x, y);
      if (deg !== 2) break;
      let next = null;
      for (const [dx, dy] of ortho) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (grid[ny][nx] !== PATH) continue;
        if (nx === px && ny === py) continue;
        next = [nx, ny];
        break;
      }
      if (!next) break;
      px = x;
      py = y;
      x = next[0];
      y = next[1];
      len += 1;
    }
    return len;
  };

  const branchWays = [];
  const deadEndDepths = [];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] !== PATH) continue;
      const deg = degree(x, y);
      if (deg >= 3) {
        for (const [dx, dy] of ortho) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (grid[ny][nx] !== PATH) continue;
          branchWays.push(walkArm(nx, ny, x, y));
        }
      } else if (deg === 1) {
        for (const [dx, dy] of ortho) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (grid[ny][nx] !== PATH) continue;
          deadEndDepths.push(walkArm(nx, ny, x, y) + 1);
          break;
        }
      }
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    branchCount: branchWays.length,
    avgBranchWay: avg(branchWays),
    longBranchWays: branchWays.filter((l) => l >= 6).length,
    avgDeadEndDepth: avg(deadEndDepths),
    deadEndCount: deadEndDepths.length,
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
