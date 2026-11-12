/**
 * 작업 데이터의 모양과 검증 (작업지시서 6.5절).
 * 불러온 파일은 모두 parseProject를 거친다. 모양이 맞지 않으면 이유를 말하고 거부한다.
 */

export const SCHEMA_VERSION = 1;
export const SONG_STEPS = 32;
export const HARMONICS = 16;
export const MAX_SOUNDS = 8;

export interface ScaleStep {
  /** 기준음에서의 거리(센트). 0 이상 1200 미만 */
  cents: number;
  /** 정수비로 정의된 음이면 [분자, 분모] */
  ratio?: [number, number];
}

export interface Scale {
  name: string;
  kind: 'equal12' | 'penta' | 'just' | 'pythagorean' | 'equalN' | 'custom';
  baseFreq: number;
  steps: ScaleStep[];
}

export interface Sound {
  id: string;
  label: string;
  source: 'mic' | 'sample' | 'file';
  sampleRate: number;
  /** 전체 녹음 길이(샘플). 소리 자체는 기기 저장소에 따로 둔다 */
  length: number;
  selection: { start: number; end: number };
  f0: number | null;
  confidence: number;
  harmonics: number[];
  inharmonicity: number;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  studentId?: string;
  studentName?: string;
  createdAt: number;
  updatedAt: number;
  sounds: Sound[];
  timbre: { harmonics: number[]; from: string };
  scale: Scale;
  song: { bpm: number; melody: (number | null)[]; chords: (number[] | null)[] };
  tables: Record<string, unknown>;
  answers: Record<string, string>;
  fit: { A: number; f: number; phi: number } | null;
}

/** 기본 음색 세 가지. 배음 16개의 세기(1배음 기준) */
export const TIMBRE_PRESETS: Record<string, number[]> = {
  맑은: pad([1, 0.18, 0.06, 0.02]),
  날카로운: pad([1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12, 0.1, 0.08]),
  묵직한: pad([1, 0.7, 0.12, 0.3, 0.05, 0.1]),
};

function pad(a: number[]): number[] {
  return Array.from({ length: HARMONICS }, (_, i) => a[i] ?? 0);
}

export function equal12(baseFreq = 261.63): Scale {
  return {
    name: '12평균율',
    kind: 'equal12',
    baseFreq,
    steps: Array.from({ length: 12 }, (_, i) => ({ cents: i * 100 })),
  };
}

export function createProject(
  name: string,
  student: { id?: string; name?: string } = {},
  now = Date.now(),
  id: string = crypto.randomUUID(),
): Project {
  const p: Project = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: clean(name, 40) || '이름 없는 작업',
    createdAt: now,
    updatedAt: now,
    sounds: [],
    timbre: { harmonics: [...TIMBRE_PRESETS.맑은], from: '맑은' },
    scale: equal12(),
    song: {
      bpm: 96,
      melody: Array.from({ length: SONG_STEPS }, () => null),
      chords: Array.from({ length: SONG_STEPS }, () => null),
    },
    tables: {},
    answers: {},
    fit: null,
  };
  const sid = clean(student.id ?? '', 20);
  const sname = clean(student.name ?? '', 20);
  if (sid) p.studentId = sid;
  if (sname) p.studentName = sname;
  return p;
}

/** 글자 입력을 다듬는다: 제어 문자를 지우고 길이를 자른다 */
export function clean(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

/** 내보내는 파일 이름의 앞부분. `학번_이름_소리의수학` 또는 작업 이름 (5.8절) */
export function fileStem(p: Pick<Project, 'name' | 'studentId' | 'studentName'>): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  const who = [p.studentId, p.studentName].filter(Boolean).map((s) => safe(s!));
  return who.length ? `${who.join('_')}_소리의수학` : safe(p.name) || '소리의수학';
}

/** 곡에 켜진 음이 있는 마디 수 (상태 줄의 “4/8마디”) */
export function filledBars(p: Project): number {
  let bars = 0;
  for (let bar = 0; bar < SONG_STEPS / 4; bar++) {
    let any = false;
    for (let i = bar * 4; i < bar * 4 + 4; i++) {
      if (p.song.melody[i] !== null || p.song.chords[i] !== null) any = true;
    }
    if (any) bars++;
  }
  return bars;
}

export class ProjectError extends Error {}

const fail = (why: string): never => {
  throw new ProjectError(why);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${what} 값이 올바르지 않습니다.`);
const str = (v: unknown, what: string, max: number): string =>
  typeof v === 'string' ? clean(v, max) : fail(`${what} 값이 글자가 아닙니다.`);

function harmonics(v: unknown, what: string): number[] {
  if (!Array.isArray(v) || v.length !== HARMONICS) return fail(`${what}의 배음이 ${HARMONICS}개가 아닙니다.`);
  return v.map((x) => num(x, `${what}의 배음`, 0, 100));
}

function parseScale(v: unknown): Scale {
  if (!isObj(v)) return fail('음계가 없습니다.');
  const kinds = ['equal12', 'penta', 'just', 'pythagorean', 'equalN', 'custom'] as const;
  const kind = kinds.find((k) => k === v.kind) ?? fail('음계의 종류를 알 수 없습니다.');
  if (!Array.isArray(v.steps) || v.steps.length < 2 || v.steps.length > 24) return fail('음계의 음 개수가 2~24개가 아닙니다.');
  const steps = v.steps.map((s): ScaleStep => {
    if (!isObj(s)) return fail('음계의 음이 올바르지 않습니다.');
    const step: ScaleStep = { cents: num(s.cents, '음계의 센트', 0, 1199.999) };
    if (Array.isArray(s.ratio) && s.ratio.length === 2) {
      step.ratio = [num(s.ratio[0], '음계의 비', 1, 1e6), num(s.ratio[1], '음계의 비', 1, 1e6)];
    }
    return step;
  });
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].cents <= steps[i - 1].cents) fail('음계의 음이 낮은 음부터 차례로 놓여 있지 않습니다.');
  }
  return { name: str(v.name, '음계 이름', 30), kind, baseFreq: num(v.baseFreq, '기준음', 55, 1760), steps };
}

function parseSound(v: unknown): Sound {
  if (!isObj(v)) return fail('소리 정보가 올바르지 않습니다.');
  const sources = ['mic', 'sample', 'file'] as const;
  const length = num(v.length, '소리 길이', 0, 48000 * 60);
  const sel = isObj(v.selection) ? v.selection : fail('소리의 고른 구간이 없습니다.');
  const start = num(sel.start, '구간 시작', 0, length);
  const end = num(sel.end, '구간 끝', start, length);
  return {
    id: str(v.id, '소리 번호', 64) || fail('소리 번호가 비어 있습니다.'),
    label: str(v.label, '소리 이름', 30),
    source: sources.find((s) => s === v.source) ?? fail('소리의 출처를 알 수 없습니다.'),
    sampleRate: num(v.sampleRate, '샘플레이트', 8000, 192000),
    length,
    selection: { start, end },
    f0: v.f0 === null ? null : num(v.f0, '기본 주파수', 20, 5000),
    confidence: num(v.confidence, '신뢰도', 0, 1),
    harmonics: harmonics(v.harmonics, '소리'),
    inharmonicity: num(v.inharmonicity, '배음 어긋남', 0, 1),
  };
}

/**
 * 모르는 값을 작업 데이터로 읽는다. 맞지 않으면 ProjectError를 던진다.
 * 곡의 칸 번호는 두 옥타브(음계 음 개수의 2배) 범위 안이어야 한다 (5.6절).
 */
export function parseProject(v: unknown): Project {
  if (!isObj(v)) return fail('작업 파일의 모양이 아닙니다.');
  if (typeof v.schemaVersion !== 'number') return fail('작업 파일의 판 번호가 없습니다.');
  if (v.schemaVersion > SCHEMA_VERSION) {
    return fail('이 파일은 더 새로운 판의 앱에서 만들었습니다. 앱을 새 판으로 바꾼 뒤 다시 불러오세요.');
  }
  if (v.schemaVersion < 1) return fail('작업 파일의 판 번호가 올바르지 않습니다.');

  const scale = parseScale(v.scale);
  const rows = scale.steps.length * 2;
  const song = isObj(v.song) ? v.song : fail('곡이 없습니다.');
  if (!Array.isArray(song.melody) || song.melody.length !== SONG_STEPS) return fail(`선율이 ${SONG_STEPS}칸이 아닙니다.`);
  if (!Array.isArray(song.chords) || song.chords.length !== SONG_STEPS) return fail(`화음이 ${SONG_STEPS}칸이 아닙니다.`);
  const row = (x: unknown) => {
    const n = num(x, '곡의 음', 0, rows - 1);
    return Number.isInteger(n) ? n : fail('곡의 음 번호가 정수가 아닙니다.');
  };
  const melody = song.melody.map((x) => (x === null ? null : row(x)));
  const chords = song.chords.map((c) => {
    if (c === null) return null;
    if (!Array.isArray(c) || c.length < 1 || c.length > 3) return fail('화음의 음 개수가 올바르지 않습니다.');
    return [...new Set(c.map(row))].sort((a, b) => a - b);
  });

  if (!Array.isArray(v.sounds) || v.sounds.length > MAX_SOUNDS) return fail(`소리가 ${MAX_SOUNDS}개를 넘습니다.`);
  const timbre = isObj(v.timbre) ? v.timbre : fail('음색이 없습니다.');
  const answersIn = isObj(v.answers) ? v.answers : {};
  const answers: Record<string, string> = {};
  for (const [k, a] of Object.entries(answersIn)) {
    if (typeof a === 'string' && /^[\w.-]{1,40}$/.test(k)) answers[k] = clean(a, 2000);
  }
  let fit: Project['fit'] = null;
  if (isObj(v.fit)) fit = { A: num(v.fit.A, '진폭', 0, 10), f: num(v.fit.f, '주파수', 1, 5000), phi: num(v.fit.phi, '위상', -100, 100) };

  const p: Project = {
    schemaVersion: SCHEMA_VERSION,
    id: str(v.id, '작업 번호', 64) || fail('작업 번호가 비어 있습니다.'),
    name: str(v.name, '작업 이름', 40) || '이름 없는 작업',
    createdAt: num(v.createdAt, '만든 시각', 0),
    updatedAt: num(v.updatedAt, '고친 시각', 0),
    sounds: v.sounds.map(parseSound),
    timbre: { harmonics: harmonics(timbre.harmonics, '음색'), from: str(timbre.from, '음색의 출처', 64) },
    scale,
    song: { bpm: num(song.bpm, '빠르기', 60, 160), melody, chords },
    tables: isObj(v.tables) ? (JSON.parse(JSON.stringify(v.tables)) as Record<string, unknown>) : {},
    answers,
    fit,
  };
  if (typeof v.studentId === 'string' && clean(v.studentId, 20)) p.studentId = clean(v.studentId, 20);
  if (typeof v.studentName === 'string' && clean(v.studentName, 20)) p.studentName = clean(v.studentName, 20);
  return p;
}
