<script lang="ts">
  import { onMount } from 'svelte';
  import { buildOutput, CEILING, engine, scheduleNote, waveFor } from '../audio/engine';
  import { offline as offlineState } from '../lib/offline.svelte';
  import { TIMBRE_PRESETS } from '../store/project';
  import { cents, detectPitch } from '../dsp/pitch';
  import { encodeWav } from '../audio/wav';

  const BUILD = __BUILD_TIME__;

  // ── 1. 기기와 브라우저 ─────────────────────────────
  const env = {
    브라우저: navigator.userAgent,
    화면: `${window.innerWidth}×${window.innerHeight} CSS px, 배율 ${window.devicePixelRatio}`,
    '터치 지점': String(navigator.maxTouchPoints),
    '홈 화면 앱으로 실행': window.matchMedia('(display-mode: standalone)').matches ? '예' : '아니오',
    '보안 연결': window.isSecureContext ? '예' : '아니오',
  };

  // ── 2. 오프라인 ───────────────────────────────────
  const offline = $derived(
    offlineState.status === 'ready'
      ? `준비 완료 (이제 인터넷 없이 열림)${offlineState.hasUpdate ? ', 새 판이 있음' : ''}`
      : offlineState.status === 'failed'
        ? `준비 실패: ${offlineState.error}`
        : '확인 중',
  );
  const online = $derived(offlineState.online);

  // ── 3. 마이크 ─────────────────────────────────────
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let chunks: Float32Array[] = [];
  let capturing = false;

  let micState = $state<'꺼짐' | '켜는 중' | '켜짐' | '실패'>('꺼짐');
  let micError = $state('');
  let devices = $state<{ id: string; label: string; group: string }[]>([]);
  let currentDevice = $state("");
  let chosenDevice = $state('');
  let settings = $state<Record<string, string>>({});
  let level = $state(0);
  let liveHz = $state<number | null>(null);
  let liveClarity = $state(0);
  let audioInfo = $state('');

  let recState = $state<'없음' | '녹음 중' | '끝남'>('없음');
  let recResult = $state('');
  let recUrl = $state('');
  let recBlob = $state<Blob | null>(null);

  // ── 4. 소리 내기 ──────────────────────────────────
  let osc: OscillatorNode | null = null;
  let tonePlaying = $state(false);
  let enginePlayed = $state('');
  let ceiling = $state('');

  // ── 5. 저장 ───────────────────────────────────────
  let marker = $state('확인 중');
  let persisted = $state('확인 중');
  let quota = $state('');

  // ── 6. 파일 ───────────────────────────────────────
  let downloads = $state<string[]>([]);
  let opened = $state('');

  let copied = $state('');

  function ensureContext(): AudioContext {
    ctx ??= new AudioContext({ latencyHint: 'interactive' });
    return ctx;
  }

  function describeAudio() {
    if (!ctx) return;
    const ms = (s: number | undefined) => (s === undefined ? '알 수 없음' : `${Math.round(s * 1000)}ms`);
    audioInfo = `샘플레이트 ${ctx.sampleRate}Hz, 기본 지연 ${ms(ctx.baseLatency)}, 출력 지연 ${ms(ctx.outputLatency)}`;
  }

  const onOff = (v: unknown) => (v === true ? '켜짐' : v === false ? '꺼짐' : '알 수 없음');

  async function startMic() {
    stopMic();
    micState = '켜는 중';
    micError = '';
    try {
      const audio = ensureContext();
      await audio.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          ...(chosenDevice ? { deviceId: { exact: chosenDevice } } : {}),
        },
      });
      const track = stream.getAudioTracks()[0];
      const s = track.getSettings();
      settings = {
        '쓰고 있는 마이크': track.label || '이름 없음',
        '반향 제거': onOff(s.echoCancellation),
        '잡음 억제': onOff(s.noiseSuppression),
        '자동 음량 조절': onOff(s.autoGainControl),
        '마이크 샘플레이트': s.sampleRate ? `${s.sampleRate}Hz` : '알 수 없음',
        채널: s.channelCount ? String(s.channelCount) : '알 수 없음',
      };
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `마이크 ${i + 1}`, group: d.groupId }));
      currentDevice = s.deviceId ?? '';

      const source = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      analyser.fftSize = 8192;
      source.connect(analyser);

      await audio.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/recorder.js`);
      const recorder = new AudioWorkletNode(audio, 'recorder');
      recorder.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (capturing) chunks.push(e.data);
      };
      const silent = audio.createGain();
      silent.gain.value = 0;
      source.connect(recorder).connect(silent).connect(audio.destination);

      const buf = new Float32Array(analyser.fftSize);
      timer = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        level = Math.sqrt(sum / buf.length);
        const p = detectPitch(buf, audio.sampleRate);
        liveHz = level > 0.003 ? p.f0 : null;
        liveClarity = p.clarity;
      }, 250);

      describeAudio();
      micState = '켜짐';
    } catch (e) {
      micState = '실패';
      const err = e as DOMException;
      micError =
        err.name === 'NotAllowedError'
          ? '마이크 사용이 거부되었습니다. 주소창 왼쪽의 자물쇠를 눌러 마이크를 허용한 뒤 다시 켜세요.'
          : err.name === 'NotFoundError'
            ? '마이크를 찾지 못했습니다.'
            : `${err.name}: ${err.message}`;
    }
  }

  function stopMic() {
    if (timer) clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    analyser = null;
    if (micState === '켜짐') micState = '꺼짐';
    level = 0;
    liveHz = null;
  }

  function record() {
    if (micState !== '켜짐' || !ctx) return;
    chunks = [];
    capturing = true;
    recState = '녹음 중';
    const rate = ctx.sampleRate;
    setTimeout(() => {
      capturing = false;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      let peak = 0;
      for (let i = 0; i < all.length; i++) peak = Math.max(peak, Math.abs(all[i]));
      // 가운데 0.5초를 측정한다
      const half = Math.min(Math.floor(rate / 4), Math.floor(all.length / 2));
      const mid = Math.floor(all.length / 2);
      const p = detectPitch(all.subarray(mid - half, mid + half), rate);
      const seconds = (total / rate).toFixed(2);
      recResult =
        p.f0 === null
          ? `길이 ${seconds}초, 최대 음량 ${peak.toFixed(3)}, 음높이를 찾지 못함`
          : `길이 ${seconds}초, 최대 음량 ${peak.toFixed(3)}, 측정 ${p.f0.toFixed(2)}Hz ` +
            `(440Hz와의 차이 ${signed(cents(440, p.f0))}센트), 뚜렷함 ${p.clarity.toFixed(2)}`;
      if (recUrl) URL.revokeObjectURL(recUrl);
      recBlob = new Blob([encodeWav(all, rate)], { type: 'audio/wav' });
      recUrl = URL.createObjectURL(recBlob);
      recState = '끝남';
    }, 3000);
  }

  const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

  async function toggleTone() {
    const audio = ensureContext();
    await audio.resume();
    if (osc) {
      osc.stop();
      osc = null;
      tonePlaying = false;
      return;
    }
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, audio.currentTime + 0.05);
    osc = audio.createOscillator();
    osc.frequency.value = 440;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    tonePlaying = true;
    describeAudio();
  }

  /** 앱의 소리 엔진(컴프레서와 제한기를 거침)으로 도·미·솔을 차례로 낸 뒤 함께 낸다 */
  async function playEngine() {
    await engine.wake();
    const h = TIMBRE_PRESETS.날카로운;
    const notes = [261.63, 329.63, 392.0];
    notes.forEach((f, i) => setTimeout(() => engine.play(h, f, 0.45), i * 450));
    setTimeout(() => notes.forEach((f) => engine.play(h, f, 1.2, 1)), 1500);
    enginePlayed = '엔진 소리를 냄';
  }

  /** 지나치게 큰 소리 여덟 개를 한꺼번에 넣고, 출력 경로를 지난 뒤의 최댓값을 잰다(소리는 나지 않는다) */
  async function testCeiling() {
    const rate = 44100;
    const off = new OfflineAudioContext(1, rate * 2, rate);
    const out = buildOutput(off);
    const h = TIMBRE_PRESETS.날카로운;
    for (const f of [65.41, 130.81, 196, 261.63, 329.63, 392, 523.25, 659.25]) {
      scheduleNote(off, out, waveFor(off, h, f), { freq: f, start: 0.05, duration: 1.8, gain: 1 });
    }
    const data = (await off.startRendering()).getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    ceiling = `최댓값 ${peak.toFixed(3)} (한계 ${CEILING}) ${peak <= CEILING + 1e-6 && peak > 0.05 ? '통과' : '실패'}`;
  }

  // ── 저장 ──
  function db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('mc2-check', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async function readMarker() {
    try {
      const d = await db();
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const r = d.transaction('kv').objectStore('kv').get('marker');
        r.onsuccess = () => resolve(r.result as string | undefined);
        r.onerror = () => reject(r.error);
      });
      marker = value ? `남아 있음: ${value}` : '없음 (처음이거나 지워짐)';
    } catch (e) {
      marker = `저장소를 열 수 없음: ${(e as Error).message}`;
    }
  }

  async function writeMarker() {
    const d = await db();
    const stamp = new Date().toLocaleString('ko-KR');
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(stamp, 'marker');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    marker = `방금 남김: ${stamp}`;
    if (navigator.storage?.persist) persisted = (await navigator.storage.persist()) ? '보호됨' : '보호되지 않음';
  }

  // ── 파일 ──
  function save(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    if (!downloads.includes(name)) downloads = [...downloads, name];
  }

  function saveWav() {
    const rate = 44100;
    const tone = new Float32Array(rate * 2);
    for (let i = 0; i < tone.length; i++) {
      const t = i / rate;
      const fade = Math.min(1, t * 20, (2 - t) * 20);
      tone[i] = 0.4 * fade * (Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t));
    }
    save('점검_소리.wav', new Blob([encodeWav(tone, rate)], { type: 'audio/wav' }));
  }

  function saveHtml() {
    const page = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>점검용 앨범</title><body style="font:18px sans-serif;padding:24px">
<h1>점검용 앨범</h1><p>이 글이 보이면 파일이 열린 것입니다.</p>
<button id="b" style="font:inherit;padding:12px 20px">소리 듣기</button><p id="o">아직 누르지 않음</p>
<script type="application/json" id="data">{"check":true,"made":"${new Date().toISOString()}"}<\/script>
<script>document.getElementById('b').onclick=function(){var c=new AudioContext(),o=c.createOscillator(),g=c.createGain();g.gain.value=.2;o.frequency.value=440;o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+1);document.getElementById('o').textContent='스크립트가 동작합니다';};<\/script></body></html>`;
    save('점검_앨범.html', new Blob([page], { type: 'text/html' }));
  }

  function saveJson() {
    save('점검_백업.json', new Blob([JSON.stringify({ check: true, made: new Date().toISOString() })], { type: 'application/json' }));
  }

  function saveCsv() {
    save('점검_측정값.csv', new Blob(['﻿칸,주파수(Hz)\n0,261.63\n1,277.18\n'], { type: 'text/csv' }));
  }

  async function openFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const ok = text.includes('"check":true');
    opened = `${file.name} (${file.size}바이트): ${ok ? '내용을 읽었습니다' : '열렸지만 점검용 파일이 아닙니다'}`;
  }

  // ── 결과 ──
  const report = $derived(
    [
      `[소리의 수학 기기 점검] 빌드 ${BUILD}`,
      ...Object.entries(env).map(([k, v]) => `${k}: ${v}`),
      `인터넷 연결: ${online ? '연결됨' : '끊김'}`,
      `오프라인 준비: ${offline}`,
      `마이크: ${micState}${micError ? ` (${micError})` : ''}`,
      ...Object.entries(settings).map(([k, v]) => `${k}: ${v}`),
      `마이크 목록(★은 지금 쓰는 것): ${devices.map((d) => `${d.id === currentDevice ? '★' : ''}${d.label} [id ${d.id.slice(0, 8)}, 묶음 ${d.group.slice(0, 6)}]`).join(' / ') || '없음'}`,
      `소리 장치: ${audioInfo || '아직 소리를 켜지 않음'}${enginePlayed ? `, ${enginePlayed}` : ''}`,
      `출력 한계: ${ceiling || '확인하지 않음'}`,
      `3초 녹음: ${recResult || '하지 않음'}`,
      `저장 표식: ${marker}`,
      `저장소 보호: ${persisted}${quota ? `, ${quota}` : ''}`,
      `내려받은 파일: ${downloads.join(', ') || '없음'}`,
      `불러온 파일: ${opened || '없음'}`,
    ].join('\n'),
  );

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      copied = '복사했습니다. 붙여 넣어 보내 주세요.';
    } catch {
      copied = '자동 복사가 안 됩니다. 아래 글을 길게 눌러 직접 복사하세요.';
    }
  }

  onMount(() => {
    offlineState.start();
    void readMarker();
    void navigator.storage?.persisted?.().then((p) => (persisted = p ? '보호됨' : '보호되지 않음'));
    void navigator.storage?.estimate?.().then((e) => {
      if (e.quota) quota = `쓸 수 있는 공간 약 ${Math.round(e.quota / 1e6)}MB`;
    });
    return () => {
      stopMic();
      if (osc) osc.stop();
      engine.stop();
    };
  });
</script>

<main>
  <header>
    <h1>기기 점검</h1>
    <p>
      Math-Composer 2를 만들기 전에 이 태블릿에서 되는 것과 안 되는 것을 확인합니다. 위에서부터 차례로 해 보고 맨
      아래의 결과를 복사해 보내 주세요. 녹음한 소리는 이 기기 밖으로 나가지 않습니다.
    </p>
  </header>

  <section>
    <h2>1. 기기와 브라우저</h2>
    <dl>
      {#each Object.entries(env) as [k, v]}
        <dt>{k}</dt>
        <dd>{v}</dd>
      {/each}
    </dl>
  </section>

  <section>
    <h2>2. 오프라인</h2>
    <dl>
      <dt>오프라인 준비</dt>
      <dd data-testid="offline">{offline}</dd>
      <dt>인터넷 연결</dt>
      <dd>{online ? '연결됨' : '끊김'}</dd>
    </dl>
    <p class="todo">
      “준비 완료”가 보이면 비행기 모드를 켜고 이 페이지를 닫았다가 다시 여세요. 열리면 통과입니다. 열린 뒤 이 칸의
      인터넷 연결이 “끊김”으로 보여야 합니다.
    </p>
  </section>

  <section>
    <h2>3. 마이크</h2>
    <div class="row">
      <button onclick={startMic}>{micState === '켜짐' ? '마이크 다시 켜기' : '마이크 켜기'}</button>
      {#if micState === '켜짐'}<button class="quiet" onclick={stopMic}>마이크 끄기</button>{/if}
      <span class="status" data-testid="mic">{micState}</span>
    </div>
    {#if micError}<p class="error">{micError}</p>{/if}

    {#if micState === '켜짐'}
      <dl>
        {#each Object.entries(settings) as [k, v]}
          <dt>{k}</dt>
          <dd>{v}</dd>
        {/each}
      </dl>
      {#if devices.length > 1}
        <label>
          다른 마이크로 바꾸기
          <select bind:value={chosenDevice} onchange={startMic}>
            <option value="">자동</option>
            {#each devices as d}<option value={d.id}>{d.label}</option>{/each}
          </select>
        </label>
      {/if}
      <div class="meter" aria-label="입력 음량"><div style:width="{Math.min(100, level * 400)}%"></div></div>
      <p class="reading" data-testid="live">
        {#if liveHz}
          {liveHz.toFixed(1)}Hz <small>440Hz와 {signed(cents(440, liveHz))}센트, 뚜렷함 {liveClarity.toFixed(2)}</small>
        {:else}
          소리를 기다리는 중
        {/if}
      </p>
      <p class="todo">
        세 가지 보정(반향 제거, 잡음 억제, 자동 음량 조절)이 모두 “꺼짐”이어야 합니다. 다른 기기에서 440Hz 소리를
        틀거나 아래 4번의 440Hz를 켠 채로 숫자가 440 근처에 머무는지 보세요. 이어폰을 쓰는 중이면 소리가 이어폰으로만 나가
        마이크에 들어오지 않으니, 다른 기기에서 440Hz를 틀거나 이어폰을 잠시 빼세요. 블루투스 이어폰을 연결한 상태로도 한 번
        더 해 보고, “쓰고 있는 마이크”가 이어폰으로 바뀌는지 확인해 주세요.
      </p>
      <div class="row">
        <button onclick={record} disabled={recState === '녹음 중'}>
          {recState === '녹음 중' ? '녹음 중…' : '3초 녹음하기'}
        </button>
        {#if recState === '끝남' && recBlob}
          <button class="quiet" onclick={() => save('점검_녹음.wav', recBlob!)}>녹음 저장</button>
        {/if}
      </div>
      {#if recResult}
        <p class="reading small" data-testid="rec">{recResult}</p>
        <audio controls src={recUrl}></audio>
      {/if}
    {/if}
  </section>

  <section>
    <h2>4. 소리 내기</h2>
    <div class="row">
      <button onclick={toggleTone}>{tonePlaying ? '440Hz 끄기' : '440Hz 켜기'}</button>
      <button class="quiet" onclick={playEngine}>도·미·솔 듣기</button>
      <button class="quiet" onclick={testCeiling}>출력 한계 확인</button>
      <span class="status">{audioInfo}</span>
    </div>
    {#if ceiling}<p class="reading small" data-testid="ceiling">{ceiling}</p>{/if}
    <p class="todo">
      “도·미·솔 듣기”는 앱이 실제로 쓰는 소리 경로입니다. 세 음이 차례로 난 뒤 함께 울립니다. 함께 울릴 때 소리가 찢어지거나
      갑자기 커지지 않는지 들어 주세요. 버튼을 누른 순간과 소리가 나는 순간 사이가 느껴질 만큼 벌어지는지 보세요. 본체 스피커, 유선 이어폰, 블루투스
      이어폰에서 각각 어떤지 알려 주세요.
    </p>
  </section>

  <section>
    <h2>5. 저장</h2>
    <dl>
      <dt>저장 표식</dt>
      <dd data-testid="marker">{marker}</dd>
      <dt>저장소 보호</dt>
      <dd>{persisted}{quota ? `, ${quota}` : ''}</dd>
    </dl>
    <div class="row"><button onclick={writeMarker}>표식 남기기</button></div>
    <p class="todo">
      표식을 남긴 뒤 태블릿을 껐다 켜고 이 페이지를 다시 여세요. “남아 있음”과 남긴 시각이 보이면 통과입니다. 학교에서
      태블릿을 걷어 갔다가 다음 날 받은 뒤에도 한 번 더 확인하면 좋습니다.
    </p>
  </section>

  <section>
    <h2>6. 파일 내보내기와 불러오기</h2>
    <div class="row">
      <button onclick={saveWav}>소리 파일</button>
      <button onclick={saveHtml}>앨범 HTML</button>
      <button onclick={saveJson}>백업 파일</button>
      <button onclick={saveCsv}>측정값 CSV</button>
      <button onclick={() => window.print()}>인쇄·PDF</button>
    </div>
    <label>
      내려받은 앨범 HTML이나 백업 파일 불러오기
      <input type="file" accept=".html,.json,text/html,application/json" onchange={openFile} />
    </label>
    {#if opened}<p class="reading small">{opened}</p>{/if}
    <p class="todo">
      파일 다섯 가지를 내려받아 구글 클래스룸, 패들렛, 메일에 각각 올려 보세요. 올라가는지, 올린 자리에서 바로 열리거나
      재생되는지 알려 주세요. 내려받은 앨범 HTML을 태블릿에서 열어 “소리 듣기”가 되는지도 봐 주세요.
    </p>
  </section>

  <section>
    <h2>결과 보내기</h2>
    <div class="row">
      <button onclick={copyReport}>결과 복사하기</button>
      <span class="status">{copied}</span>
    </div>
    <pre>{report}</pre>
    <p class="todo">위 글과 함께, 직접 보고 들은 것(지연, 클래스룸·패들렛·메일에서의 동작)을 적어 보내 주세요.</p>
  </section>
</main>

<style>
  main {
    color: #17212b;
    font: 17px/1.6 system-ui, 'Noto Sans KR', sans-serif;
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
  }
  h1 {
    font-size: 1.9rem;
    margin: 0 0 0.5rem;
  }
  h2 {
    font-size: 1.2rem;
    margin: 0 0 0.75rem;
  }
  section {
    border-top: 2px solid #17212b;
    padding: 1.25rem 0 0.5rem;
    margin-top: 1.5rem;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(8rem, max-content) 1fr;
    gap: 0.25rem 1rem;
    margin: 0 0 1rem;
  }
  dt {
    color: #51606e;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 0.75rem 0;
  }
  button {
    min-height: 48px;
    padding: 0 1.25rem;
    border: 2px solid #17212b;
    border-radius: 6px;
    background: #17212b;
    color: #fff;
    font: inherit;
    font-weight: 600;
  }
  button.quiet {
    background: #fff;
    color: #17212b;
  }
  button:disabled {
    opacity: 0.5;
  }
  button:focus-visible,
  select:focus-visible,
  input:focus-visible {
    outline: 3px solid #c77700;
    outline-offset: 2px;
  }
  label {
    display: grid;
    gap: 0.35rem;
    margin: 0.75rem 0;
  }
  select,
  input[type='file'] {
    min-height: 48px;
    font: inherit;
  }
  .status {
    color: #51606e;
  }
  .error {
    border-left: 4px solid #b3261e;
    padding-left: 0.75rem;
    color: #8c1d18;
  }
  .todo {
    background: #f1f4f7;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin: 0.75rem 0;
  }
  .meter {
    height: 14px;
    background: #e2e7ec;
    border-radius: 7px;
    overflow: hidden;
  }
  .meter div {
    height: 100%;
    background: #17212b;
  }
  .reading {
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin: 0.5rem 0;
  }
  .reading small,
  .reading.small {
    font-size: 1rem;
    font-weight: 400;
  }
  audio {
    width: 100%;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: #f1f4f7;
    padding: 1rem;
    border-radius: 6px;
    font: 0.85rem/1.5 ui-monospace, monospace;
    user-select: all;
  }
  @media print {
    .row,
    .todo,
    label,
    audio {
      display: none;
    }
  }
</style>
