/** 음이름과 센트. 기준은 라4 = 440Hz, 12평균율 (3.3절) */

const NAMES = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];

export interface NearestNote {
  /** 예: 도5, 파#4 */
  name: string;
  /** 그 음의 평균율 주파수 */
  freq: number;
  /** 그 음에서 벗어난 정도(센트). 양수면 높음 */
  cents: number;
}

export function nearestNote(freq: number): NearestNote {
  const semis = Math.round(12 * Math.log2(freq / 440));
  const ref = 440 * 2 ** (semis / 12);
  const index = semis + 57; // 도0 = 0
  const name = `${NAMES[((index % 12) + 12) % 12]}${Math.floor(index / 12)}`;
  return { name, freq: ref, cents: 1200 * Math.log2(freq / ref) };
}

/** “도5보다 2센트 높음”, “도5에 거의 맞음” */
export function describePitch(freq: number): string {
  const n = nearestNote(freq);
  const c = Math.round(n.cents);
  if (c === 0) return `${n.name}에 거의 맞음`;
  return `${n.name}보다 ${Math.abs(c)}센트 ${c > 0 ? '높음' : '낮음'}`;
}
