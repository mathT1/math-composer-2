/**
 * 기본 주파수 측정 — McLeod 방식(정규화 제곱차 함수, NSDF).
 * 작업지시서 6.3절: 시간 영역 자기상관 계열, 봉우리 포물선 보간, 60~2000Hz.
 */

export interface PitchResult {
  /** 기본 주파수(Hz). 찾지 못하면 null */
  f0: number | null;
  /** 0~1. 봉우리의 뚜렷함 */
  clarity: number;
}

export interface PitchOptions {
  minFreq?: number;
  maxFreq?: number;
  /** 가장 높은 봉우리의 몇 배 이상이면 첫 봉우리로 채택할지 */
  threshold?: number;
  /** 더하는 구간의 최대 길이(샘플). 손잡이를 끄는 동안처럼 빨리 답해야 할 때 줄인다. 줄이면 정확도가 조금 떨어진다 */
  maxWindow?: number;
}

const DEFAULTS = { minFreq: 60, maxFreq: 2000, threshold: 0.93, maxWindow: Infinity };

export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): PitchResult {
  const { minFreq, maxFreq, threshold, maxWindow } = { ...DEFAULTS, ...options };
  const n = samples.length;
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (maxLag <= minLag + 2) return { f0: null, clarity: 0 };

  // 직류 성분 제거
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;

  // 모든 지연에서 같은 길이를 더해 창 길이에 따른 치우침을 없앤다
  const w = Math.min(n - maxLag, Math.max(maxLag, maxWindow));
  const x = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = samples[i] - mean;
  }
  for (let i = 0; i < w; i++) energy += x[i] * x[i];
  if (energy / w < 1e-10) return { f0: null, clarity: 0 };

  const nsdf = new Float64Array(maxLag + 1);
  // m(τ) = Σ x[j]² + Σ x[j+τ]² 를 밀어 가며 갱신
  let shifted = energy;
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0;
    for (let j = 0; j < w; j++) acf += x[j] * x[j + lag];
    const m = energy + shifted;
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0;
    // 다음 지연을 위해 창을 한 칸 민다
    if (lag < maxLag) shifted += x[lag + w] * x[lag + w] - x[lag] * x[lag];
  }

  // 첫 음의 구간을 지난 뒤, 양의 구간마다 가장 높은 점을 모은다
  const peaks: number[] = [];
  let lag = 1;
  while (lag <= maxLag && nsdf[lag] > 0) lag++;
  while (lag <= maxLag) {
    while (lag <= maxLag && nsdf[lag] <= 0) lag++;
    let best = -1;
    while (lag <= maxLag && nsdf[lag] > 0) {
      if (best < 0 || nsdf[lag] > nsdf[best]) best = lag;
      lag++;
    }
    // 구간이 끝까지 이어져 잘린 봉우리는 버린다
    if (best > 0 && best < maxLag && best >= minLag) peaks.push(best);
  }
  if (peaks.length === 0) return { f0: null, clarity: 0 };

  let highest = 0;
  for (const p of peaks) highest = Math.max(highest, nsdf[p]);
  const chosen = peaks.find((p) => nsdf[p] >= threshold * highest)!;

  // 포물선 보간으로 봉우리의 정확한 위치를 구한다
  const a = nsdf[chosen - 1];
  const b = nsdf[chosen];
  const c = nsdf[chosen + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = chosen + shift;
  const clarity = Math.max(0, Math.min(1, b - 0.25 * (a - c) * shift));

  return { f0: sampleRate / period, clarity };
}

/** 두 주파수의 차이를 센트로. 1200·log₂(f2/f1) */
export function cents(f1: number, f2: number): number {
  return 1200 * Math.log2(f2 / f1);
}
