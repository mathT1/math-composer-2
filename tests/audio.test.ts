import { describe, expect, it } from 'vitest';
import { StepClock } from '../src/audio/clock';
import { audibleHarmonics, lowBoost, waveCoefficients } from '../src/audio/timbre';

describe('재생 시계 (작업지시서 6.4절)', () => {
  it('칸마다 정확한 시각을 준다', () => {
    const c = new StepClock(120, 10, 0, 16, false);
    expect(c.stepSeconds).toBe(0.5);
    expect(c.due(10, 1.2)).toEqual([
      { step: 0, time: 10 },
      { step: 1, time: 10.5 },
      { step: 2, time: 11 },
    ]);
  });

  it('타이머가 불규칙하게 깨어나도 칸을 빠뜨리거나 두 번 내주지 않는다', () => {
    const c = new StepClock(96, 5, 0, 32, false);
    const got: number[] = [];
    let s = 3;
    for (let t = 5; t < 30; ) {
      for (const d of c.due(t, 0.15)) got.push(d.step);
      s = (s * 1664525 + 1013904223) >>> 0;
      t += 0.005 + (s / 0xffffffff) * 0.12; // 5~125ms 간격
    }
    expect(got).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(c.exhausted).toBe(true);
    expect(c.endTime).toBeCloseTo(5 + 32 * 0.625, 9);
  });

  it('구간 반복은 구간 안에서 되돌아온다', () => {
    const c = new StepClock(60, 0, 16, 32, true);
    const steps = c.due(0, 18.5).map((d) => d.step);
    expect(steps).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 16, 17, 18]);
    expect(c.exhausted).toBe(false);
  });

  it('재생 위치는 모든 칸에서 맞다', () => {
    const c = new StepClock(60, 2, 0, 16, false);
    expect(c.stepAt(1.9)).toBeNull();
    for (let i = 0; i < 16; i++) expect(c.stepAt(2 + i + 0.5)).toBe(i);
    expect(c.stepAt(18.01)).toBeNull();
    const loop = new StepClock(60, 0, 0, 4, true);
    expect(loop.stepAt(5.2)).toBe(1);
  });

  it('잘못된 빠르기와 구간을 거부한다', () => {
    expect(() => new StepClock(0, 0, 0, 16, false)).toThrow(RangeError);
    expect(() => new StepClock(96, 0, 8, 8, false)).toThrow(RangeError);
  });
});

describe('음색', () => {
  it('배음 세기를 파형 계수로 옮긴다', () => {
    const { real, imag } = waveCoefficients([1, 0.5, 0, 0.25]);
    expect(Array.from(real)).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(imag)).toEqual([0, 1, 0.5, 0, 0.25]);
  });

  it('배음이 모두 0이거나 잘못된 값이면 기본음만 낸다', () => {
    expect(Array.from(waveCoefficients([0, 0, NaN, -1]).imag)).toEqual([0, 1, 0, 0, 0]);
  });

  it('낮은 음만 키우고 2배를 넘지 않는다', () => {
    expect(lowBoost(261.63)).toBe(1);
    expect(lowBoost(880)).toBe(1);
    expect(lowBoost(130.815)).toBeCloseTo(Math.SQRT2, 6);
    expect(lowBoost(20)).toBe(2);
    expect(lowBoost(0)).toBe(1);
  });

  it('샘플레이트의 절반을 넘는 배음을 뺀다', () => {
    expect(audibleHarmonics([1, 1, 1, 1], 7000, 48000)).toEqual([1, 1, 1, 0]);
  });
});
