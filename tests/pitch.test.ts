import { describe, expect, it } from 'vitest';
import { cents, detectPitch } from '../src/dsp/pitch';

const SR = 48000;
const DURATION = 0.5;

/** 배음 세기 배열로 소리를 만든다. harmonics[0]이 기본음 */
function tone(f0: number, harmonics: number[], sampleRate = SR, noise = 0, seed = 1): Float32Array {
  const n = Math.round(sampleRate * DURATION);
  const out = new Float32Array(n);
  // 재현 가능한 난수
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < harmonics.length; k++) {
      v += harmonics[k] * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / sampleRate + k * 0.7);
    }
    out[i] = v;
  }
  if (noise > 0) {
    let power = 0;
    for (let i = 0; i < n; i++) power += out[i] * out[i];
    const rms = Math.sqrt(power / n);
    // 균등 난수의 rms는 1/√12
    const scale = (rms * noise) / (1 / Math.sqrt(12));
    for (let i = 0; i < n; i++) out[i] += rand() * scale;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.8;
  return out;
}

const FREQS = [80, 98, 110, 146.83, 196, 220, 261.63, 329.63, 392, 440, 523.25, 659.25, 880, 1000];

function worstError(harmonics: number[], sampleRate = SR, noise = 0): number {
  let worst = 0;
  for (const f of FREQS) {
    const { f0 } = detectPitch(tone(f, harmonics, sampleRate, noise), sampleRate);
    expect(f0, `${f}Hz에서 측정 실패`).not.toBeNull();
    worst = Math.max(worst, Math.abs(cents(f, f0!)));
  }
  return worst;
}

describe('기본 주파수 측정 (작업지시서 6.3절)', () => {
  it('순음 80~1000Hz에서 ±3센트 이내', () => {
    expect(worstError([1])).toBeLessThan(3);
  });

  it('배음이 섞인 소리에서 ±3센트 이내', () => {
    expect(worstError([1, 0.5, 0.33, 0.25, 0.2, 0.17])).toBeLessThan(3);
  });

  it('기본음이 약한 소리에서 ±3센트 이내', () => {
    expect(worstError([0.15, 1, 0.8, 0.5, 0.3])).toBeLessThan(3);
  });

  it('샘플레이트 44100Hz에서도 ±3센트 이내', () => {
    expect(worstError([1, 0.5, 0.33], 44100)).toBeLessThan(3);
  });

  it('신호 대 잡음비 20dB에서 ±10센트 이내', () => {
    expect(worstError([1, 0.5, 0.33, 0.25], SR, 0.1)).toBeLessThan(10);
  });

  it('순정 장3도와 평균율 장3도를 구분한다', () => {
    const just = detectPitch(tone(261.63 * 1.25, [1, 0.4, 0.2]), SR).f0!;
    const equal = detectPitch(tone(261.63 * 2 ** (4 / 12), [1, 0.4, 0.2]), SR).f0!;
    expect(cents(just, equal)).toBeGreaterThan(11);
    expect(cents(just, equal)).toBeLessThan(17);
  });

  it('소리가 없으면 측정하지 않는다', () => {
    expect(detectPitch(new Float32Array(24000), SR).f0).toBeNull();
  });

  it('뚜렷한 소리의 신뢰도는 높고 잡음의 신뢰도는 낮다', () => {
    expect(detectPitch(tone(440, [1, 0.5]), SR).clarity).toBeGreaterThan(0.9);
    const noise = new Float32Array(24000);
    let s = 7;
    for (let i = 0; i < noise.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      noise[i] = s / 0xffffffff - 0.5;
    }
    expect(detectPitch(noise, SR).clarity).toBeLessThan(0.5);
  });
});
