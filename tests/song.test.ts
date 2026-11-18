import { describe, expect, it } from 'vitest';
import { presetScale, rowFreq } from '../src/music/scales';
import { CHORD_GAIN, chordLabel, chordPresets, chordRatio, MELODY_GAIN, notesAt, songSeconds } from '../src/music/song';
import { createProject } from '../src/store/project';

const eq = presetScale('equal12');
const just = presetScale('just');
const penta = presetScale('penta');

describe('칸마다 울릴 음 (화면 재생과 WAV가 같이 쓰는 함수)', () => {
  it('선율 한 음은 한 칸 동안', () => {
    const song = createProject('곡').song;
    song.melody[3] = 7;
    expect(notesAt(song, eq, 3)).toEqual([{ freq: rowFreq(eq, 7), gain: MELODY_GAIN, steps: 1 }]);
    expect(notesAt(song, eq, 2)).toEqual([]);
  });

  it('같은 화음이 이어지면 첫 칸에서 한 번, 이어진 길이만큼 낸다', () => {
    const song = createProject('곡').song;
    for (let i = 4; i < 8; i++) song.chords[i] = [0, 4, 7];
    song.chords[8] = [5, 9, 12];
    const first = notesAt(song, eq, 4);
    expect(first).toHaveLength(3);
    expect(first.every((n) => n.steps === 4 && n.gain === CHORD_GAIN)).toBe(true);
    expect(notesAt(song, eq, 5)).toEqual([]);
    expect(notesAt(song, eq, 8).map((n) => n.steps)).toEqual([1, 1, 1]);
  });

  it('구간 재생에서는 구간 경계에서 화음을 끊고 다시 낸다', () => {
    const song = createProject('곡').song;
    for (let i = 14; i < 18; i++) song.chords[i] = [0, 4];
    expect(notesAt(song, eq, 14, 0, 16).map((n) => n.steps)).toEqual([2, 2]);
    expect(notesAt(song, eq, 16, 16, 32).map((n) => n.steps)).toEqual([2, 2]);
    expect(notesAt(song, eq, 14).map((n) => n.steps)).toEqual([4, 4]);
  });

  it('음계 범위를 벗어난 행은 내지 않는다', () => {
    const song = createProject('곡').song;
    song.melody[0] = 15; // 5음계는 0~9행
    song.chords[0] = [1, 30];
    expect(notesAt(song, penta, 0)).toEqual([{ freq: rowFreq(penta, 1), gain: CHORD_GAIN, steps: 1 }]);
  });

  it('곡 길이: 32박 + 여운', () => {
    expect(songSeconds(96)).toBeCloseTo(21, 9);
    expect(songSeconds(120, 0)).toBe(16);
  });
});

describe('화음', () => {
  it('7음 음계와 12평균율에는 I·IV·V·vi, 5음계에는 없다', () => {
    expect(chordPresets(just).map((p) => p.name)).toEqual(['I', 'IV', 'V', 'vi']);
    expect(chordPresets(eq).find((p) => p.name === 'V')!.rows).toEqual([7, 11, 14]);
    expect(chordPresets(penta)).toEqual([]);
  });

  it('순정률 I화음은 4 : 5 : 6, 평균율 I화음은 정수비가 아니다', () => {
    expect(chordRatio(just, [0, 2, 4]).integers).toEqual([4, 5, 6]);
    const e = chordRatio(eq, [0, 4, 7]);
    expect(e.integers).toBeNull();
    expect(e.decimals.map((d) => d.toFixed(3))).toEqual(['1.000', '1.260', '1.498']);
  });

  it('순정률 IV·V·vi 화음과 옥타브를 넘는 음', () => {
    expect(chordRatio(just, [3, 5, 7]).integers).toEqual([4, 5, 6]); // 4/3 : 5/3 : 2
    expect(chordRatio(just, [4, 6, 8]).integers).toEqual([4, 5, 6]);
    expect(chordRatio(just, [5, 7, 9]).integers).toEqual([10, 12, 15]);
  });

  it('피타고라스 장3화음은 64 : 81 : 96', () => {
    expect(chordRatio(presetScale('pythagorean'), [0, 2, 4]).integers).toEqual([64, 81, 96]);
  });

  it('화음 칸의 이름', () => {
    expect(chordLabel(just, [4, 6, 8])).toBe('V');
    expect(chordLabel(penta, [0, 2, 3])).toBe('도미솔');
  });
});
