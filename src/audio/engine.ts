/**
 * 소리 내기 (작업지시서 6.4절).
 * 출력 경로: 각 소리 → 음량 → 컴프레서 → 제한기 → 출력.
 * 음표를 예약하는 함수는 하나이며, 화면 재생(AudioContext)과 파일 만들기(OfflineAudioContext)가 같이 쓴다.
 */
import { StepClock } from './clock';
import { audibleHarmonics, lowBoost, makeWave } from './timbre';

/** 어떤 조작으로도 출력이 이 값을 넘지 않는다(전체 눈금 1 기준) */
export const CEILING = 0.8;

const ATTACK = 0.012;
const RELEASE = 0.06;

export interface Note {
  freq: number;
  /** 시작 시각(초, 컨텍스트 기준) */
  start: number;
  duration: number;
  /** 0~1. 생략하면 0.5 */
  gain?: number;
}

/** 컨텍스트에 출력 경로를 만들고 소리를 넣을 입구를 돌려준다 */
export function buildOutput(ctx: BaseAudioContext): GainNode {
  const input = ctx.createGain();
  input.gain.value = 0.7;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  // 제한기가 놓친 순간 봉우리까지 막는 마지막 벽: ±1에서 자른 뒤 CEILING을 곱한다
  const wall = ctx.createWaveShaper();
  wall.curve = new Float32Array([-1, 1]);
  const ceiling = ctx.createGain();
  ceiling.gain.value = CEILING;

  input.connect(comp).connect(limiter).connect(wall).connect(ceiling).connect(ctx.destination);
  return input;
}

/** 음 하나를 예약한다. 시작과 끝에 짧은 기울기를 넣어 딱 소리를 막는다 */
export function scheduleNote(ctx: BaseAudioContext, out: AudioNode, wave: PeriodicWave, note: Note): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = note.freq;

  const peak = Math.min(1, Math.max(0, note.gain ?? 0.5)) * lowBoost(note.freq) * 0.5;
  const start = Math.max(note.start, ctx.currentTime);
  const hold = Math.max(ATTACK, note.duration - RELEASE);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + ATTACK);
  env.gain.setValueAtTime(peak, start + hold);
  env.gain.linearRampToValueAtTime(0, start + hold + RELEASE);

  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + hold + RELEASE + 0.01);
  osc.onended = () => env.disconnect();
  return osc;
}

/** 음색과 주파수에 맞는 파형을 만든다. 높은 음에서는 들리지 않는 배음을 뺀다 */
export function waveFor(ctx: BaseAudioContext, harmonics: readonly number[], freq: number): PeriodicWave {
  return makeWave(ctx, audibleHarmonics(harmonics, freq, ctx.sampleRate));
}

/** 화면에서 쓰는 엔진. 처음 소리를 낼 때 만들어진다(브라우저는 사용자의 동작 뒤에만 소리를 허용한다) */
export class Engine {
  #ctx: AudioContext | null = null;
  #out: GainNode | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #live = new Set<OscillatorNode>();

  get context(): AudioContext {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ latencyHint: 'interactive' });
      this.#out = buildOutput(this.#ctx);
    }
    return this.#ctx;
  }

  get output(): GainNode {
    void this.context;
    return this.#out!;
  }

  get now(): number {
    return this.context.currentTime;
  }

  /** 사용자의 동작 안에서 부른다 */
  async wake(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  /** 음 하나를 바로 낸다 */
  play(harmonics: readonly number[], freq: number, duration = 0.5, gain = 0.5): void {
    const ctx = this.context;
    this.#track(scheduleNote(ctx, this.output, waveFor(ctx, harmonics, freq), { freq, start: ctx.currentTime + 0.01, duration, gain }));
  }

  /**
   * 칸마다 음을 예약하며 재생한다. onStep은 화면의 재생 위치 표시용으로, 그 칸이 울릴 즈음 불린다.
   * 멈추는 함수를 돌려준다.
   */
  run(
    clock: (startTime: number) => StepClock,
    notesAt: (step: number) => { harmonics: readonly number[]; freq: number; gain?: number }[],
    onStep: (step: number | null) => void,
  ): () => void {
    this.stop();
    const ctx = this.context;
    const c = clock(ctx.currentTime + 0.08);
    let shown: number | null = null;
    const tick = () => {
      for (const { step, time } of c.due(ctx.currentTime, 0.15)) {
        for (const n of notesAt(step)) {
          this.#track(
            scheduleNote(ctx, this.output, waveFor(ctx, n.harmonics, n.freq), {
              freq: n.freq,
              start: time,
              duration: c.stepSeconds * 0.95,
              gain: n.gain,
            }),
          );
        }
      }
      const at = c.stepAt(ctx.currentTime);
      if (at !== shown) {
        shown = at;
        onStep(at);
      }
      if (c.exhausted && ctx.currentTime >= c.endTime) this.stop();
    };
    this.#timer = setInterval(tick, 25);
    tick();
    const stop = () => {
      this.stop();
      onStep(null);
    };
    return stop;
  }

  /** 울리는 소리와 예약된 소리를 모두 멈춘다 */
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const osc of this.#live) {
      try {
        osc.stop();
      } catch {
        // 이미 멈춘 소리
      }
    }
    this.#live.clear();
  }

  #track(osc: OscillatorNode): void {
    this.#live.add(osc);
    osc.addEventListener('ended', () => this.#live.delete(osc));
  }
}

export const engine = new Engine();
