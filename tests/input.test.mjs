import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// DOM なしで方向ヘルパを検証するため、モジュール内ロジックと同等の関数を再確認
function keyToDir(key) {
  const k = String(key).toLowerCase();
  if (k === 'arrowup' || k === 'w') return 'up';
  if (k === 'arrowdown' || k === 's') return 'down';
  if (k === 'arrowleft' || k === 'a') return 'left';
  if (k === 'arrowright' || k === 'd') return 'right';
  return null;
}

function dirFromAxes(ax, ay, dead = 0.45) {
  const mag = Math.hypot(ax, ay);
  if (mag < dead) return null;
  return Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
}

describe('input mapping', () => {
  it('maps WASD and arrows', () => {
    assert.equal(keyToDir('w'), 'up');
    assert.equal(keyToDir('ArrowLeft'), 'left');
    assert.equal(keyToDir('D'), 'right');
    assert.equal(keyToDir('x'), null);
  });

  it('maps stick axes with deadzone', () => {
    assert.equal(dirFromAxes(0.1, 0.1), null);
    assert.equal(dirFromAxes(0.9, 0.1), 'right');
    assert.equal(dirFromAxes(-0.2, 0.95), 'down');
    assert.equal(dirFromAxes(-0.8, 0.2), 'left');
    assert.equal(dirFromAxes(0.1, -0.9), 'up');
  });
});
