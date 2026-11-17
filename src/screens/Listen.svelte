<script lang="ts">
  import { onDestroy } from 'svelte';
  import { engine } from '../audio/engine';
  import { decodeFile, MAX_SECONDS, MicError, Recorder, type MicInfo } from '../audio/recorder';
  import { decodeWav } from '../audio/wav';
  import { SAMPLES, sampleUrl } from '../content/samples';
  import { hrefFor } from '../lib/route.svelte';
  import { view } from '../lib/view.svelte';
  import { describePitch } from '../music/notes';
  import { MAX_SOUNDS, clean, type Sound } from '../store/project';
  import { session } from '../store/session.svelte';
  import { addSound, pcmOf, removeSound } from '../store/sounds.svelte';
  import { envelopePath, peakOf } from '../ui/paths';

  const project = $derived(session.project!);
  const full = $derived(project.sounds.length >= MAX_SOUNDS);

  let panel = $state<'none' | 'recording' | 'samples'>('none');
  let message = $state('');
  let busy = $state(false);
  let asking = $state<string | null>(null);
  let playing = $state<string | null>(null);

  // ── 녹음 ──
  const recorder = new Recorder();
  let seconds = $state(0);
  let level = $state(0);
  let loudest = $state(0);
  let mic = $state<MicInfo | null>(null);
  let denied = $state(false);

  const micOn = $derived(
    mic ? ([['반향 제거', mic.echoCancellation], ['잡음 억제', mic.noiseSuppression], ['자동 음량 조절', mic.autoGainControl]] as const).filter(([, v]) => v === true).map(([k]) => k) : [],
  );

  async function record() {
    message = '';
    denied = false;
    engine.stop(); // 녹음하는 동안 앱의 소리를 끈다
    playing = null;
    seconds = 0;
    level = 0;
    loudest = 0;
    mic = null;
    busy = true;
    try {
      await engine.wake();
      const done = recorder.start(
        engine.context,
        (peak, s) => {
          level = Math.max(peak, level * 0.8);
          loudest = Math.max(loudest, peak);
          seconds = s;
        },
        (info) => {
          mic = info;
          panel = 'recording';
          busy = false;
        },
      );
      const rec = await done;
      panel = 'none';
      if (rec.pcm.length < rec.sampleRate * 0.3) {
        message = '녹음이 너무 짧습니다. 1초 넘게 소리를 낸 뒤 끝내세요.';
        return;
      }
      if (peakOf(rec.pcm) < 0.01) {
        message = '소리가 거의 들어오지 않았습니다. 태블릿 아래쪽 마이크 구멍 가까이에서 다시 녹음하세요.';
        return;
      }
      await keep(`녹음 ${project.sounds.filter((s) => s.source === 'mic').length + 1}`, 'mic', rec.pcm, rec.sampleRate);
    } catch (e) {
      panel = 'none';
      if (e instanceof MicError && e.kind === 'denied') denied = true;
      else message = e instanceof MicError ? `${e.message} 예시음이나 파일로 이어서 할 수 있습니다.` : '녹음하지 못했습니다. 예시음이나 파일로 이어서 할 수 있습니다.';
    } finally {
      busy = false;
    }
  }

  async function keep(label: string, source: Sound['source'], pcm: Float32Array, rate: number) {
    const s = await addSound(label, source, pcm, rate);
    if (!s) message = `소리는 ${MAX_SOUNDS}개까지 담을 수 있습니다. 쓰지 않는 소리를 지운 뒤 다시 하세요.`;
    else if (s.f0 === null) message = `“${s.label}”을(를) 담았지만 음높이를 찾지 못했습니다. 한 음을 길게 낸 소리로 다시 해 보세요.`;
  }

  // ── 예시음 ──
  async function loadSample(id: string) {
    const res = await fetch(sampleUrl(id));
    if (!res.ok) throw new Error('missing');
    return decodeWav(await res.arrayBuffer());
  }

  async function hearSample(id: string) {
    if (playing === id) return stop();
    try {
      await engine.wake();
      const { samples, sampleRate } = await loadSample(id);
      playing = id;
      engine.playBuffer(samples, sampleRate, 0, samples.length, () => playing === id && (playing = null));
    } catch {
      message = '예시음을 불러오지 못했습니다. 인터넷에 연결해 앱을 한 번 다시 열어 주세요.';
    }
  }

  async function takeSample(id: string, label: string) {
    message = '';
    busy = true;
    try {
      const { samples, sampleRate } = await loadSample(id);
      await keep(label, 'sample', samples, sampleRate);
    } catch {
      message = '예시음을 불러오지 못했습니다. 인터넷에 연결해 앱을 한 번 다시 열어 주세요.';
    } finally {
      busy = false;
    }
  }

  // ── 파일 ──
  async function upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = '';
    busy = true;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('big');
      const rec = await decodeFile(engine.context, await file.arrayBuffer());
      await keep(clean(file.name.replace(/\.[^.]+$/, ''), 30) || '올린 소리', 'file', rec.pcm, rec.sampleRate);
      if (rec.cut) message = `파일이 ${MAX_SECONDS}초보다 길어서 앞 ${MAX_SECONDS}초만 담았습니다.`;
    } catch {
      message = '이 파일은 소리로 읽을 수 없습니다. wav, mp3, m4a 파일을 골라 주세요.';
    } finally {
      busy = false;
    }
  }

  // ── 목록 ──
  async function hear(s: Sound) {
    if (playing === s.id) return stop();
    const pcm = await pcmOf(project.id, s.id);
    if (!pcm) {
      message = `“${s.label}”의 소리가 이 태블릿에 없습니다. 지우고 다시 담아 주세요.`;
      return;
    }
    await engine.wake();
    playing = s.id;
    engine.playBuffer(pcm, s.sampleRate, 0, pcm.length, () => playing === s.id && (playing = null));
  }

  function stop() {
    engine.stop();
    playing = null;
  }

  function rename(s: Sound, value: string) {
    session.change((p) => {
      const t = p.sounds.find((x) => x.id === s.id);
      if (t) t.label = clean(value, 30) || t.label;
    });
  }

  const thumbs = $state<Record<string, string>>({});
  $effect(() => {
    for (const s of project.sounds) {
      if (thumbs[s.id]) continue;
      void pcmOf(project.id, s.id).then((pcm) => {
        if (pcm) thumbs[s.id] = envelopePath(pcm, 150, 24, 21, 1 / Math.max(0.05, peakOf(pcm)));
      });
    }
  });

  onDestroy(() => {
    recorder.stop();
    engine.stop();
  });
</script>

<article>
  <header>
    <h2>녹음실</h2>
    <p class="sub">악기나 목소리로 한 음을 길게 내어 담습니다. 지금 {project.sounds.length}개, {MAX_SOUNDS}개까지 담을 수 있습니다.</p>
  </header>

  {#if panel === 'recording'}
    <section class="rec" aria-label="녹음 중">
      <p class="time" data-testid="rec-time">{seconds.toFixed(1)}<small>초, {MAX_SECONDS}초가 되면 저절로 끝납니다</small></p>
      <div class="meter" role="img" aria-label="들어오는 소리의 크기">
        <div style:width="{Math.min(100, level * 100)}%"></div>
      </div>
      <p class="hint">
        {#if loudest > 0.97}소리가 너무 큽니다. 조금 떨어져서 다시 녹음하세요.
        {:else if seconds > 1 && loudest < 0.03}소리가 너무 작습니다. 마이크 가까이에서 내세요.
        {:else}막대가 절반쯤 차도록 소리를 내세요.{/if}
      </p>
      {#if mic}
        <p class="hint" data-testid="mic-info">
          쓰는 마이크: {mic.label}.
          {#if micOn.length === 0}소리를 바꾸는 보정은 모두 꺼졌습니다.{:else}이 태블릿은 {micOn.join(', ')}을(를) 끌 수 없습니다. 측정값이 조금 달라질 수 있습니다.{/if}
          {#if mic.switched}이어폰의 마이크 대신 태블릿의 마이크로 녹음합니다.{/if}
        </p>
      {/if}
      <button class="btn ink" onclick={() => recorder.stop()}>녹음 끝내기</button>
    </section>
  {:else}
    <div class="sources">
      <button class="btn ink" onclick={record} disabled={busy || full}>녹음하기</button>
      <button class="btn" onclick={() => (panel = panel === 'samples' ? 'none' : 'samples')} aria-expanded={panel === 'samples'} disabled={full}>
        예시음 고르기
      </button>
      <label class="btn file" class:off={busy || full}>
        파일 올리기
        <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg" onchange={upload} disabled={busy || full} data-testid="upload" />
      </label>
    </div>
  {/if}

  {#if denied}
    <div class="notice" role="alert">
      <p>마이크 사용이 허용되지 않았습니다.</p>
      <p class="plain">주소 표시줄 왼쪽의 자물쇠를 눌러 마이크를 “허용”으로 바꾼 뒤 다시 녹음하세요. 바꿀 수 없으면 예시음이나 파일로 이어서 할 수 있습니다.</p>
    </div>
  {/if}
  {#if message}<p class="notice" role="status" data-testid="message">{message}</p>{/if}

  {#if panel === 'samples'}
    <section aria-labelledby="samples">
      <h3 id="samples">예시음</h3>
      <ul class="rows" data-testid="samples">
        {#each SAMPLES as s (s.id)}
          <li>
            <div class="what"><b>{s.label}</b><span>{s.about}</span></div>
            <button class="btn" onclick={() => hearSample(s.id)}>{playing === s.id ? '멈추기' : '듣기'}</button>
            <button class="btn" onclick={() => takeSample(s.id, s.label)} disabled={busy || full} aria-label="{s.label} 담기">담기</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="mine">
    <h3 id="mine">내 소리</h3>
    {#if project.sounds.length === 0}
      <p class="hint">아직 담은 소리가 없습니다. 녹음하거나 예시음을 담으면 여기에 쌓입니다.</p>
    {:else}
      <ul class="rows mine" data-testid="sounds">
        {#each project.sounds as s (s.id)}
          <li>
            {#if asking === s.id}
              <p class="ask">“{s.label}”을(를) 지우면 되돌릴 수 없습니다.</p>
              <button class="btn ink" onclick={() => removeSound(s.id).then(() => (asking = null))}>지우기</button>
              <button class="btn" onclick={() => (asking = null)}>그만두기</button>
            {:else}
              <svg viewBox="0 0 150 48" aria-hidden="true">
                <line x1="0" y1="24" x2="150" y2="24" stroke="var(--staff)" stroke-width="1" />
                {#if thumbs[s.id]}<path d={thumbs[s.id]} fill="var(--ink)" />{/if}
              </svg>
              <div class="what">
                <label class="field name">
                  <span class="sr">소리 이름</span>
                  <input value={s.label} maxlength="30" onchange={(e) => rename(s, e.currentTarget.value)} />
                </label>
                <span data-testid="sound-f0">
                  {#if s.f0}{s.f0.toFixed(1)} Hz, {describePitch(s.f0)}{:else}음높이를 찾지 못함{/if}
                </span>
              </div>
              <button class="btn" onclick={() => hear(s)}>{playing === s.id ? '멈추기' : '듣기'}</button>
              <a class="btn" href={hrefFor({ screen: 'project', id: project.id, stage: 'see' })} onclick={() => (view.soundId = s.id)}>분석하기</a>
              <button class="btn" onclick={() => (asking = s.id)} aria-label="{s.label} 지우기">지우기</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</article>

<style>
  article {
    max-width: 780px;
    display: grid;
    gap: 22px;
  }
  h2 {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.015em;
    line-height: 1.1;
  }
  h3 {
    font-size: 24px;
    font-weight: 800;
    margin-bottom: 8px;
  }
  .sub {
    margin-top: 6px;
    color: var(--ink-soft);
  }
  .hint {
    font-size: 15px;
    color: var(--ink-soft);
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .file {
    position: relative;
  }
  .file input {
    position: absolute;
    inset: -2px;
    opacity: 0;
    cursor: pointer;
  }
  .file.off {
    opacity: 0.45;
  }
  .file:focus-within {
    outline: 3px solid var(--ink);
    outline-offset: 3px;
  }

  .rec {
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .time {
    font-size: 74px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .time small {
    font-size: 17px;
    font-weight: 400;
    letter-spacing: 0;
    margin-left: 10px;
    color: var(--ink-soft);
  }
  /* 음량 막대: 줄 하나 위를 먹이 채운다 */
  .meter {
    width: 100%;
    height: 22px;
    border-bottom: 2px solid var(--ink);
    background: linear-gradient(var(--staff), var(--staff)) left 50% / 100% 1px no-repeat;
  }
  .meter div {
    height: 100%;
    background: var(--ink);
  }

  .notice .plain {
    font-weight: 400;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--ink);
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 68px;
    padding: 8px 0;
    border-bottom: 1px solid var(--rule);
  }
  .rows .btn {
    min-height: var(--tap);
    padding: 0 16px;
    flex: none;
  }
  .rows svg {
    width: 150px;
    height: 48px;
    flex: none;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .what b {
    font-size: 20px;
  }
  .what span {
    font-size: 15px;
    color: var(--ink-soft);
  }
  .name input {
    min-height: var(--tap);
    border-bottom-width: 1px;
    border-color: var(--rule);
    padding: 2px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .ask {
    flex: 1;
    font-weight: 700;
  }

  @media (max-width: 640px) {
    .rows.mine li {
      flex-wrap: wrap;
    }
    .rows svg {
      display: none;
    }
    .what {
      flex-basis: 100%;
    }
  }
</style>
