import { describe, expect, it } from 'vitest';
import { fromBackupText, toBackup } from '../src/store/backup';
import { createProject, fileStem, filledBars, parseProject, ProjectError, SCHEMA_VERSION } from '../src/store/project';

const make = () => createProject('리코더 소리 탐구', { id: '20315', name: '김하늘' }, 1_700_000_000_000, 'p-1');
const copy = (p: unknown) => JSON.parse(JSON.stringify(p));

describe('작업 데이터 (작업지시서 6.5절)', () => {
  it('새 작업은 기본값으로 채워진다', () => {
    const p = make();
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.song.melody).toHaveLength(32);
    expect(p.song.chords).toHaveLength(32);
    expect(p.timbre.harmonics).toHaveLength(16);
    expect(p.scale.steps).toHaveLength(12);
    expect(filledBars(p)).toBe(0);
  });

  it('이름이 비면 기본 이름을 붙이고, 학번과 이름은 적은 때만 남긴다', () => {
    const p = createProject('   ');
    expect(p.name).toBe('이름 없는 작업');
    expect('studentId' in p).toBe(false);
    expect('studentName' in p).toBe(false);
  });

  it('저장하고 다시 읽어도 같은 내용이다', () => {
    const p = make();
    p.song.melody[0] = 3;
    p.song.chords[4] = [0, 4, 7];
    p.answers['q1.predict'] = '같은 수를 곱할 것 같다';
    expect(parseProject(copy(p))).toEqual(p);
  });

  it('켜진 음이 있는 마디를 센다', () => {
    const p = make();
    p.song.melody[0] = 0;
    p.song.melody[1] = 2;
    p.song.chords[30] = [0, 4];
    expect(filledBars(p)).toBe(2);
  });

  it('파일 이름은 학번_이름_소리의수학, 없으면 작업 이름', () => {
    expect(fileStem(make())).toBe('20315_김하늘_소리의수학');
    expect(fileStem(createProject('내 곡: 첫 번째/연습'))).toBe('내_곡_첫_번째_연습');
  });

  it('음계 범위를 벗어난 칸 번호를 거부한다 (5.6절)', () => {
    const p = copy(make());
    p.song.melody[5] = 24; // 12음 음계의 두 옥타브는 0~23
    expect(() => parseProject(p)).toThrow(ProjectError);
    p.song.melody[5] = 23;
    expect(() => parseProject(p)).not.toThrow();
    p.song.chords[0] = [0, 99];
    expect(() => parseProject(p)).toThrow(ProjectError);
  });

  it('모양이 맞지 않는 값을 거부한다', () => {
    const broken: ((p: any) => void)[] = [
      (p) => (p.song.melody = [1, 2, 3]),
      (p) => (p.song.bpm = 999),
      (p) => (p.scale.steps = [{ cents: 0 }]),
      (p) => (p.scale.steps[3].cents = 5),
      (p) => (p.timbre.harmonics = [1]),
      (p) => (p.timbre.harmonics[2] = 'x'),
      (p) => (p.sounds = new Array(9).fill({})),
      (p) => (p.schemaVersion = SCHEMA_VERSION + 1),
      (p) => delete p.id,
    ];
    for (const edit of broken) {
      const p = copy(make());
      edit(p);
      expect(() => parseProject(p), edit.toString()).toThrow(ProjectError);
    }
    for (const v of [null, 3, 'x', [], {}]) expect(() => parseProject(v)).toThrow(ProjectError);
  });

  it('글자는 다듬어 글자로만 남긴다', () => {
    const p = copy(make());
    p.name = '<img src=x onerror=alert(1)>\u0000' + '가'.repeat(100);
    p.answers = { ok: '답', 'bad key!': '버림', n: 3 };
    const out = parseProject(p);
    expect(out.name).toHaveLength(40);
    // 태그처럼 보이는 글도 지우지 않고 글자로 둔다. 화면은 글자로만 그린다
    expect(out.name.startsWith('<img src=x')).toBe(true);
    expect(out.answers).toEqual({ ok: '답' });
  });
});

describe('백업 파일과 앨범 HTML', () => {
  it('백업 파일에서 작업을 되살린다', () => {
    const p = make();
    p.song.melody[7] = 11;
    expect(fromBackupText(toBackup(p)).project).toEqual(p);
  });

  it('앨범 HTML 안에 넣은 내용에서도 되살린다', () => {
    const p = make();
    p.name = '</script><b>이름</b>';
    const html =
      '<!doctype html><html><body><h1>앨범</h1><script type="application/json" id="mc2-data">' +
      toBackup(p) +
      '</script></body></html>';
    // 이름에 든 태그가 HTML을 깨지 않는다
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(fromBackupText(html).project).toEqual(p);
  });

  it('다른 파일은 이유를 말하고 거부한다', () => {
    expect(() => fromBackupText('{"check":true}')).toThrow('백업 파일이 아닙니다');
    expect(() => fromBackupText('<html><body>그냥 문서</body></html>')).toThrow('작업 내용이 들어 있지 않습니다');
    expect(() => fromBackupText('{"kind":')).toThrow('읽을 수 없습니다');
    expect(() => fromBackupText('{"kind":"math-composer-2-backup","project":{}}')).toThrow(ProjectError);
  });

  it('작업에 없는 소리의 조각은 버린다', () => {
    const text = toBackup(make(), { ghost: { sampleRate: 22050, pcm16: 'AAAA' } });
    expect(fromBackupText(text).clips).toEqual({});
  });
});
