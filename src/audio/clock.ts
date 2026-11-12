/**
 * 미리 예약하는 재생 시계. 화면 타이머는 부정확하므로, 타이머가 깨어날 때마다
 * “지금부터 조금 뒤까지”에 드는 칸을 오디오 시각으로 예약한다.
 * 소리와 무관한 순수 계산이라 단위 테스트로 확인한다.
 */

export interface DueStep {
  /** 0부터 세는 칸 번호(반복할 때는 구간 안에서 되돌아옴) */
  step: number;
  /** 그 칸이 울려야 하는 오디오 시각(초) */
  time: number;
}

export class StepClock {
  readonly stepSeconds: number;
  #start: number;
  #next = 0;

  constructor(
    /** 분당 박 수. 한 박은 한 칸 */
    readonly bpm: number,
    startTime: number,
    readonly from: number,
    /** 끝 칸(포함하지 않음) */
    readonly to: number,
    readonly loop: boolean,
  ) {
    if (!(bpm > 0) || !(to > from)) throw new RangeError('빠르기와 구간이 올바르지 않습니다.');
    this.stepSeconds = 60 / bpm;
    this.#start = startTime;
  }

  get length(): number {
    return this.to - this.from;
  }

  /** now부터 horizon초 뒤까지 울릴 칸 가운데 아직 내주지 않은 것 */
  due(now: number, horizon: number): DueStep[] {
    const out: DueStep[] = [];
    const until = now + horizon;
    for (;;) {
      if (!this.loop && this.#next >= this.length) break;
      const time = this.#start + this.#next * this.stepSeconds;
      if (time >= until) break;
      out.push({ step: this.from + (this.#next % this.length), time });
      this.#next++;
    }
    return out;
  }

  /** 반복하지 않는 재생이 끝나는 시각 */
  get endTime(): number {
    return this.#start + this.length * this.stepSeconds;
  }

  /** 반복하지 않는 재생에서 모든 칸을 내주었는지 */
  get exhausted(): boolean {
    return !this.loop && this.#next >= this.length;
  }

  /** 그 시각에 울리고 있는 칸. 시작 전이나 끝난 뒤면 null */
  stepAt(time: number): number | null {
    const n = Math.floor((time - this.#start) / this.stepSeconds);
    if (n < 0) return null;
    if (!this.loop && n >= this.length) return null;
    return this.from + (n % this.length);
  }
}
