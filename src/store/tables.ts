/**
 * 비율 실험실의 표에 학생이 적은 글 (작업 데이터의 `tables`).
 * 적은 그대로(글자로) 둔다. 채점은 화면에서 그때그때 한다.
 */
import type { Project } from './project';

export interface Tables {
  /** 칸 0~12의 예측 주파수 */
  prediction: string[];
  /** 반음 한 칸의 비 r */
  r: string;
  /** 칸 0~12의 평균율 주파수 */
  equal: string[];
  /** 센트 유도표: `${줄}.${열}` → 적은 글 */
  cent: Record<string, string>;
}

const strings = (v: unknown, n: number): string[] =>
  Array.from({ length: n }, (_, i) => (Array.isArray(v) && typeof v[i] === 'string' ? (v[i] as string).slice(0, 20) : ''));

export function readTables(p: Pick<Project, 'tables'>): Tables {
  const t = p.tables ?? {};
  const cent: Record<string, string> = {};
  if (typeof t.cent === 'object' && t.cent !== null && !Array.isArray(t.cent)) {
    for (const [k, v] of Object.entries(t.cent as Record<string, unknown>)) {
      if (/^\w{1,12}\.\w{1,12}$/.test(k) && typeof v === 'string') cent[k] = v.slice(0, 20);
    }
  }
  return {
    prediction: strings(t.prediction, 13),
    r: typeof t.r === 'string' ? t.r.slice(0, 20) : '',
    equal: strings(t.equal, 13),
    cent,
  };
}
