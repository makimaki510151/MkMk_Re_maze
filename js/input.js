/** MkMk Re Maze — キーボード / ゲームパッド / タッチ入力 */

const STICK_DEADZONE = 0.55;
const STICK_RELEASE = 0.35;

/**
 * @param {{
 *   onMove: (dir: 'up'|'down'|'left'|'right') => void,
 *   onHoldChange?: (held: boolean) => void,
 *   isTypingTarget?: (el: EventTarget|null) => boolean,
 * }} opts
 */
export function createInput(opts) {
  const keysDown = new Set();
  let dpadDir = null;
  let swipeDir = null;
  let gamepadDir = null;
  let gamepadPrevButtons = [];
  let stickLatched = null;
  let lastStickDir = null;

  const holdDirs = () => {
    const dirs = new Set();
    for (const k of keysDown) {
      const d = keyToDir(k);
      if (d) dirs.add(d);
    }
    if (dpadDir) dirs.add(dpadDir);
    if (swipeDir) dirs.add(swipeDir);
    if (gamepadDir) dirs.add(gamepadDir);
    return dirs;
  };

  const syncHold = () => {
    opts.onHoldChange?.(holdDirs().size > 0);
  };

  const emit = (dir) => {
    if (!dir) return;
    opts.onMove(dir);
    syncHold();
  };

  function keyToDir(key) {
    const k = String(key).toLowerCase();
    if (k === 'arrowup' || k === 'w') return 'up';
    if (k === 'arrowdown' || k === 's') return 'down';
    if (k === 'arrowleft' || k === 'a') return 'left';
    if (k === 'arrowright' || k === 'd') return 'right';
    return null;
  }

  function onKeyDown(e) {
    if (opts.isTypingTarget?.(e.target)) return;
    const dir = keyToDir(e.key);
    if (!dir) return;
    e.preventDefault();
    keysDown.add(e.key.toLowerCase());
    // OS キーリピートは無視（単押しが複数マス進むのを防ぐ）
    if (e.repeat) {
      syncHold();
      return;
    }
    emit(dir);
  }

  function onKeyUp(e) {
    keysDown.delete(e.key.toLowerCase());
    syncHold();
  }

  /** 仮想十字キー */
  function bindDpad(root) {
    if (!root) return () => {};
    const cleanups = [];

    root.querySelectorAll('[data-dir]').forEach((btn) => {
      const dir = btn.dataset.dir;
      let activePointer = null;
      let lastPressAt = 0;

      const press = () => {
        const now = performance.now();
        // pointer + touch の二重発火を抑制
        if (now - lastPressAt < 80) return;
        lastPressAt = now;
        dpadDir = dir;
        btn.classList.add('active');
        emit(dir);
      };
      const release = () => {
        if (dpadDir === dir) dpadDir = null;
        btn.classList.remove('active');
        syncHold();
      };

      const onPointerDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        activePointer = e.pointerId;
        try {
          btn.setPointerCapture?.(e.pointerId);
        } catch (_) {
          /* ignore */
        }
        press();
      };
      const onPointerUp = (e) => {
        e?.preventDefault?.();
        if (e?.pointerId != null && activePointer != null && e.pointerId !== activePointer) return;
        activePointer = null;
        release();
      };
      const onTouchStart = (e) => {
        e.preventDefault();
        e.stopPropagation();
        press();
      };
      const onTouchEnd = (e) => {
        e.preventDefault();
        release();
      };

      btn.addEventListener('pointerdown', onPointerDown);
      btn.addEventListener('pointerup', onPointerUp);
      btn.addEventListener('pointercancel', onPointerUp);
      btn.addEventListener('lostpointercapture', onPointerUp);
      btn.addEventListener('touchstart', onTouchStart, { passive: false });
      btn.addEventListener('touchend', onTouchEnd, { passive: false });
      btn.addEventListener('touchcancel', onTouchEnd, { passive: false });

      cleanups.push(() => {
        btn.removeEventListener('pointerdown', onPointerDown);
        btn.removeEventListener('pointerup', onPointerUp);
        btn.removeEventListener('pointercancel', onPointerUp);
        btn.removeEventListener('lostpointercapture', onPointerUp);
        btn.removeEventListener('touchstart', onTouchStart);
        btn.removeEventListener('touchend', onTouchEnd);
        btn.removeEventListener('touchcancel', onTouchEnd);
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }

  /**
   * スワイプ／ドラッグで移動（キャンバス上）
   * 閾値を超えた方向へ連続移動
   */
  function bindSwipeSurface(el, threshold = 28) {
    if (!el) return () => {};
    let origin = null;
    let pointerId = null;

    const clear = () => {
      origin = null;
      pointerId = null;
      if (swipeDir) {
        swipeDir = null;
        syncHold();
      }
      el.classList.remove('swipe-active');
    };

    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerId = e.pointerId;
      origin = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      el.classList.add('swipe-active');
    };

    const onMove = (e) => {
      if (pointerId == null || e.pointerId !== pointerId || !origin) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX < threshold && absY < threshold) {
        if (swipeDir) {
          swipeDir = null;
          syncHold();
        }
        return;
      }
      const dir = absX > absY ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (dir !== swipeDir) {
        swipeDir = dir;
        emit(dir);
      }
    };

    const onUp = (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      clear();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', clear);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', clear);
      clear();
    };
  }

  function dirFromAxes(ax, ay) {
    const mag = Math.hypot(ax, ay);
    if (mag < STICK_DEADZONE) return null;
    return Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
  }

  function countPads() {
    const pads = navigator.getGamepads?.() || [];
    let n = 0;
    for (const p of pads) if (p) n += 1;
    return n;
  }

  function pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    let active = null;
    for (const pad of pads) {
      if (pad) {
        active = pad;
        break;
      }
    }
    if (!active) {
      if (gamepadDir || stickLatched) {
        gamepadDir = null;
        stickLatched = null;
        lastStickDir = null;
        syncHold();
      }
      return;
    }

    const buttons = active.buttons || [];
    const axes = active.axes || [];

    // デジタル十字 (Standard mapping 12–15)
    const dpadMap = [
      [12, 'up'],
      [13, 'down'],
      [14, 'left'],
      [15, 'right'],
    ];
    let btnDir = null;
    for (const [idx, dir] of dpadMap) {
      const pressed = !!buttons[idx]?.pressed;
      const was = !!gamepadPrevButtons[idx];
      if (pressed && !was) emit(dir);
      if (pressed) btnDir = dir;
    }

    // 顔ボタンでも移動（任意）: A/B/X/Y → 下/右/左/上 は混乱するので使わない
    // 代わりに左スティック / 右スティック
    const ax = axes[0] || 0;
    const ay = axes[1] || 0;
    const ax2 = axes[2] || 0;
    const ay2 = axes[3] || 0;
    const stick =
      Math.hypot(ax, ay) >= Math.hypot(ax2, ay2) ? dirFromAxes(ax, ay) : dirFromAxes(ax2, ay2);

    if (stick) {
      const mag = Math.max(Math.hypot(ax, ay), Math.hypot(ax2, ay2));
      if (!stickLatched || stick !== lastStickDir) {
        stickLatched = stick;
        lastStickDir = stick;
        emit(stick);
      } else if (mag >= STICK_DEADZONE) {
        // 押しっぱなし継続
        lastStickDir = stick;
      }
    } else {
      // デッドゾーン内でリリース
      const mag = Math.max(Math.hypot(ax, ay), Math.hypot(ax2, ay2));
      if (mag < STICK_RELEASE) {
        stickLatched = null;
        lastStickDir = null;
      }
    }

    gamepadDir = btnDir || stickLatched || null;
    gamepadPrevButtons = buttons.map((b) => !!b?.pressed);
    syncHold();
  }

  function onGamepadConnected(e) {
    console.info('[input] gamepad connected', e.gamepad?.id);
  }
  function onGamepadDisconnected() {
    gamepadDir = null;
    stickLatched = null;
    lastStickDir = null;
    syncHold();
  }

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('gamepadconnected', onGamepadConnected);
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

  /** 毎フレーム呼ぶ。押しっぱなし方向を返す */
  function tick() {
    pollGamepad();
    const held = holdDirs();
    // 優先: 最新の pending は呼び出し側。ここでは「継続方向」を1つ返す
    if (gamepadDir) return gamepadDir;
    if (dpadDir) return dpadDir;
    if (swipeDir) return swipeDir;
    for (const k of keysDown) {
      const d = keyToDir(k);
      if (d) return d;
    }
    return held.values().next().value || null;
  }

  function isHeld() {
    return holdDirs().size > 0;
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('gamepadconnected', onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
  }

  return {
    bindDpad,
    bindSwipeSurface,
    tick,
    isHeld,
    destroy,
    get padCount() {
      return countPads();
    },
  };
}

/** タッチ端末 / 粗いポインタ判定 */
export function prefersTouchUI() {
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches ||
      (navigator.maxTouchPoints || 0) > 0
    );
  } catch (_) {
    return (navigator.maxTouchPoints || 0) > 0;
  }
}
