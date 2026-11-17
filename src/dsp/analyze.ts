/**
 * 소리 하나를 재는 일: 가장 안정된 구간 찾기, 기본 주파수, 배음.
 */
import { detectPitch } from './pitch';
import { extractHarmonics, spectrum, type Spectrum } from './spectrum';

export interface Selection {
  start: number;
  end: number;
}

export interface Measured {
  f0: number | null;
  confidence: number;
  harmonics: number[];
  inharmonicity: number;
  strongest: number;
  spectrum: Spectrum;
}

/** 측정에 쓰는 구간의 길이 한계(초) */
export const MIN_SELECTION = 0.1;
export const MAX_SELECTION = 2;

/**
 * 주기성이 가장 높고 음량이 고른 구간을 찾는다(6.3절 자동 구간).
 * 소리가 seconds보다 짧으면 전체를 돌려준다.
 */
export function bestRegion(samples: Float32Array, sampleRate: number, seconds = 0.5): Selection {
  const len = Math.round(seconds * sampleRate);
  if (samples.length <= len) return { start: 0, end: samples.length };
  const hop = Math.max(1, Math.round(0.1 * sampleRate));
  const part = Math.max(1, Math.floor(len / 5));

  let peakRms = 0;
  const frames: { at: number; rms: number; even: number }[] = [];
  for (let at = 0; at + len <= samples.length; at += hop) {
    let lo = Infinity;
    let hi = 0;
    let total = 0;
    for (let p = 0; p < 5; p++) {
      let e = 0;
      const from = at + p * part;
      for (let i = from; i < from + part; i++) e += samples[i] * samples[i];
      const r = Math.sqrt(e / part);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      total += e;
    }
    const rms = Math.sqrt(total / (part * 5));
    frames.push({ at, rms, even: hi > 0 ? lo / hi : 0 });
    peakRms = Math.max(peakRms, rms);
  }

  let best = frames[0];
  let bestScore = -1;
  for (const f of frames) {
    // 너무 작은 구간(소리가 나기 전과 사라진 뒤)은 보지 않는다
    if (f.rms < peakRms * 0.25) continue;
    const { clarity } = detectPitch(samples.subarray(f.at, f.at + len), sampleRate, { maxWindow: 2048 });
    const score = clarity * (0.5 + 0.5 * f.even);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return { start: best.at, end: best.at + len };
}

/** 고른 구간을 잰다 */
export function measure(samples: Float32Array, sampleRate: number, sel: Selection): Measured {
  const seg = samples.subarray(sel.start, sel.end);
  const { f0, clarity } = detectPitch(seg, sampleRate);
  const spec = spectrum(seg, sampleRate);
  if (f0 === null) {
    return { f0: null, confidence: 0, harmonics: Array.from({ length: 16 }, () => 0), inharmonicity: 0, strongest: 1, spectrum: spec };
  }
  return { f0, confidence: clarity, ...extractHarmonics(spec, f0), spectrum: spec };
}

/** 신뢰도를 세 단계로 (6.3절) */
export function confidenceLevel(confidence: number): '높음' | '보통' | '낮음' {
  return confidence >= 0.9 ? '높음' : confidence >= 0.75 ? '보통' : '낮음';
}

/** 배음이 정수배에서 평균 1% 넘게 벗어나거나 음높이가 불분명하면 음색으로 쓸 수 없다 (5.4절) */
export function usableAsTimbre(m: Pick<Measured, 'f0' | 'confidence' | 'inharmonicity'>): boolean {
  return m.f0 !== null && m.confidence >= 0.75 && m.inharmonicity <= 0.01;
}
