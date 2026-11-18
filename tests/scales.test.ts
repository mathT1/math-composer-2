import { describe, expect, it } from 'vitest';
import { grade, readNumber, TOL } from '../src/music/grade';
import { BASE_FREQ, INTERVALS, nearestRow, presetScale, remapSong, rowFreq, rowName, songHasNotes, stepName, tuningRatio } from '../src/music/scales';
import { createProject } from '../src/store/project';
import { readTables } from '../src/store/tables';

const hz = (ratio: number) => BASE_FREQ * ratio;
const cents = (ratio: number) => 1200 * Math.log2(ratio);

describe('조율 기준표 (작업지시서 3.3절)', () => {
  const third = INTERVALS.third.tunings.map(tuningRatio);
  const fifth = INTERVALS.fifth.tunings.map(tuningRatio);

  it('장3도: 순정률·평균율·피타고라스', () => {
    expect(third.map((r) => hz(r).toFixed(2))).toEqual(['327.04', '329.63', '331.13']);
    expect(third.map((r) => cents(r).toFixed(2))).toEqual(['386.31', '400.00', '407.82']);
    expect(third[1].toFixed(4)).toBe('1.2599');
    expect(third[2].toFixed(4)).toBe('1.2656');
  });

  it('완전5도: 순정률·평균율·피타고라스', () => {
    expect(fifth.map((r) => hz(r).toFixed(2))).toEqual(['392.44', '392.00', '392.44']);
    expect(fifth.map((r) => cents(r).toFixed(2))).toEqual(['701.96', '700.00', '701.96']);
  });

  it('“순정률”로 부르는 음은 실제로 정수비다', () => {
    const just = presetScale('just');
    expect(just.steps.every((s) => s.ratio && Number.isInteger(s.ratio[0]) && Number.isInteger(s.ratio[1]))).toBe(true);
    expect(rowFreq(just, 2).toFixed(2)).toBe('327.04');
    expect(rowFreq(presetScale('equal12'), 4).toFixed(2)).toBe('329.63');
    expect(rowFreq(presetScale('pythagorean'), 2).toFixed(2)).toBe('331.13');
  });
});

describe('음계', () => {
  it('네 가지 음계의 음 개수와 이름', () => {
    expect(presetScale('equal12').steps).toHaveLength(12);
    expect(presetScale('penta').steps).toHaveLength(5);
    expect(presetScale('just').steps).toHaveLength(7);
    expect(presetScale('pythagorean').steps).toHaveLength(7);
    expect(stepName(presetScale('penta'), 3)).toBe('솔');
    expect(stepName(presetScale('equal12'), 1)).toBe('도#');
    expect(rowName(presetScale('just'), 7)).toBe('높은 도');
  });

  it('행 번호는 두 옥타브를 덮는다', () => {
    const s = presetScale('equal12');
    expect(rowFreq(s, 0)).toBeCloseTo(261.63, 6);
    expect(rowFreq(s, 12)).toBeCloseTo(523.26, 6);
    expect(rowFreq(s, 23)).toBeCloseTo(261.63 * 2 ** (23 / 12), 6);
  });

  it('모든 음계의 첫 음은 0센트이고 차례로 높아진다', () => {
    for (const k of ['equal12', 'penta', 'just', 'pythagorean'] as const) {
      const st = presetScale(k).steps;
      expect(st[0].cents).toBe(0);
      for (let i = 1; i < st.length; i++) expect(st[i].cents).toBeGreaterThan(st[i - 1].cents);
    }
  });
});

describe('음계를 바꿀 때 곡 옮기기 (5.6절)', () => {
  const eq = presetScale('equal12');
  const just = presetScale('just');
  const penta = presetScale('penta');

  it('칸 번호가 아니라 음높이가 가장 가까운 음으로 옮긴다', () => {
    // 12평균율 4번(미, 400센트) → 순정률의 미(2번, 386센트)
    expect(nearestRow(eq, 4, just)).toBe(2);
    // 12평균율 7번(솔) → 순정률 4번(솔)
    expect(nearestRow(eq, 7, just)).toBe(4);
    // 둘째 옥타브의 미(16번) → 순정률 9번
    expect(nearestRow(eq, 16, just)).toBe(9);
    // 파(500센트) → 5음계에서는 미(400)와 솔(700) 가운데 미가 가깝다
    expect(nearestRow(eq, 5, penta)).toBe(2);
  });

  it('같은 거리면 낮은 음으로 간다', () => {
    // 도#(100센트)는 5음계의 도(0)와 레(200) 사이 한가운데
    expect(nearestRow(eq, 1, penta)).toBe(0);
  });

  it('옮긴 칸 번호는 항상 새 음계의 범위 안이다', () => {
    for (let r = 0; r < 24; r++) {
      const to = nearestRow(eq, r, penta);
      expect(to).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThan(10);
    }
  });

  it('화음은 겹친 음을 하나로 합친다', () => {
    const song = createProject('곡').song;
    song.melody[0] = 4;
    song.chords[0] = [4, 5]; // 미, 파 → 5음계에서는 둘 다 미
    song.chords[1] = [0, 4, 7];
    const out = remapSong(song, eq, penta);
    expect(out.melody[0]).toBe(2);
    expect(out.chords[0]).toEqual([2]);
    expect(out.chords[1]).toEqual([0, 2, 3]);
    expect(out.melody[1]).toBeNull();
    expect(out.bpm).toBe(song.bpm);
  });

  it('곡에 음이 있는지 안다', () => {
    const song = createProject('곡').song;
    expect(songHasNotes(song)).toBe(false);
    song.chords[3] = [1];
    expect(songHasNotes(song)).toBe(true);
  });
});

describe('채점 (5.5절 허용 오차)', () => {
  it('반올림 방식에 따라 갈리는 값을 모두 맞게 본다', () => {
    const exact = 261.63 * 1.5; // 392.445
    expect(grade('392.44', exact, TOL.hz)).toBe('right');
    expect(grade('392.45', exact, TOL.hz)).toBe('right');
    expect(grade('392.4', exact, TOL.hz)).toBe('right');
    expect(grade('392.5', exact, TOL.hz)).toBe('wrong');
    expect(grade('392', exact, TOL.hz)).toBe('wrong');
  });

  it('비 ±0.002, 센트 ±0.5', () => {
    expect(grade('1.0595', 2 ** (1 / 12), TOL.ratio)).toBe('right');
    expect(grade('1.06', 2 ** (1 / 12), TOL.ratio)).toBe('right');
    expect(grade('1.062', 2 ** (1 / 12), TOL.ratio)).toBe('wrong');
    expect(grade('702', 701.955, TOL.cents)).toBe('right');
    expect(grade('700', 701.955, TOL.cents)).toBe('wrong');
  });

  it('빈칸과 읽을 수 없는 글을 가린다', () => {
    expect(grade('', 1, 1)).toBe('empty');
    expect(grade('  ', 1, 1)).toBe('empty');
    expect(grade('약 2', 1, 1)).toBe('invalid');
    expect(readNumber('1,05946')).toBeCloseTo(1.05946, 9);
    expect(readNumber('.5')).toBe(0.5);
  });

  it('정답이 여럿이면 어느 하나에 들면 맞다', () => {
    expect(grade('277.2', [277.18, 300], TOL.hz)).toBe('right');
    expect(grade('300.04', [277.18, 300], TOL.hz)).toBe('right');
  });
});

describe('표에 적은 글 읽기', () => {
  it('모양이 다른 값은 빈칸으로 채운다', () => {
    const t = readTables({ tables: { prediction: ['261.63', 3, null], r: 7, equal: 'x', cent: { 'fifth.oct': '0.585', 'bad key!': '1', ok: 2 } } });
    expect(t.prediction).toHaveLength(13);
    expect(t.prediction.slice(0, 3)).toEqual(['261.63', '', '']);
    expect(t.r).toBe('');
    expect(t.equal.every((s) => s === '')).toBe(true);
    expect(t.cent).toEqual({ 'fifth.oct': '0.585' });
  });
});
