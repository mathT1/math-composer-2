/**
 * 학생이 적은 수를 채점한다 (작업지시서 5.5절).
 * 글자가 같은지가 아니라 허용 오차로 본다. 정답은 반올림하지 않은 값으로 계산한다.
 */

export const TOL = {
  hz: 0.05,
  ratio: 0.002,
  cents: 0.5,
  /** 옥타브 수 log₂(f₂/f₁). 0.585처럼 셋째 자리까지 적으면 맞는다 */
  octaves: 0.001,
  /** 반음 수 12·log₂(f₂/f₁) */
  semis: 0.005,
} as const;

export type Mark = 'empty' | 'right' | 'wrong' | 'invalid';

/** “1,05946”처럼 쉼표로 적어도 읽는다. 읽을 수 없으면 null */
export function readNumber(text: string | undefined | null): number | null {
  if (text === undefined || text === null) return null;
  const t = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/** 적은 글을 정답들 가운데 하나와 견준다. 정답이 여럿이면 어느 하나에 들면 맞음 */
export function grade(text: string | undefined | null, answers: number | number[], tol: number): Mark {
  const v = readNumber(text);
  if (v === null) return 'empty';
  if (Number.isNaN(v)) return 'invalid';
  const list = Array.isArray(answers) ? answers : [answers];
  return list.some((a) => Number.isFinite(a) && Math.abs(v - a) <= tol + 1e-9) ? 'right' : 'wrong';
}
