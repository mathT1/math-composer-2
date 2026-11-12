// 시안 세 가지가 함께 쓰는 예시 내용. 실제 앱 화면에 나올 값과 같은 종류의 값이다.

export const sound = {
  name: '리코더 도',
  f0: 523.9,
  note: '도5',
  cents: 2,
  harmonics: [1, 0.42, 0.18, 0.22, 0.07, 0.09, 0.03, 0.04],
};

export const scale = {
  name: '순정률 장음계',
  base: 261.63,
  steps: [
    { label: '도', ratio: '1', cents: 0 },
    { label: '레', ratio: '9/8', cents: 204 },
    { label: '미', ratio: '5/4', cents: 386 },
    { label: '파', ratio: '4/3', cents: 498 },
    { label: '솔', ratio: '3/2', cents: 702 },
    { label: '라', ratio: '5/3', cents: 884 },
    { label: '시', ratio: '15/8', cents: 1088 },
    { label: '도′', ratio: '2', cents: 1200 },
  ],
};

/** 16칸 선율. 값은 음계의 몇 번째 음인지, null은 쉼 */
export const melody: (number | null)[] = [0, null, 2, 4, 4, null, 2, null, 5, 4, 2, 0, 1, null, null, null];
export const chords = ['Ⅰ', '', '', '', 'Ⅰ', '', '', '', 'Ⅳ', '', '', '', 'Ⅴ', '', '', ''];
export const playhead = 6;

export const stages = ['듣기', '보기', '세기', '짓기', '만들기', '묶기'];

/** 배음을 더한 파형 한 줄을 SVG path로 */
export function wavePath(width: number, height: number, periods: number, harmonics = sound.harmonics): string {
  const n = 600;
  const pts: string[] = [];
  let peak = 0;
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * periods * 2 * Math.PI;
    let y = 0;
    harmonics.forEach((a, k) => (y += a * Math.sin((k + 1) * x + k * 0.9)));
    ys.push(y);
    peak = Math.max(peak, Math.abs(y));
  }
  ys.forEach((y, i) => {
    const px = (i / n) * width;
    const py = height / 2 - (y / peak) * (height / 2) * 0.86;
    pts.push(`${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`);
  });
  return pts.join('');
}

/** 음계의 한 음이 몇 Hz인지 */
export function stepHz(i: number): number {
  return scale.base * 2 ** (scale.steps[i].cents / 1200);
}

export function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}
