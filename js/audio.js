/** MkMk Re Maze — Web Audio SE（参照 script.js 準拠） */

let audioCtx = null;
let masterGainNode = null;
const DEFAULT_VOLUME = 0.3;

/** ユーザー操作後に AudioContext を用意／再開 */
export function ensureAudio() {
  try {
    if (!audioCtx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      audioCtx = new AC();
      masterGainNode = audioCtx.createGain();
      masterGainNode.connect(audioCtx.destination);
      masterGainNode.gain.setValueAtTime(DEFAULT_VOLUME, audioCtx.currentTime);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** 最初のクリック／キーでオーディオを解放 */
export function bindAudioUnlock(root = document) {
  const unlock = () => {
    ensureAudio();
    root.removeEventListener('pointerdown', unlock);
    root.removeEventListener('keydown', unlock);
  };
  root.addEventListener('pointerdown', unlock);
  root.addEventListener('keydown', unlock);
  return () => {
    root.removeEventListener('pointerdown', unlock);
    root.removeEventListener('keydown', unlock);
  };
}

/**
 * @param {'move'|'hit'|'clear'|'ui'|'start'} type
 */
export function playSound(type) {
  if (!audioCtx || !masterGainNode) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(masterGainNode);

  const t0 = audioCtx.currentTime;
  let freq = 440;
  let duration = 0.05;
  let initialVolume = 0.3;
  let wave = 'sine';

  switch (type) {
    case 'move':
      freq = 440;
      duration = 0.05;
      initialVolume = 0.3;
      wave = 'sine';
      break;
    case 'hit':
      freq = 120;
      duration = 0.1;
      initialVolume = 0.5;
      wave = 'triangle';
      break;
    case 'clear':
      freq = 660;
      duration = 0.5;
      initialVolume = 0.4;
      wave = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.linearRampToValueAtTime(880, t0 + 0.2);
      break;
    case 'ui':
      freq = 520;
      duration = 0.04;
      initialVolume = 0.18;
      wave = 'sine';
      break;
    case 'start':
      freq = 330;
      duration = 0.18;
      initialVolume = 0.28;
      wave = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.linearRampToValueAtTime(520, t0 + 0.12);
      break;
    default:
      return;
  }

  osc.type = wave;
  if (type !== 'clear' && type !== 'start') {
    osc.frequency.setValueAtTime(freq, t0);
  }
  gain.gain.setValueAtTime(initialVolume, t0);
  osc.start(t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.stop(t0 + duration);
}

/** テスト／デバッグ用 */
export function _resetAudioForTests() {
  audioCtx = null;
  masterGainNode = null;
}
