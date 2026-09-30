/** MkMk Re Maze — Canvas 描画 */

import { PATH, WALL } from './maze.js';
import { LOCAL_VIEW } from './game.js';

export function createRenderer(overviewCanvas, localCanvas) {
  const octx = overviewCanvas.getContext('2d');
  const lctx = localCanvas.getContext('2d');

  function resize() {
    const oParent = overviewCanvas.parentElement;
    const lParent = localCanvas.parentElement;
    const od = Math.min(oParent?.clientWidth || 400, oParent?.clientHeight || 400, 520);
    overviewCanvas.width = Math.floor(od * devicePixelRatio);
    overviewCanvas.height = Math.floor(od * devicePixelRatio);
    overviewCanvas.style.width = `${od}px`;
    overviewCanvas.style.height = `${od}px`;

    const ld = Math.min(lParent?.clientWidth || 280, 360);
    localCanvas.width = Math.floor(ld * devicePixelRatio);
    localCanvas.height = Math.floor(ld * devicePixelRatio);
    localCanvas.style.width = `${ld}px`;
    localCanvas.style.height = `${ld}px`;
  }

  function draw(game, localSeat) {
    if (!game) return;
    drawOverview(octx, overviewCanvas, game, localSeat);
    drawLocal(lctx, localCanvas, game, localSeat);
  }

  return { resize, draw };
}

function drawOverview(ctx, canvas, game, localSeat) {
  const { maze, mask, players } = game;
  const n = maze.size;
  const w = canvas.width;
  const h = canvas.height;
  const cell = Math.min(w, h) / n;
  const ox = (w - cell * n) / 2;
  const oy = (h - cell * n) / 2;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0c0e';
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const revealed = mask[y][x];
      let color;
      if (!revealed) {
        color = '#1a1e24';
      } else if (maze.grid[y][x] === WALL) {
        color = '#050607';
      } else {
        color = '#f2f0ea';
      }
      ctx.fillStyle = color;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.5, cell + 0.5);
    }
  }

  // スタート / ゴール（判明時のみ薄く）
  markCell(ctx, ox, oy, cell, maze.start.x, maze.start.y, mask, 'rgba(62, 180, 120, 0.55)');
  markCell(ctx, ox, oy, cell, maze.goal.x, maze.goal.y, mask, 'rgba(232, 93, 76, 0.55)');

  for (const pl of players) {
    if (pl.offline) continue;
    const revealed = mask[pl.y]?.[pl.x];
    // 他者も全体マップに表示（マスク外でも輪郭のみ）
    const px = ox + (pl.x + 0.5) * cell;
    const py = oy + (pl.y + 0.5) * cell;
    const r = Math.max(cell * 0.42, 2.2 * devicePixelRatio);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = pl.color;
    ctx.globalAlpha = revealed || pl.id === localSeat ? 1 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (pl.id === localSeat) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5 * devicePixelRatio, cell * 0.12);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function markCell(ctx, ox, oy, cell, x, y, mask, color) {
  if (!mask[y]?.[x]) return;
  ctx.fillStyle = color;
  ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.5, cell + 0.5);
}

function drawLocal(ctx, canvas, game, localSeat) {
  const { maze, players } = game;
  const me = players[localSeat] || players[0];
  if (!me) return;

  const half = Math.floor(LOCAL_VIEW / 2);
  const w = canvas.width;
  const h = canvas.height;
  const cell = Math.min(w, h) / LOCAL_VIEW;
  const ox = (w - cell * LOCAL_VIEW) / 2;
  const oy = (h - cell * LOCAL_VIEW) / 2;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#050607';
  ctx.fillRect(0, 0, w, h);

  // ローカル拡大は道を常時表示（自機周辺の実際の地形）
  for (let ly = 0; ly < LOCAL_VIEW; ly++) {
    for (let lx = 0; lx < LOCAL_VIEW; lx++) {
      const mx = me.x + (lx - half);
      const my = me.y + (ly - half);
      let color = '#050607';
      if (mx < 0 || my < 0 || mx >= maze.size || my >= maze.size) {
        color = '#050607';
      } else if (maze.grid[my][mx] === WALL) {
        color = '#0c0e11';
      } else {
        color = '#f2f0ea';
        if (mx === maze.start.x && my === maze.start.y) color = '#b8e0c8';
        if (mx === maze.goal.x && my === maze.goal.y) color = '#f0b8b0';
      }
      ctx.fillStyle = color;
      const pad = cell * 0.04;
      ctx.fillRect(ox + lx * cell + pad, oy + ly * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }

  // グリッド線
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(1, devicePixelRatio);
  for (let i = 0; i <= LOCAL_VIEW; i++) {
    ctx.beginPath();
    ctx.moveTo(ox + i * cell, oy);
    ctx.lineTo(ox + i * cell, oy + LOCAL_VIEW * cell);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, oy + i * cell);
    ctx.lineTo(ox + LOCAL_VIEW * cell, oy + i * cell);
    ctx.stroke();
  }

  // 他者・自分
  for (const pl of players) {
    if (pl.offline) continue;
    const lx = pl.x - me.x + half;
    const ly = pl.y - me.y + half;
    if (lx < -0.5 || ly < -0.5 || lx >= LOCAL_VIEW - 0.5 || ly >= LOCAL_VIEW - 0.5) continue;
    const px = ox + (lx + 0.5) * cell;
    const py = oy + (ly + 0.5) * cell;
    const r = cell * (pl.id === localSeat ? 0.32 : 0.28);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = pl.color;
    ctx.fill();
    if (pl.id === localSeat) {
      ctx.strokeStyle = '#1a1510';
      ctx.lineWidth = cell * 0.08;
      ctx.stroke();
      // 向きインジケータ風のパルスリング
      ctx.beginPath();
      ctx.arc(px, py, r * 1.35, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = cell * 0.05;
      ctx.stroke();
    }
  }

  ctx.restore();
}
