/** 그림에 쓰는 선. 모두 실제 소리 데이터에서 만든다(원칙 8) */

/** 긴 소리를 폭 w에 맞춰 칸마다 최솟값·최댓값을 잇는 테두리 선으로 그린다 */
export function envelopePath(pcm: Float32Array, w: number, mid: number, amp: number, scale = 1): string {
  const cols = Math.max(1, Math.floor(w / 2));
  const per = pcm.length / cols;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let c = 0; c < cols; c++) {
    let lo = 0;
    let hi = 0;
    const from = Math.floor(c * per);
    const to = Math.min(pcm.length, Math.max(from + 1, Math.floor((c + 1) * per)));
    const stride = Math.max(1, Math.floor((to - from) / 64));
    for (let i = from; i < to; i += stride) {
      if (pcm[i] < lo) lo = pcm[i];
      if (pcm[i] > hi) hi = pcm[i];
    }
    const x = ((c + 0.5) / cols) * w;
    top.push(`${x.toFixed(1)} ${(mid - hi * scale * amp).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)} ${(mid - lo * scale * amp).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
}

/** 짧은 구간을 한 줄 선으로 */
export function linePath(values: ArrayLike<number>, w: number, mid: number, amp: number): string {
  const n = values.length;
  if (n < 2) return '';
  const step = Math.max(1, Math.floor(n / (w * 2)));
  const pts: string[] = [];
  for (let i = 0; i < n; i += step) pts.push(`${((i / (n - 1)) * w).toFixed(1)} ${(mid - values[i] * amp).toFixed(1)}`);
  return `M${pts.join('L')}`;
}

export function peakOf(pcm: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) p = Math.max(p, Math.abs(pcm[i]));
  return p;
}
