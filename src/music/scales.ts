/**
 * 음계 (작업지시서 3.3절, 5.6절). 기준음은 도4 = 261.63Hz.
 * 음계의 음은 기준음에서의 거리(센트)로 적고, 정수비로 정의된 음은 비도 함께 적는다.
 */
import type { Project, Scale, ScaleStep } from '../store/project';

export const BASE_FREQ = 261.63;

export const centsOf = (ratio: number) => 1200 * Math.log2(ratio);

const fromRatios = (ratios: [number, number][]): ScaleStep[] => ratios.map(([a, b]) => ({ cents: centsOf(a / b), ratio: [a, b] }));

export type PresetKind = 'equal12' | 'penta' | 'just' | 'pythagorean';

export const PRESETS: Record<PresetKind, { name: string; about: string; make: () => ScaleStep[] }> = {
  equal12: {
    name: '12평균율',
    about: '한 옥타브를 같은 비로 12번 나눈 음계. 피아노가 이렇게 조율된다.',
    make: () => Array.from({ length: 12 }, (_, k) => ({ cents: k * 100 })),
  },
  penta: {
    name: '5음계',
    about: '12평균율에서 다섯 음(도 레 미 솔 라)만 고른 음계. 어떤 음을 함께 내도 잘 어울린다.',
    make: () => [0, 200, 400, 700, 900].map((cents) => ({ cents })),
  },
  just: {
    name: '순정률 장음계',
    about: '작은 정수의 비로 만든 음계. 화음이 맑게 울리지만 조를 바꾸기 어렵다.',
    make: () => fromRatios([[1, 1], [9, 8], [5, 4], [4, 3], [3, 2], [5, 3], [15, 8]]),
  },
  pythagorean: {
    name: '피타고라스 장음계',
    about: '3:2(완전5도)를 거듭 쌓아 만든 음계. 5도는 맑지만 3도가 조금 높다.',
    make: () => fromRatios([[1, 1], [9, 8], [81, 64], [4, 3], [3, 2], [27, 16], [243, 128]]),
  },
};

export function presetScale(kind: PresetKind, baseFreq = BASE_FREQ): Scale {
  return { name: PRESETS[kind].name, kind, baseFreq, steps: PRESETS[kind].make() };
}

const CHROMATIC = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
const DIATONIC = ['도', '레', '미', '파', '솔', '라', '시'];
const PENTA = ['도', '레', '미', '솔', '라'];

/** 음계 안 i번째 음의 이름 */
export function stepName(scale: Pick<Scale, 'kind' | 'steps'>, i: number): string {
  const n = scale.steps.length;
  const k = ((i % n) + n) % n;
  if (scale.kind === 'equal12' && n === 12) return CHROMATIC[k];
  if ((scale.kind === 'just' || scale.kind === 'pythagorean') && n === 7) return DIATONIC[k];
  if (scale.kind === 'penta' && n === 5) return PENTA[k];
  return `${k + 1}음`;
}

/** 작곡실의 행 번호(두 옥타브)를 주파수로. 0행이 기준음 */
export function rowFreq(scale: Pick<Scale, 'baseFreq' | 'steps'>, row: number): number {
  const n = scale.steps.length;
  const octave = Math.floor(row / n);
  return scale.baseFreq * 2 ** (octave + scale.steps[row - octave * n].cents / 1200);
}

/** 행 이름: 도, 레 … 둘째 옥타브는 “높은 도” */
export function rowName(scale: Pick<Scale, 'kind' | 'steps'>, row: number): string {
  const n = scale.steps.length;
  return `${row >= n ? '높은 ' : ''}${stepName(scale, row)}`;
}

/** 기준음에서의 절대 높이(센트). 기준음이 다른 음계끼리도 견줄 수 있게 도4 기준으로 */
function rowCents(scale: Pick<Scale, 'baseFreq' | 'steps'>, row: number): number {
  return centsOf(rowFreq(scale, row) / BASE_FREQ);
}

/** 옛 음계의 행을 새 음계에서 높이가 가장 가까운 행으로. 같은 거리면 낮은 쪽 */
export function nearestRow(from: Pick<Scale, 'baseFreq' | 'steps'>, row: number, to: Pick<Scale, 'baseFreq' | 'steps'>): number {
  const target = rowCents(from, row);
  let best = 0;
  let bestDist = Infinity;
  for (let r = 0; r < to.steps.length * 2; r++) {
    const d = Math.abs(rowCents(to, r) - target);
    if (d < bestDist - 1e-9) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 음계를 바꿀 때 곡의 음을 옮긴다 (5.6절). 칸 번호가 아니라 음높이(센트)가 가장 가까운 음으로.
 * 화음도 같은 방식이며, 옮긴 뒤 겹친 음은 하나로 합친다.
 */
export function remapSong(song: Project['song'], from: Scale, to: Scale): Project['song'] {
  return {
    bpm: song.bpm,
    melody: song.melody.map((r) => (r === null ? null : nearestRow(from, r, to))),
    chords: song.chords.map((c) => (c === null ? null : [...new Set(c.map((r) => nearestRow(from, r, to)))].sort((a, b) => a - b))),
  };
}

export function songHasNotes(song: Project['song']): boolean {
  return song.melody.some((r) => r !== null) || song.chords.some((c) => c !== null && c.length > 0);
}

/** 3.3절 조율 기준표의 음정 */
export const INTERVALS = {
  third: {
    name: '장3도',
    tunings: [
      { name: '순정률', ratio: [5, 4] as [number, number] },
      { name: '평균율', ratio: null, semis: 4 },
      { name: '피타고라스', ratio: [81, 64] as [number, number] },
    ],
  },
  fifth: {
    name: '완전5도',
    tunings: [
      { name: '순정률', ratio: [3, 2] as [number, number] },
      { name: '평균율', ratio: null, semis: 7 },
      { name: '피타고라스', ratio: [3, 2] as [number, number] },
    ],
  },
} as const;

export type IntervalId = keyof typeof INTERVALS;

export function tuningRatio(t: { ratio: readonly [number, number] | null; semis?: number }): number {
  return t.ratio ? t.ratio[0] / t.ratio[1] : 2 ** ((t.semis ?? 0) / 12);
}
