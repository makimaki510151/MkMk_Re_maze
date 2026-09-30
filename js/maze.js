/** MkMk Re Maze — 迷路生成・マスク
 *
 * 生成は参照 script.js と同じ Randomized Prim 法。
 * - 奇数セルを通路ノード、その間の壁を候補にして掘る
 * - 完璧迷路（ループなし＝スタート→ゴールは一意）
 * - スタート左上・ゴール右下
 */

export const PATH = 0;
export const WALL = 1;

const ORTHO = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

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

function wallKey(x, y) {
  return `${x},${y}`;
}

/**
 * Randomized Prim（script.js の MazeGenerator.generate 相当）
 * 内部では path=true / wall=false で掘り、最後に PATH/WALL グリッドへ写す。
 */
function carvePrim(n, rand) {
  // script.js と同じく 0=壁, 1=通路 で生成
  const g = Array.from({ length: n }, () => Array(n).fill(0));
  const startX = 1;
  const startY = 1;
  g[startY][startX] = 1;

  const walls = [];
  const wallSet = new Set();

  const addWalls = (x, y) => {
    for (const [dx, dy] of ORTHO) {
      const wallX = x + dx;
      const wallY = y + dy;
      if (wallX <= 0 || wallX >= n - 1 || wallY <= 0 || wallY >= n - 1) continue;
      if (g[wallY][wallX] !== 0) continue;
      const k = wallKey(wallX, wallY);
      if (wallSet.has(k)) continue;
      wallSet.add(k);
      walls.push({ x: wallX, y: wallY });
    }
  };

  addWalls(startX, startY);

  while (walls.length > 0) {
    const wallIndex = Math.floor(rand() * walls.length);
    const wall = walls[wallIndex];
    const last = walls[walls.length - 1];
    walls[wallIndex] = last;
    walls.pop();
    wallSet.delete(wallKey(wall.x, wall.y));

    const x = wall.x;
    const y = wall.y;

    let cell1 = null;
    let cell2 = null;

    // script.js と同じ判定: 奇数×偶数 = 縦の仕切り、偶数×奇数 = 横の仕切り
    if (x % 2 === 1 && y % 2 === 0) {
      cell1 = { x, y: y - 1 };
      cell2 = { x, y: y + 1 };
    } else if (x % 2 === 0 && y % 2 === 1) {
      cell1 = { x: x - 1, y };
      cell2 = { x: x + 1, y };
    } else {
      continue;
    }

    if (
      cell1.x <= 0 ||
      cell1.y <= 0 ||
      cell1.x >= n - 1 ||
      cell1.y >= n - 1 ||
      cell2.x <= 0 ||
      cell2.y <= 0 ||
      cell2.x >= n - 1 ||
      cell2.y >= n - 1
    ) {
      continue;
    }

    const isCell1Path = g[cell1.y][cell1.x] === 1;
    const isCell2Path = g[cell2.y][cell2.x] === 1;

    if (isCell1Path !== isCell2Path) {
      g[y][x] = 1;
      const newCell = isCell1Path ? cell2 : cell1;
      g[newCell.y][newCell.x] = 1;
      addWalls(newCell.x, newCell.y);
    }
  }

  // 自前の PATH/WALL へ変換（PATH=0, WALL=1）
  const grid = Array.from({ length: n }, () => Array(n).fill(WALL));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (g[y][x] === 1) grid[y][x] = PATH;
    }
  }
  return grid;
}

/** 角を迷路本体へ1本だけ接続（2×2ループ防止） */
function connectCorners(grid, n) {
  grid[1][1] = PATH;
  grid[0][0] = PATH;
  grid[0][1] = PATH;
  grid[n - 2][n - 2] = PATH;
  grid[n - 1][n - 1] = PATH;
  grid[n - 1][n - 2] = PATH;
}

function degreeAt(grid, n, x, y) {
  let d = 0;
  for (const [dx, dy] of ORTHO) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
    if (grid[ny][nx] === PATH) d += 1;
  }
  return d;
}

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

/** 通路が連結な木か（ループなし） */
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
      if (x + 1 < n && grid[y][x + 1] === PATH) edges += 1;
      if (y + 1 < n && grid[y + 1][x] === PATH) edges += 1;
    }
  }
  if (cells < 2 || !start) return false;
  if (edges !== cells - 1) return false;

  const seen = new Uint8Array(n * n);
  const stack = [start.x, start.y];
  seen[start.y * n + start.x] = 1;
  let visited = 0;
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    visited += 1;
    for (const [dx, dy] of ORTHO) {
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

/** すべての壁が外周の壁まで連結しているか */
export function wallsConnectedToBorder(grid) {
  const n = grid.length;
  const seen = new Uint8Array(n * n);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    if (grid[y][x] !== WALL) return;
    const k = y * n + x;
    if (seen[k]) return;
    seen[k] = 1;
    q.push(x, y);
  };

  for (let i = 0; i < n; i++) {
    push(i, 0);
    push(i, n - 1);
    push(0, i);
    push(n - 1, i);
  }

  let head = 0;
  while (head < q.length) {
    const x = q[head++];
    const y = q[head++];
    for (const [dx, dy] of ORTHO) push(x + dx, y + dy);
  }

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] === WALL && !seen[y * n + x]) return false;
    }
  }
  return true;
}

export function shortestPathLength(grid, start, goal) {
  const n = grid.length;
  const id = (x, y) => y * n + x;
  if (grid[start.y]?.[start.x] !== PATH || grid[goal.y]?.[goal.x] !== PATH) return -1;
  const seen = new Uint8Array(n * n);
  const qx = [start.x];
  const qy = [start.y];
  const qd = [0];
  seen[id(start.x, start.y)] = 1;
  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    const d = qd[head];
    head += 1;
    if (x === goal.x && y === goal.y) return d;
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (grid[ny][nx] !== PATH) continue;
      const k = id(nx, ny);
      if (seen[k]) continue;
      seen[k] = 1;
      qx.push(nx);
      qy.push(ny);
      qd.push(d + 1);
    }
  }
  return -1;
}

export function hasUniqueSolution(grid, start, goal) {
  return isPerfectMaze(grid) && shortestPathLength(grid, start, goal) >= 0;
}

/** 正解路上の分岐点（次数≥3） */
export function countSpineBranches(grid, start, goal) {
  const n = grid.length;
  const spine = solutionPathCells(grid, start, goal);
  if (!spine) return 0;
  let c = 0;
  for (const { x, y } of spine) {
    if (degreeAt(grid, n, x, y) >= 3) c += 1;
  }
  return c;
}

function solutionPathCells(grid, start, goal) {
  const n = grid.length;
  const id = (x, y) => y * n + x;
  const prev = new Int32Array(n * n).fill(-1);
  const qx = [start.x];
  const qy = [start.y];
  prev[id(start.x, start.y)] = -2;
  let head = 0;
  let found = false;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head += 1;
    if (x === goal.x && y === goal.y) {
      found = true;
      break;
    }
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (grid[ny][nx] !== PATH) continue;
      const k = id(nx, ny);
      if (prev[k] !== -1) continue;
      prev[k] = id(x, y);
      qx.push(nx);
      qy.push(ny);
    }
  }
  if (!found) return null;
  const cells = [];
  let cur = id(goal.x, goal.y);
  while (cur >= 0) {
    cells.push({ x: cur % n, y: (cur / n) | 0 });
    cur = prev[cur];
    if (cur === -2) break;
  }
  return cells;
}

/**
 * 奇数サイズの迷路を生成（Randomized Prim / script.js 準拠）
 * スタート左上・ゴール右下。ループなし。
 */
export function generateMaze(size, seed = (Date.now() >>> 0)) {
  let n = Math.max(5, size | 0);
  if (n % 2 === 0) n += 1;

  const rand = mulberry32(seed >>> 0);
  const grid = carvePrim(n, rand);
  connectCorners(grid, n);

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
