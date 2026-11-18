import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWav } from '../src/audio/wav';
import { bestRegion, confidenceLevel, measure, usableAsTimbre } from '../src/dsp/analyze';
import { cents } from '../src/dsp/pitch';
import { component, extractHarmonics, fft, spectrum } from '../src/dsp/spectrum';
import { describePitch, nearestNote } from '../src/music/notes';

const SR = 48000;

function tone(f0: number, harmonics: number[], seconds = 0.5, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(sr * seconds));
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < harmonics.length; k++) out[i] += harmonics[k] * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / sr + k);
  }
  return out;
}

describe('FFT와 스펙트럼 (6.3절)', () => {
  it('한 칸에만 든 사인을 그 칸에서 찾는다', () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 37 * i) / n);
    fft(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mags[37]).toBeCloseTo(n / 2, 6);
    expect(Math.max(...mags.filter((_, i) => i !== 37 && i !== n - 37))).toBeLessThan(1e-6);
  });

  it('2의 거듭제곱이 아닌 길이를 거부한다', () => {
    expect(() => fft(new Float64Array(1000), new Float64Array(1000))).toThrow(RangeError);
  });

  it('진폭 0.5인 사인의 봉우리 높이가 0.5에 가깝다', () => {
    const s = spectrum(tone(440, [0.5]), SR);
    const peak = Math.max(...s.mag);
    expect(peak).toBeGreaterThan(0.42);
    expect(peak).toBeLessThanOrEqual(0.5 + 1e-3);
  });
});

describe('배음 추출 (6.3절)', () => {
  const given = [1, 0.5, 0.25, 0.4, 0.1, 0.05, 0.2, 0.02];

  it('넣은 배음 세기를 5% 안에서 되찾는다', () => {
    for (const f0 of [110, 261.63, 523.25, 880]) {
      const h = extractHarmonics(spectrum(tone(f0, given), SR), f0);
      for (let k = 0; k < given.length; k++) expect(Math.abs(h.harmonics[k] - given[k]), `${f0}Hz ${k + 1}배음`).toBeLessThan(0.05);
      for (let k = given.length; k < 16; k++) expect(h.harmonics[k]).toBeLessThan(0.03);
      expect(h.harmonics).toHaveLength(16);
      expect(h.inharmonicity).toBeLessThan(0.003);
      expect(h.strongest).toBe(1);
    }
  });

  it('기본음이 약한 소리에서 가장 센 배음을 알려 준다', () => {
    const h = extractHarmonics(spectrum(tone(220, [0.2, 1, 0.5]), SR), 220);
    expect(h.strongest).toBe(2);
    expect(h.harmonics[1]).toBeGreaterThan(4);
  });

  it('배음이 정수배에서 벗어난 소리는 음색으로 쓸 수 없다고 본다', () => {
    const x = new Float32Array(24000);
    for (let i = 0; i < x.length; i++) {
      x[i] = Math.sin((2 * Math.PI * 300 * i) / SR) + 0.8 * Math.sin((2 * Math.PI * 300 * 2.045 * i) / SR) + 0.7 * Math.sin((2 * Math.PI * 300 * 3.07 * i) / SR);
    }
    const h = extractHarmonics(spectrum(x, SR), 300);
    expect(h.inharmonicity).toBeGreaterThan(0.01);
    expect(usableAsTimbre({ f0: 300, confidence: 0.95, inharmonicity: h.inharmonicity })).toBe(false);
    expect(usableAsTimbre({ f0: 300, confidence: 0.95, inharmonicity: 0.002 })).toBe(true);
    expect(usableAsTimbre({ f0: null, confidence: 0, inharmonicity: 0 })).toBe(false);
  });

  it('한 성분의 진폭과 위상을 읽는다', () => {
    const f = 250;
    const n = Math.round((SR / f) * 4);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.6 * Math.sin((2 * Math.PI * f * i) / SR + 1.1);
    const c = component(x, SR, f);
    expect(c.amp).toBeCloseTo(0.6, 2);
    expect(c.phase).toBeCloseTo(1.1, 2);
  });
});

describe('자동 구간과 측정', () => {
  it('조용한 앞뒤와 흔들리는 부분을 피해 고른 0.5초를 고른다', () => {
    const x = new Float32Array(SR * 3);
    // 0.5~1.2초: 음이 미끄러짐, 1.2~2.4초: 고른 음, 나머지: 조용함
    let phase = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      if (t < 0.5 || t > 2.4) continue;
      const f = t < 1.2 ? 300 + ((t - 0.5) / 0.7) * 140 : 440;
      phase += (2 * Math.PI * f) / SR;
      x[i] = 0.5 * Math.sin(phase) + 0.2 * Math.sin(2 * phase);
    }
    const r = bestRegion(x, SR);
    expect(r.end - r.start).toBe(SR / 2);
    expect(r.start / SR).toBeGreaterThanOrEqual(1.2 - 0.11);
    expect(r.end / SR).toBeLessThanOrEqual(2.4 + 0.01);
    const m = measure(x, SR, r);
    expect(Math.abs(cents(440, m.f0!))).toBeLessThan(3);
    expect(confidenceLevel(m.confidence)).toBe('높음');
  });

  it('짧은 소리는 전체를 고른다', () => {
    expect(bestRegion(new Float32Array(1000), SR)).toEqual({ start: 0, end: 1000 });
  });

  it('소리가 없으면 음높이 없이 배음 16개를 0으로 돌려준다', () => {
    const m = measure(new Float32Array(SR), SR, { start: 0, end: SR / 2 });
    expect(m.f0).toBeNull();
    expect(m.harmonics).toEqual(new Array(16).fill(0));
    expect(confidenceLevel(m.confidence)).toBe('낮음');
  });
});

describe('음이름 (3.3절 기준음)', () => {
  it('라4 = 440Hz, 도4 = 261.63Hz', () => {
    expect(nearestNote(440)).toMatchObject({ name: '라4', cents: 0 });
    const c4 = nearestNote(261.63);
    expect(c4.name).toBe('도4');
    expect(Math.abs(c4.cents)).toBeLessThan(0.1);
    expect(nearestNote(277.18).name).toBe('도#4');
  });

  it('차이를 말로 한다', () => {
    expect(describePitch(523.9)).toBe('도5보다 2센트 높음');
    expect(describePitch(327.04)).toBe('미4보다 14센트 낮음');
    expect(describePitch(440.05)).toBe('라4에 거의 맞음');
  });
});

describe('내장 예시음', () => {
  const read = (id: string) => {
    const b = readFileSync(`public/samples/${id}.wav`);
    return decodeWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  const f0 = (id: string) => {
    const { samples, sampleRate } = read(id);
    const m = measure(samples, sampleRate, bestRegion(samples, sampleRate));
    expect(confidenceLevel(m.confidence), id).toBe('높음');
    return m;
  };

  it('일곱 소리 모두 자동 구간에서 뚜렷하게 재어지고 음색으로 쓸 수 있다', () => {
    const expected: Record<string, [string, number]> = {
      'recorder-c': ['도5', 534], 'recorder-g': ['솔5', 790], 'recorder-c2': ['도6', 1064], voice: ['도3', 130],
      'piano-c': ['도4', 263], 'piano-e': ['미4', 330.5], 'piano-g': ['솔4', 393],
    };
    for (const [id, [name, hz]] of Object.entries(expected)) {
      const m = f0(id);
      expect(nearestNote(m.f0!).name, id).toBe(name);
      expect(Math.abs(cents(hz, m.f0!)), id).toBeLessThan(12);
      expect(usableAsTimbre(m), id).toBe(true);
    }
  });

  it('리코더의 옥타브는 2배, 피아노의 5도는 평균율 값에 가깝다', () => {
    expect(f0('recorder-c2').f0! / f0('recorder-c').f0!).toBeCloseTo(2, 1);
    expect(Math.abs(cents(2 ** (7 / 12), f0('piano-g').f0! / f0('piano-c').f0!))).toBeLessThan(8);
    expect(Math.abs(cents(2 ** (4 / 12), f0('piano-e').f0! / f0('piano-c').f0!))).toBeLessThan(8);
  });
});

describe('M2 검토 반영', () => {
  it('기본음이 아주 약해도 배음 사이의 비와 가장 센 배음을 지킨다 (M2-A2)', () => {
    const h = extractHarmonics(spectrum(tone(220, [0.001, 0.3, 0.8]), SR), 220);
    expect(h.strongest).toBe(3);
    expect(h.harmonics[2]).toBeCloseTo(100, 0);
    expect(h.harmonics[1] / h.harmonics[2]).toBeCloseTo(0.3 / 0.8, 1);
  });
});
