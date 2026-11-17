/**
 * 녹음 (작업지시서 6.2절).
 * 보정 세 가지를 끄고 모노로 받는다. 블루투스 이어폰의 마이크가 잡히면 본체 마이크로 바꾼다.
 * 녹음이 끝나면 마이크를 완전히 놓는다.
 */

export const MAX_SECONDS = 10;

export interface MicInfo {
  label: string;
  echoCancellation: boolean | undefined;
  noiseSuppression: boolean | undefined;
  autoGainControl: boolean | undefined;
  /** 블루투스 마이크를 피해 다른 마이크로 바꿨는지 */
  switched: boolean;
}

export interface Recording {
  pcm: Float32Array;
  sampleRate: number;
}

export class MicError extends Error {
  constructor(
    readonly kind: 'denied' | 'missing' | 'other',
    message: string,
  ) {
    super(message);
  }
}

/** 이어폰·헤드셋의 마이크로 보이는 이름 */
export function looksWireless(label: string): boolean {
  return /bluetooth|블루투스|hands-?free|headset|헤드셋|buds|버즈|airpods|earbuds|\bsco\b/i.test(label);
}

const constraints = (deviceId?: string): MediaStreamConstraints => ({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  },
});

export class Recorder {
  #stream: MediaStream | null = null;
  #node: AudioWorkletNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #chunks: Float32Array[] = [];
  #length = 0;
  #limit = 0;
  #done: ((r: Recording) => void) | null = null;
  #ctx: AudioContext | null = null;

  /**
   * 녹음을 시작한다. onLevel은 들어오는 소리의 크기(0~1 봉우리)와 지난 시간을 알린다.
   * 돌려주는 약속은 stop()을 부르거나 10초가 차면 끝난다.
   */
  async start(
    ctx: AudioContext,
    onLevel: (peak: number, seconds: number) => void,
    onReady: (info: MicInfo) => void,
  ): Promise<Recording> {
    if (!navigator.mediaDevices?.getUserMedia) throw new MicError('missing', '이 브라우저에서는 녹음할 수 없습니다.');
    let switched = false;
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia(constraints());
      const first = this.#stream.getAudioTracks()[0];
      if (looksWireless(first.label)) {
        const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
        const builtIn = inputs.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label && !looksWireless(d.label));
        if (builtIn) {
          this.#release();
          this.#stream = await navigator.mediaDevices.getUserMedia(constraints(builtIn.deviceId));
          switched = true;
        }
      }
    } catch (e) {
      this.#release();
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied', '마이크 사용이 허용되지 않았습니다.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('missing', '마이크를 찾지 못했습니다.');
      throw new MicError('other', `마이크를 켜지 못했습니다(${name ?? '알 수 없는 오류'}).`);
    }

    const track = this.#stream.getAudioTracks()[0];
    const s = track.getSettings();
    onReady({
      label: track.label || '마이크',
      // 새 브라우저는 반향 제거 값을 글자('all' 등)로 주기도 한다. 꺼짐이 아니면 켜진 것으로 본다
      echoCancellation: s.echoCancellation === undefined ? undefined : s.echoCancellation !== false,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      switched,
    });

    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/recorder.js`);
    this.#ctx = ctx;
    this.#chunks = [];
    this.#length = 0;
    this.#limit = Math.round(MAX_SECONDS * ctx.sampleRate);
    this.#source = ctx.createMediaStreamSource(this.#stream);
    this.#node = new AudioWorkletNode(ctx, 'recorder');
    // 녹음하는 소리는 스피커로 내보내지 않는다
    const silent = ctx.createGain();
    silent.gain.value = 0;
    this.#source.connect(this.#node).connect(silent).connect(ctx.destination);

    return new Promise<Recording>((resolve) => {
      this.#done = resolve;
      this.#node!.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!this.#done) return;
        const chunk = e.data;
        this.#chunks.push(chunk);
        this.#length += chunk.length;
        let peak = 0;
        for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]));
        onLevel(peak, this.#length / ctx.sampleRate);
        if (this.#length >= this.#limit) this.stop();
      };
    });
  }

  get recording(): boolean {
    return this.#done !== null;
  }

  /** 녹음을 끝내고 마이크를 놓는다 */
  stop(): void {
    const done = this.#done;
    this.#done = null;
    const rate = this.#ctx?.sampleRate ?? 48000;
    this.#source?.disconnect();
    this.#node?.disconnect();
    this.#source = null;
    this.#node = null;
    this.#release();
    if (!done) return;
    const pcm = new Float32Array(Math.min(this.#length, this.#limit));
    let at = 0;
    for (const c of this.#chunks) {
      if (at >= pcm.length) break;
      pcm.set(c.subarray(0, Math.min(c.length, pcm.length - at)), at);
      at += c.length;
    }
    this.#chunks = [];
    done({ pcm, sampleRate: rate });
  }

  #release(): void {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }
}

/** 소리 파일을 풀어 모노로 만든다. 10초를 넘으면 앞 10초만 쓴다 */
export async function decodeFile(ctx: BaseAudioContext, data: ArrayBuffer): Promise<Recording & { cut: boolean }> {
  const buf = await ctx.decodeAudioData(data);
  const n = Math.min(buf.length, Math.round(MAX_SECONDS * buf.sampleRate));
  const pcm = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i] += d[i] / buf.numberOfChannels;
  }
  return { pcm, sampleRate: buf.sampleRate, cut: buf.length > n };
}

/** 샘플레이트를 바꾼다(백업 파일에 넣을 구간을 22.05kHz로 낮출 때) */
export async function resample(pcm: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to || pcm.length === 0) return pcm.slice();
  const off = new OfflineAudioContext(1, Math.max(1, Math.round((pcm.length * to) / from)), to);
  const buf = off.createBuffer(1, pcm.length, from);
  buf.getChannelData(0).set(pcm);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}
