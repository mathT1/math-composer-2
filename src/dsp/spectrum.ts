/**
 * 스펙트럼과 배음 (작업지시서 6.3절).
 * 자체 FFT, 창 길이 16384(모자라면 0으로 채움), 한 창, 봉우리 보간.
 */

export const FFT_SIZE = 16384;
export const HARMONIC_COUNT = 16;

/** 제자리 기수 2 FFT. 길이는 2의 거듭제곱 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) throw new RangeError('FFT 길이는 2의 거듭제곱이어야 합니다.');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export interface Spectrum {
  /** 주파수 칸마다의 진폭. 진폭 1인 사인이면 봉우리가 1에 가깝다 */
  mag: Float32Array;
  /** 칸 하나의 폭(Hz) */
  binHz: number;
}

/** 한 구간의 진폭 스펙트럼. 한(Hann) 창을 씌우고, 길이가 모자라면 0으로 채운다 */
export function spectrum(samples: Float32Array, sampleRate: number, size = FFT_SIZE): Spectrum {
  const n = Math.min(samples.length, size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= Math.max(1, n);
  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    const w = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
    re[i] = (samples[i] - mean) * w;
    windowSum += w;
  }
  fft(re, im);
  const mag = new Float32Array(size / 2);
  const scale = windowSum > 0 ? 2 / windowSum : 0;
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]) * scale;
  return { mag, binHz: sampleRate / size };
}

export interface Harmonics {
  /** 배음 16개의 세기. 1배음을 1로 */
  harmonics: number[];
  /** 배음이 정수배에서 벗어난 정도(평균, 비율). 0이면 정확히 정수배 */
  inharmonicity: number;
  /** 가장 센 배음의 번호(1부터) */
  strongest: number;
}

/** k·f0의 ±3% 안에서 봉우리를 찾아 진폭을 읽는다 */
export function extractHarmonics(spec: Spectrum, f0: number): Harmonics {
  const { mag, binHz } = spec;
  const amps: number[] = [];
  let devSum = 0;
  let devWeight = 0;
  for (let k = 1; k <= HARMONIC_COUNT; k++) {
    const target = k * f0;
    const lo = Math.max(1, Math.floor((target * 0.97) / binHz));
    const hi = Math.min(mag.length - 2, Math.ceil((target * 1.03) / binHz));
    if (lo > hi) {
      amps.push(0);
      continue;
    }
    let best = lo;
    for (let i = lo; i <= hi; i++) if (mag[i] > mag[best]) best = i;
    // 봉우리의 위치와 높이를 포물선으로 다듬는다
    const a = mag[best - 1];
    const b = mag[best];
    const c = mag[best + 1];
    const d = a - 2 * b + c;
    const shift = d !== 0 && b >= a && b >= c ? (0.5 * (a - c)) / d : 0;
    const amp = b - 0.25 * (a - c) * shift;
    amps.push(amp);
    const freq = (best + shift) * binHz;
    devSum += amp * Math.abs(freq / target - 1);
    devWeight += amp;
  }
  const first = amps[0] > 0 ? amps[0] : Math.max(...amps, 1e-12);
  const harmonics = amps.map((a) => Math.min(100, Math.max(0, a / first)));
  let strongest = 1;
  for (let k = 1; k < harmonics.length; k++) if (harmonics[k] > harmonics[strongest - 1]) strongest = k + 1;
  return { harmonics, inharmonicity: devWeight > 0 ? devSum / devWeight : 0, strongest };
}

/** 한 주파수 성분의 진폭과 위상(사인 기준). 사인 맞추기에서 배음을 더할 때 쓴다 */
export function component(samples: Float32Array, sampleRate: number, freq: number): { amp: number; phase: number } {
  let s = 0;
  let c = 0;
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < samples.length; i++) {
    s += samples[i] * Math.sin(w * i);
    c += samples[i] * Math.cos(w * i);
  }
  const n = Math.max(1, samples.length);
  // x ≈ amp·sin(w·i + phase)
  return { amp: (2 * Math.hypot(s, c)) / n, phase: Math.atan2(c, s) };
}
