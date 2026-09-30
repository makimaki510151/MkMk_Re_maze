/** MkMk Re Maze — 迷路生成・マスク
 *
 * 構造:
 * - スタート→ゴールは一本の本線（spine）
 * - 本線から多くの分かれ道（spur）を生やす
 * - 分かれ道はすべて行き止まり（惜しい偽路 / 遠くの行き止まり）
 * - 通路グラフは木（ループなし）
 * - 壁は外周まで連結（孤立壁なし）
 */

export const PATH = 0;
export const WALL = 1;

const ORTHO = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
const STEP_DIRS = [
  [0, -2],
  [0, 2],
  [-2, 0],
  [2, 0],
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

function key(x, y) {
  return `${x},${y}`;
}

function parseKey(k) {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
}

function inOddBounds(n, x, y) {
  return x > 0 && y > 0 && x < n - 1 && y < n - 1 && x % 2 === 1 && y % 2 === 1;
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function manhattan(x, y, gx, gy) {
  return Math.abs(gx - x) + Math.abs(gy - y);
}

function oddNeighbors(n, x, y) {
  const out = [];
  for (const [dx, dy] of STEP_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inOddBounds(n, nx, ny)) out.push({ x: nx, y: ny, dx, dy });
  }
  return out;
}

function carveLink(grid, x1, y1, x2, y2) {
  grid[y1][x1] = PATH;
  grid[y2][x2] = PATH;
  grid[(y1 + y2) / 2][(x1 + x2) / 2] = PATH;
}

/**
 * スタート近く→ゴール近くの長い本線（自己回避ウォーク＋終盤はゴールへ）
 */
function buildSpine(n, rand) {
  const sx = 1;
  const sy = 1;
  const gx = n - 2;
  const gy = n - 2;
  const oddCount = ((n - 1) / 2) ** 2;
  const minLen = Math.max(8, Math.floor(oddCount * 0.28));

  const path = [{ x: sx, y: sy }];
  const onPath = new Set([key(sx, sy)]);
  let x = sx;
  let y = sy;
  let guard = oddCount * 20;

  while ((x !== gx || y !== gy) && guard-- > 0) {
    const free = oddNeighbors(n, x, y).filter((c) => !onPath.has(key(c.x, c.y)));
    if (!free.length) {
      if (path.length <= 1) break;
      path.pop();
      onPath.clear();
      for (const p of path) onPath.add(key(p.x, p.y));
      const last = path[path.length - 1];
      x = last.x;
      y = last.y;
      continue;
    }

    const seekGoal = path.length >= minLen || free.every((c) => {
      // 行き場がなくゴール方向しかない場合
      return manhattan(c.x, c.y, gx, gy) < manhattan(x, y, gx, gy);
    });

    let total = 0;
    const weights = free.map((c) => {
      const before = manhattan(x, y, gx, gy);
      const after = manhattan(c.x, c.y, gx, gy);
      let w;
      if (seekGoal) {
        w = after < before ? 4.5 : after === before ? 1.2 : 0.35;
      } else {
        w = after > before ? 3.8 : after === before ? 1.6 : 0.45;
      }
      // 直進ボーナス
      if (path.length >= 2) {
        const prev = path[path.length - 2];
        const pdx = x - prev.x;
        const pdy = y - prev.y;
        if (c.x - x === pdx && c.y - y === pdy) w *= 1.35;
      }
      w *= 0.85 + rand() * 0.3;
      total += w;
      return w;
    });

    let r = rand() * total;
    let chosen = free[free.length - 1];
    for (let i = 0; i < free.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosen = free[i];
        break;
      }
    }

    path.push({ x: chosen.x, y: chosen.y });
    onPath.add(key(chosen.x, chosen.y));
    x = chosen.x;
    y = chosen.y;
  }

  // ゴール未達なら、到達可能な位置まで本線を戻してから未使用セルで接続
  if (x !== gx || y !== gy) {
    while (path.length > 1) {
      const probe = new Set(onPath);
      const rest = shortestOddPath(n, x, y, gx, gy, probe);
      const ok =
        rest.length &&
        rest.every((p, i) => {
          if (onPath.has(key(p.x, p.y))) return false;
          const prev = i === 0 ? { x, y } : rest[i - 1];
          return Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 2;
        });
      if (ok) {
        for (const p of rest) {
          path.push(p);
          onPath.add(key(p.x, p.y));
        }
        x = gx;
        y = gy;
        break;
      }
      path.pop();
      onPath.clear();
      for (const p of path) onPath.add(key(p.x, p.y));
      const last = path[path.length - 1];
      x = last.x;
      y = last.y;
    }
    if (x !== gx || y !== gy) {
      // 最終手段: スタートからゴールへの単純路を本線にする
      const direct = shortestOddPath(n, sx, sy, gx, gy, new Set([key(sx, sy)]));
      return [{ x: sx, y: sy }, ...direct];
    }
  }

  return path;
}

/** forbidden をなるべく避けて奇数セル最短路（必要なら後で再試行） */
function shortestOddPath(n, sx, sy, gx, gy, forbidden) {
  const trySearch = (avoidForbidden) => {
    const q = [{ x: sx, y: sy }];
    const prev = new Map([[key(sx, sy), null]]);
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur.x === gx && cur.y === gy) {
        const out = [];
        let ck = key(gx, gy);
        while (ck && ck !== key(sx, sy)) {
          out.push(parseKey(ck));
          ck = prev.get(ck);
        }
        out.reverse();
        return out;
      }
      for (const nb of oddNeighbors(n, cur.x, cur.y)) {
        const k = key(nb.x, nb.y);
        if (prev.has(k)) continue;
        if (
          avoidForbidden &&
          forbidden.has(k) &&
          !(nb.x === gx && nb.y === gy) &&
          !(nb.x === sx && nb.y === sy)
        ) {
          continue;
        }
        prev.set(k, key(cur.x, cur.y));
        q.push({ x: nb.x, y: nb.y });
      }
    }
    return null;
  };

  return trySearch(true) || trySearch(false) || [{ x: gx, y: gy }];
}

function carveSpine(grid, spine) {
  for (let i = 0; i < spine.length; i++) {
    const { x, y } = spine[i];
    grid[y][x] = PATH;
    if (i > 0) {
      const p = spine[i - 1];
      carveLink(grid, p.x, p.y, x, y);
    }
  }
}

/** リンクを掘っても通路が木のままか（ダメなら元に戻す用のスナップショット） */
function tryCarveLink(grid, x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const before = [
    [x1, y1, grid[y1][x1]],
    [x2, y2, grid[y2][x2]],
    [mx, my, grid[my][mx]],
  ];
  carveLink(grid, x1, y1, x2, y2);
  if (isPerfectMaze(grid)) return true;
  for (const [x, y, v] of before) grid[y][x] = v;
  return false;
}

/**
 * 1本の行き止まり枝を origin から生やす。成功したら先端セル列を返す。
 */
function growOneSpur(grid, n, pathSet, origin, rand, opts = {}) {
  const gx = n - 2;
  const gy = n - 2;
  const { forbidDirs = [], nearMiss = false } = opts;

  const exits = shuffle(oddNeighbors(n, origin.x, origin.y), rand).filter((nb) => {
    if (pathSet.has(key(nb.x, nb.y))) return false;
    if (nb.x === gx && nb.y === gy) return false;
    for (const d of forbidDirs) {
      if (nb.dx === d.dx && nb.dy === d.dy) return false;
    }
    return true;
  });
  if (!exits.length) return null;

  let cx;
  let cy;
  let pdx;
  let pdy;
  let started = false;
  for (const first of exits) {
    if (tryCarveLink(grid, origin.x, origin.y, first.x, first.y)) {
      pathSet.add(key(first.x, first.y));
      cx = first.x;
      cy = first.y;
      pdx = first.dx;
      pdy = first.dy;
      started = true;
      break;
    }
  }
  if (!started) return null;

  const chain = [{ x: cx, y: cy }];
  const maxLen = nearMiss
    ? 3 + Math.floor(rand() * Math.max(3, Math.floor(n / 6)))
    : 3 + Math.floor(rand() * Math.max(6, Math.floor(n / 2.2)));
  const stopNear = 2 + Math.floor(rand() * 3);

  for (let step = 1; step < maxLen; step++) {
    if (nearMiss && manhattan(cx, cy, gx, gy) <= stopNear) break;

    const optsNb = oddNeighbors(n, cx, cy).filter((nb) => {
      if (pathSet.has(key(nb.x, nb.y))) return false;
      if (nb.x === gx && nb.y === gy) return false;
      return true;
    });
    if (!optsNb.length) break;

    const ranked = optsNb
      .map((nb) => {
        const before = manhattan(cx, cy, gx, gy);
        const after = manhattan(nb.x, nb.y, gx, gy);
        let w = 1;
        if (nearMiss) w = after < before ? 5 : after === before ? 1.2 : 0.25;
        else w = after > before ? 2.8 : after === before ? 1.5 : 0.7;
        if (nb.dx === pdx && nb.dy === pdy) w *= 1.35;
        // 途中でもさらに枝を残せるよう、たまには曲がる
        if (rand() < 0.22) w *= nb.dx === pdx && nb.dy === pdy ? 0.55 : 1.8;
        w *= 0.85 + rand() * 0.3;
        return { nb, w };
      })
      .sort((a, b) => b.w - a.w);

    let advanced = false;
    for (const { nb } of ranked) {
      if (tryCarveLink(grid, cx, cy, nb.x, nb.y)) {
        pathSet.add(key(nb.x, nb.y));
        pdx = nb.dx;
        pdy = nb.dy;
        cx = nb.x;
        cy = nb.y;
        chain.push({ x: cx, y: cy });
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }

  return chain;
}

/**
 * 本線＋枝の途中から、行き止まり分岐を大量に生やす。
 * - nearMiss: ゴール近くで止まる惜しい偽路
 * - longFar: 遠くの行き止まり
 * - 枝の途中からも再分岐（木のまま＝ループなし）
 */
function growSpurs(grid, n, spine, rand) {
  const pathSet = new Set(spine.map((p) => key(p.x, p.y)));
  const spurCells = [];

  const spineDir = new Map();
  for (let i = 0; i < spine.length; i++) {
    const k = key(spine[i].x, spine[i].y);
    const dirs = [];
    if (i > 0) {
      dirs.push({
        dx: spine[i].x - spine[i - 1].x,
        dy: spine[i].y - spine[i - 1].y,
      });
    }
    if (i < spine.length - 1) {
      dirs.push({
        dx: spine[i + 1].x - spine[i].x,
        dy: spine[i + 1].y - spine[i].y,
      });
    }
    spineDir.set(k, dirs);
  }

  const oddCount = ((n - 1) / 2) ** 2;
  // 本線セルほぼ全部＋再分岐で、空きを埋めるほど枝を生やす
  const targetPrimary = Math.max(12, Math.floor(spine.length * 1.35));
  const targetSecondary = Math.max(10, Math.floor(oddCount * 0.22));
  let made = 0;

  // Pass 1: 本線の各点から、空いている横穴をできるだけ全部使う
  const spineOrder = shuffle(spine.slice(1, Math.max(2, spine.length - 1)), rand);
  for (const origin of spineOrder) {
    if (made >= targetPrimary) break;
    const along = spineDir.get(key(origin.x, origin.y)) || [];
    // 同じ本線セルから最大2本まで
    for (let k = 0; k < 2; k++) {
      if (made >= targetPrimary) break;
      const chain = growOneSpur(grid, n, pathSet, origin, rand, {
        forbidDirs: along,
        nearMiss: rand() < 0.35,
      });
      if (!chain) break;
      for (const c of chain) spurCells.push(c);
      made += 1;
    }
  }

  // Pass 2: 枝の途中からも再分岐（木構造のまま枝分かれを増やす）
  let secondary = 0;
  for (let round = 0; round < 4 && secondary < targetSecondary; round++) {
    const origins = shuffle([...spurCells], rand);
    for (const origin of origins) {
      if (secondary >= targetSecondary) break;
      // 行き止まり先端だけでなく、枝の中腹からも生やす
      if (rand() < 0.35 && degreeAt(grid, n, origin.x, origin.y) >= 3) continue;
      const chain = growOneSpur(grid, n, pathSet, origin, rand, {
        forbidDirs: [],
        nearMiss: rand() < 0.3,
      });
      if (!chain) continue;
      for (const c of chain) spurCells.push(c);
      secondary += 1;
      made += 1;
    }
  }

  // Pass 3: まだ空いている隣があれば短い枝を追加
  const allPath = shuffle(
    [...pathSet].map((k) => parseKey(k)).filter((p) => !(p.x === n - 2 && p.y === n - 2)),
    rand,
  );
  for (const origin of allPath) {
    if (made >= targetPrimary + targetSecondary + spine.length) break;
    if (spineDir.has(key(origin.x, origin.y)) && rand() < 0.4) continue;
    const chain = growOneSpur(grid, n, pathSet, origin, rand, {
      forbidDirs: spineDir.get(key(origin.x, origin.y)) || [],
      nearMiss: rand() < 0.25,
    });
    if (!chain) continue;
    // 短くしたいので、長く伸びすぎた場合はそのまま（木ならOK）
    made += 1;
  }

  return made;
}

function connectStartGoalCorners(grid, n) {
  // 本線端 (1,1) / (n-2,n-2) へ片側だけ接続（ループ防止）
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

/**
 * 孤立壁を解消する。通路の木構造を壊す変更は採用しない。
 */
function fixWallIslands(grid) {
  const n = grid.length;
  for (let iter = 0; iter < n * 4; iter++) {
    if (wallsConnectedToBorder(grid)) return true;

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

    let fixed = false;
    for (let y = 1; y < n - 1 && !fixed; y++) {
      for (let x = 1; x < n - 1 && !fixed; x++) {
        if (grid[y][x] !== WALL || seen[y * n + x]) continue;

        // 1) 孤立壁→通路（木が保てるときだけ）
        grid[y][x] = PATH;
        if (isPerfectMaze(grid) && wallsConnectedToBorder(grid)) {
          fixed = true;
          break;
        }
        grid[y][x] = WALL;

        // 2) 隣接する行き止まり側の通路を壁にして島を外周へ繋ぐ
        for (const [dx, dy] of ORTHO) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx <= 0 || ny <= 0 || nx >= n - 1 || ny >= n - 1) continue;
          if (grid[ny][nx] !== PATH) continue;
          if (degreeAt(grid, n, nx, ny) !== 1) continue; // 行き止まりセルのみ
          grid[ny][nx] = WALL;
          if (isPerfectMaze(grid) && wallsConnectedToBorder(grid)) {
            fixed = true;
            break;
          }
          grid[ny][nx] = PATH;
        }
      }
    }
    if (!fixed) return false;
  }
  return wallsConnectedToBorder(grid);
}

/** 行き止まりが本線以外に存在するか／正解路が一意か */
export function hasUniqueSolution(grid, start, goal) {
  // 木なら start-goal は一意。連結木であることを見る
  return isPerfectMaze(grid) && shortestPathLength(grid, start, goal) >= 0;
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

/** 本線上の分岐点（正解路のセルで次数≥3） */
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
 * 奇数サイズの迷路を生成。
 * スタート左上・ゴール右下。本線＋行き止まり分岐。ループなし。
 */
export function generateMaze(size, seed = (Date.now() >>> 0)) {
  let n = Math.max(7, size | 0);
  if (n % 2 === 0) n += 1;

  const start = { x: 0, y: 0 };
  const goal = { x: n - 1, y: n - 1 };
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 24; attempt++) {
    const rand = mulberry32((seed + attempt * 7919) >>> 0);
    const grid = Array.from({ length: n }, () => Array(n).fill(WALL));

    const spine = buildSpine(n, rand);
    if (spine.length < 4) continue;
    if (spine[spine.length - 1].x !== n - 2 || spine[spine.length - 1].y !== n - 2) {
      // ゴール奇数セルへ強制接続
      const last = spine[spine.length - 1];
      const tail = shortestOddPath(n, last.x, last.y, n - 2, n - 2, new Set(spine.map((p) => key(p.x, p.y))));
      for (const p of tail) spine.push(p);
    }

    carveSpine(grid, spine);
    connectStartGoalCorners(grid, n);
    if (!isPerfectMaze(grid)) continue;
    const branches = growSpurs(grid, n, spine, rand);
    if (!isPerfectMaze(grid)) continue;
    if (!fixWallIslands(grid)) continue;
    if (!isPerfectMaze(grid)) continue;
    if (!wallsConnectedToBorder(grid)) continue;

    const dist = shortestPathLength(grid, start, goal);
    if (dist < 0) continue;
    const spineBranches = countSpineBranches(grid, start, goal);
    const junctions = countJunctions(grid);

    const score = spineBranches * 10 + branches * 4 + junctions * 2 + dist * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = grid.map((row) => row.slice());
    }
    // 本線上の分岐が十分多く、全体の分岐も多い
    if (spineBranches >= Math.max(10, Math.floor(n / 2.2)) && junctions >= spineBranches) break;
  }

  let grid = best;
  if (!grid) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const rand = mulberry32((seed + 10007 + attempt * 6163) >>> 0);
      const g = Array.from({ length: n }, () => Array(n).fill(WALL));
      const spine = buildSpine(n, rand);
      carveSpine(g, spine);
      connectStartGoalCorners(g, n);
      if (!isPerfectMaze(g)) continue;
      growSpurs(g, n, spine, rand);
      if (!isPerfectMaze(g)) continue;
      if (!fixWallIslands(g)) continue;
      if (!isPerfectMaze(g) || !wallsConnectedToBorder(g)) continue;
      grid = g;
      break;
    }
  }
  if (!grid) {
    // 最後の手段: 本線のみ
    const rand = mulberry32(seed ^ 0xabcde);
    grid = Array.from({ length: n }, () => Array(n).fill(WALL));
    const spine = buildSpine(n, rand);
    carveSpine(grid, spine);
    connectStartGoalCorners(grid, n);
  }

  return {
    size: n,
    seed,
    grid,
    start,
    goal,
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
