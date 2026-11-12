/**
 * 음색: 배음 세기 16개 → PeriodicWave. 낮은 음의 음량 보정.
 */

/** 배음 세기를 PeriodicWave의 계수로. 0번은 직류(항상 0), k번이 k배음의 사인 성분 */
export function waveCoefficients(harmonics: readonly number[]): { real: Float32Array; imag: Float32Array } {
  const n = harmonics.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  let any = false;
  for (let k = 0; k < harmonics.length; k++) {
    const a = harmonics[k];
    imag[k + 1] = Number.isFinite(a) && a > 0 ? a : 0;
    if (imag[k + 1] > 0) any = true;
  }
  // 모두 0이면 소리가 나지 않으므로 기본음만 남긴다
  if (!any) imag[1] = 1;
  return { real, imag };
}

export function makeWave(ctx: BaseAudioContext, harmonics: readonly number[]): PeriodicWave {
  const { real, imag } = waveCoefficients(harmonics);
  // 봉우리가 1이 되도록 브라우저가 맞춘다. 음색이 달라도 음량이 비슷해진다
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * 낮은 음은 같은 세기여도 작게 들린다. 도4(261.63Hz) 아래에서 조금 키운다.
 * 1(그대로) 이상 2 이하.
 */
export function lowBoost(freq: number): number {
  if (!(freq > 0)) return 1;
  return Math.min(2, Math.max(1, Math.sqrt(261.63 / freq)));
}

/** 그 주파수에서 소리 낼 수 있는 배음만 남긴다(샘플레이트 절반을 넘는 배음은 접혀 들리므로) */
export function audibleHarmonics(harmonics: readonly number[], freq: number, sampleRate: number): number[] {
  const limit = sampleRate / 2;
  return harmonics.map((a, k) => (freq * (k + 1) < limit ? a : 0));
}
