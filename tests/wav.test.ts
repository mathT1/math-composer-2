import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../src/audio/wav';

describe('WAV 인코딩', () => {
  it('저장했다가 읽으면 같은 소리가 된다', () => {
    const samples = new Float32Array(4800);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.7 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    const { samples: back, sampleRate } = decodeWav(encodeWav(samples, 48000));
    expect(sampleRate).toBe(48000);
    expect(back.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) expect(Math.abs(back[i] - samples[i])).toBeLessThan(1 / 16000);
  });

  it('범위를 넘는 값은 잘라 낸다', () => {
    const { samples } = decodeWav(encodeWav(new Float32Array([2, -2, 0]), 44100));
    expect(samples[0]).toBeCloseTo(1, 3);
    expect(samples[1]).toBeCloseTo(-1, 3);
    expect(samples[2]).toBe(0);
  });

  it('머리말이 표준 형식이다', () => {
    const view = new DataView(encodeWav(new Float32Array(10), 48000));
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.byteLength).toBe(44 + 20);
  });
});
