/**
 * 곡 (작업지시서 5.7절). 32칸 = 8마디, 한 칸이 한 박. 행 번호는 내 음계의 두 옥타브.
 * 화면 재생과 WAV 파일이 같은 소리를 내도록, 칸마다 울릴 음을 정하는 함수는 이것 하나다 (6.4절).
 */
import type { Project, Scale } from '../store/project';
import { rowFreq, stepName } from './scales';

export const STEPS = 32;
export const SECTION = 16;
export const MELODY_GAIN = 0.7;
export const CHORD_GAIN = 0.32;

export interface SongNote {
  freq: number;
  gain: number;
  /** 몇 칸 동안 울리는지 */
  steps: number;
}

const same = (a: number[] | null | undefined, b: number[] | null | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 그 칸에서 새로 울리기 시작하는 음.
 * 같은 화음이 이어지면 첫 칸에서 한 번만 내고 이어진 길이만큼 끌어 준다(재생 구간 [from, to) 안에서).
 */
export function notesAt(song: Project['song'], scale: Scale, step: number, from = 0, to = STEPS): SongNote[] {
  const rows = scale.steps.length * 2;
  const out: SongNote[] = [];
  const m = song.melody[step];
  if (m !== null && m !== undefined && m >= 0 && m < rows) out.push({ freq: rowFreq(scale, m), gain: MELODY_GAIN, steps: 1 });
  const c = song.chords[step];
  if (c && c.length > 0 && !(step > from && same(song.chords[step - 1], c))) {
    let len = 1;
    while (step + len < to && same(song.chords[step + len], c)) len++;
    for (const r of c) if (r >= 0 && r < rows) out.push({ freq: rowFreq(scale, r), gain: CHORD_GAIN, steps: len });
  }
  return out;
}

/** 곡 전체 길이(초). 마지막 음의 여운까지 */
export function songSeconds(bpm: number, tail = 1): number {
  return (STEPS * 60) / bpm + tail;
}

// ── 화음 ─────────────────────────────────────────

export interface ChordPreset {
  name: string;
  rows: number[];
}

/** 7음 음계는 I·IV·V·vi, 12평균율은 같은 이름의 장음계 화음. 5음계 등은 없음 */
export function chordPresets(scale: Pick<Scale, 'kind' | 'steps'>): ChordPreset[] {
  const n = scale.steps.length;
  if (n === 7) {
    return [
      { name: 'I', rows: [0, 2, 4] },
      { name: 'IV', rows: [3, 5, 7] },
      { name: 'V', rows: [4, 6, 8] },
      { name: 'vi', rows: [5, 7, 9] },
    ];
  }
  if (n === 12 && scale.kind === 'equal12') {
    return [
      { name: 'I', rows: [0, 4, 7] },
      { name: 'IV', rows: [5, 9, 12] },
      { name: 'V', rows: [7, 11, 14] },
      { name: 'vi', rows: [9, 12, 16] },
    ];
  }
  return [];
}

/** 화음 칸에 쓰는 짧은 이름: 프리셋이면 그 이름, 아니면 음 이름을 이어 쓴다 */
export function chordLabel(scale: Scale, rows: number[]): string {
  const p = chordPresets(scale).find((x) => same(x.rows, rows));
  return p ? p.name : rows.map((r) => stepName(scale, r)).join('');
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 화음의 주파수 비. 가장 낮은 음을 1로 둔 소수와, 작은 정수의 비로 딱 떨어지면 그 정수들.
 * 정수비 판정은 음계에 적힌 정수비로 하므로 평균율 화음은 정수비가 아니다.
 */
export function chordRatio(scale: Scale, rows: number[]): { decimals: number[]; integers: number[] | null } {
  const sorted = [...rows].sort((a, b) => a - b);
  const freqs = sorted.map((r) => rowFreq(scale, r));
  const decimals = freqs.map((f) => f / freqs[0]);
  const n = scale.steps.length;
  const fracs = sorted.map((r) => {
    const st = scale.steps[r % n];
    if (!st.ratio) return null;
    return [st.ratio[0] * 2 ** Math.floor(r / n), st.ratio[1]] as const;
  });
  if (fracs.some((f) => f === null)) return { decimals, integers: null };
  // 공통 분모로 맞춘 뒤 최대공약수로 나눈다
  const den = fracs.reduce((acc, f) => (acc * f![1]) / gcd(acc, f![1]), 1);
  let ints = fracs.map((f) => (f![0] * den) / f![1]);
  const g = ints.reduce((a, b) => gcd(a, b));
  ints = ints.map((x) => x / g);
  return { decimals, integers: Math.max(...ints) <= 999 ? ints : null };
}
