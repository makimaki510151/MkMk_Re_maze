import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAudio, playSound, _resetAudioForTests } from '../js/audio.js';

describe('audio', () => {
  it('ensureAudio is safe without AudioContext (Node)', () => {
    _resetAudioForTests();
    // Node には AudioContext が無いので false / 例外なし
    assert.equal(ensureAudio(), false);
  });

  it('playSound is a no-op without context', () => {
    _resetAudioForTests();
    assert.doesNotThrow(() => {
      playSound('move');
      playSound('hit');
      playSound('clear');
      playSound('ui');
      playSound('start');
      playSound('unknown');
    });
  });
});
