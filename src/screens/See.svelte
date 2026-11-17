<script lang="ts">
  import { onDestroy } from 'svelte';
  import { engine } from '../audio/engine';
  import { confidenceLevel, measure, usableAsTimbre, type Measured, type Selection } from '../dsp/analyze';
  import { component } from '../dsp/spectrum';
  import { hrefFor } from '../lib/route.svelte';
  import { view } from '../lib/view.svelte';
  import { describePitch, nearestNote } from '../music/notes';
  import { session } from '../store/session.svelte';
  import { clampSelection, pcmOf, reselect } from '../store/sounds.svelte';
  import Formula from '../ui/Formula.svelte';
  import { envelopePath, linePath, peakOf } from '../ui/paths';

  const project = $derived(session.project!);
  const sound = $derived(project.sounds.find((s) => s.id === view.soundId) ?? project.sounds[0] ?? null);

  let pcm = $state.raw<Float32Array | null>(null);
  let m = $state.raw<Measured | null>(null);
  let sel = $state<Selection>({ start: 0, end: 0 });
  let lost = $state(false);
  let playing = $state<'all' | 'part' | 'timbre' | null>(null);

  // 소리가 바뀌면 녹음을 불러와 잰다
  $effect(() => {
    const s = sound;
    const pid = project.id;
    if (!s) return;
    const id = s.id;
    pcm = null;
    m = null;
    lost = false;
    void pcmOf(pid, id).then((data) => {
      if (sound?.id !== id) return;
      if (!data) {
        lost = true;
        return;
      }
      pcm = data;
      sel = { ...s.selection };
      m = measure(data, s.sampleRate, s.selection);
    });
  });

  // ── 파형과 구간 ──
  const H = 210;
  const MID = 105;
  let w = $state(600);
  /** 본문 전체 폭(사인 맞추기와 스펙트럼 그림) */
  let fw = $state(700);
  const shape = $derived(pcm ? envelopePath(pcm, w, MID, 72, 1 / Math.max(0.05, peakOf(pcm))) : '');
  const xs = $derived(pcm ? (sel.start / pcm.length) * w : 0);
  const xe = $derived(pcm ? (sel.end / pcm.length) * w : 0);

  let drag: { mode: 'start' | 'end' | 'move'; grab: number } | null = null;
  let box: HTMLDivElement | undefined = $state();

  function at(e: PointerEvent): number {
    const r = box!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * pcm!.length;
  }

  function down(e: PointerEvent) {
    if (!pcm || !sound) return;
    const r = box!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const pos = at(e);
    if (Math.abs(x - xs) <= 26 && x < (xs + xe) / 2) drag = { mode: 'start', grab: 0 };
    else if (Math.abs(x - xe) <= 26) drag = { mode: 'end', grab: 0 };
    else {
      // 구간 밖을 누르면 그곳으로 구간을 옮긴다
      if (pos < sel.start || pos > sel.end) move(pos - (sel.end - sel.start) / 2);
      drag = { mode: 'move', grab: pos - sel.start };
    }
    box!.setPointerCapture(e.pointerId);
  }

  function move(start: number) {
    const len = sel.end - sel.start;
    const s = Math.max(0, Math.min(start, pcm!.length - len));
    sel = { start: Math.round(s), end: Math.round(s + len) };
  }

  function drift(e: PointerEvent) {
    if (!drag || !pcm || !sound) return;
    const pos = at(e);
    if (drag.mode === 'move') move(pos - drag.grab);
    else if (drag.mode === 'start') sel = clampSelection({ start: Math.min(pos, sel.end - 1), end: sel.end }, pcm.length, sound.sampleRate);
    else {
      const c = clampSelection({ start: sel.start, end: Math.max(pos, sel.start + 1) }, pcm.length, sound.sampleRate);
      sel = { start: sel.start, end: c.end };
    }
  }

  async function up() {
    if (!drag || !sound) return;
    drag = null;
    await commit();
  }

  async function commit() {
    if (!sound) return;
    const res = await reselect(sound.id, sel);
    if (res) {
      m = res;
      sel = { ...session.project!.sounds.find((s) => s.id === sound.id)!.selection };
    }
  }

  function nudge(e: KeyboardEvent) {
    if (!pcm || !sound || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    move(sel.start + (e.key === 'ArrowLeft' ? -1 : 1) * sound.sampleRate * 0.05);
    void commit();
  }

  const seconds = (n: number) => (sound ? (n / sound.sampleRate).toFixed(2) : '0');

  // ── 배음 ──
  const stems = $derived.by(() => {
    if (!m || !m.f0) return [];
    const top = Math.max(1, ...m.harmonics);
    return m.harmonics.map((a, k) => ({ k: k + 1, x: 22 + (k * (w - 44)) / 15, y: 150 - (a / top) * 128, a }));
  });

  // ── 다른 소리와 견주기 ──
  const others = $derived(sound && sound.f0 ? project.sounds.filter((s) => s.id !== sound.id && s.f0).map((s) => ({ s, ratio: s.f0! / sound.f0! })) : []);

  // ── 사인 맞추기 ──
  const f0 = $derived(m?.f0 ?? null);
  const seg = $derived.by(() => {
    if (!pcm || !sound || !f0) return null;
    const n = Math.min(sel.end - sel.start, Math.round((4 * sound.sampleRate) / f0));
    const part = pcm.slice(sel.start, sel.start + n);
    const peak = Math.max(1e-6, peakOf(part));
    for (let i = 0; i < part.length; i++) part[i] /= peak;
    return part;
  });
  const parts = $derived.by(() => {
    if (!seg || !sound || !f0) return [];
    return Array.from({ length: 8 }, (_, k) => component(seg, sound.sampleRate, f0 * (k + 1)));
  });

  let A = $state(0.5);
  let f = $state(100);
  let phi = $state(0);
  let added = $state(1);

  // 소리를 처음 열면 일부러 어긋난 값에서 시작한다. 전에 맞춘 값이 있으면 그것을 쓴다
  let fitFor = '';
  $effect(() => {
    if (!sound || !f0 || fitFor === sound.id) return;
    fitFor = sound.id;
    added = 1;
    const saved = project.fit;
    if (saved && saved.f > f0 * 0.5 && saved.f < f0 * 2) {
      A = saved.A;
      f = saved.f;
      phi = saved.phi;
    } else {
      A = 0.5;
      f = Math.round(f0 * 0.85);
      phi = 0;
    }
  });

  function keepFit() {
    session.change((p) => (p.fit = { A, f, phi }));
  }

  const model = $derived.by(() => {
    if (!seg || !sound || parts.length === 0) return null;
    const out = new Float32Array(seg.length);
    const base = parts[0];
    for (let i = 0; i < out.length; i++) {
      const t = i / sound.sampleRate;
      const th = 2 * Math.PI * f * t + phi;
      let v = A * Math.sin(th);
      for (let k = 2; k <= added; k++) {
        const c = parts[k - 1];
        if (base.amp > 0) v += A * (c.amp / base.amp) * Math.sin(k * th + (c.phase - k * base.phase));
      }
      out[i] = v;
    }
    return out;
  });
  const overlap = $derived.by(() => {
    if (!seg || !model) return 0;
    let err = 0;
    let pow = 0;
    for (let i = 0; i < seg.length; i++) {
      err += (seg[i] - model[i]) ** 2;
      pow += seg[i] ** 2;
    }
    return Math.max(0, Math.round((1 - Math.sqrt(err / Math.max(pow, 1e-9))) * 100));
  });
  const fitTex = $derived(`y = ${A.toFixed(2)}\\sin(2\\pi \\times ${f.toFixed(1)}\\, t + ${phi.toFixed(2)})`);

  // ── 스펙트럼 ──
  let range = $state(2000);
  const ranges = $derived(sound ? [2000, 5000, Math.round(sound.sampleRate / 2)] : [2000]);
  const specPath = $derived.by(() => {
    if (!m) return '';
    const { mag, binHz } = m.spectrum;
    const last = Math.min(mag.length - 1, Math.floor(range / binHz));
    let top = 1e-9;
    for (let i = 1; i <= last; i++) top = Math.max(top, mag[i]);
    const cols = Math.max(1, Math.floor(fw / 1.5));
    const pts: string[] = [];
    for (let c = 0; c < cols; c++) {
      const from = Math.max(1, Math.floor((c / cols) * last));
      const to = Math.max(from + 1, Math.floor(((c + 1) / cols) * last));
      let v = 0;
      for (let i = from; i < to && i <= last; i++) v = Math.max(v, mag[i]);
      const db = Math.max(-60, 20 * Math.log10(v / top + 1e-9));
      pts.push(`${((c / cols) * fw).toFixed(1)} ${(8 + (-db / 60) * 132).toFixed(1)}`);
    }
    return `M${pts.join('L')}`;
  });
  const ticks = $derived.by(() => {
    const step = range <= 2000 ? 500 : range <= 5000 ? 1000 : 5000;
    return Array.from({ length: Math.floor(range / step) + 1 }, (_, i) => i * step);
  });

  // ── 소리 ──
  async function hear(which: 'all' | 'part') {
    if (!pcm || !sound) return;
    if (playing === which) return stop();
    await engine.wake();
    playing = which;
    const [a, b] = which === 'all' ? [0, pcm.length] : [sel.start, sel.end];
    engine.playBuffer(pcm, sound.sampleRate, a, b, () => playing === which && (playing = null));
  }
  function stop() {
    engine.stop();
    playing = null;
  }

  const isTimbre = $derived(sound !== null && project.timbre.from === sound.id);
  async function useTimbre() {
    if (!sound || !m) return;
    const h = m.harmonics.map((a) => Math.min(100, a));
    session.change((p) => (p.timbre = { harmonics: h, from: sound.id }));
    await engine.wake();
    engine.play(h, 261.63, 0.8);
  }

  onDestroy(() => engine.stop());
</script>

<article bind:clientWidth={fw}>
  {#if !sound}
    <header>
      <h2>분석대</h2>
      <p class="sub">아직 볼 소리가 없습니다. 녹음실에서 소리를 담으면 여기에서 잴 수 있습니다.</p>
    </header>
    <p><a class="btn ink" href={hrefFor({ screen: 'project', id: project.id, stage: 'listen' })}>녹음실로 가기</a></p>
  {:else}
    <header class="head">
      <div>
        <h2 data-testid="sound-title">{sound.label}</h2>
        <p class="sub">{seconds(sound.length)}초 가운데 {seconds(sel.end - sel.start)}초를 골랐습니다</p>
      </div>
      {#if project.sounds.length > 1}
        <div class="tabs" role="tablist" aria-label="소리 고르기">
          {#each project.sounds as s (s.id)}
            <button role="tab" aria-selected={s.id === sound.id} onclick={() => (view.soundId = s.id)}>{s.label}</button>
          {/each}
        </div>
      {/if}
    </header>

    {#if lost}
      <p class="notice">이 소리의 녹음이 이 태블릿에 없습니다. 녹음실에서 지우고 다시 담아 주세요.</p>
    {:else}
      <div class="bench">
        <div class="plots" bind:clientWidth={w}>
          <p class="cap">파형. 빨간 괄호를 옮기거나 끝의 손잡이를 끌어 잴 곳을 고릅니다</p>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div
            class="wave"
            bind:this={box}
            role="group"
            tabindex="0"
            aria-label="잴 구간. 왼쪽과 오른쪽 화살표로 옮깁니다"
            onpointerdown={down}
            onpointermove={drift}
            onpointerup={up}
            onpointercancel={up}
            onkeydown={nudge}
          >
            <svg viewBox="0 0 {w} {H}" width={w} height={H} aria-hidden="true">
              {#each [0, 1, 2, 3, 4] as i}
                <line x1="0" x2={w} y1={45 + i * 30} y2={45 + i * 30} stroke="var(--staff)" stroke-width="1.2" />
              {/each}
              <line x1="1.5" x2="1.5" y1="45" y2="165" stroke="var(--ink)" stroke-width="3" />
              <line x1={w - 1.5} x2={w - 1.5} y1="45" y2="165" stroke="var(--ink)" stroke-width="3" />
              <rect x={xs} y="14" width={Math.max(0, xe - xs)} height={H - 28} fill="var(--pencil)" fill-opacity="0.09" />
              <path d={shape} fill="var(--ink)" />
              <path d="M{xs + 14} 14H{xs}V{H - 14}H{xs + 14}" fill="none" stroke="var(--pencil)" stroke-width="4" />
              <path d="M{xe - 14} 14H{xe}V{H - 14}H{xe - 14}" fill="none" stroke="var(--pencil)" stroke-width="4" />
              <circle cx={xs} cy={MID} r="13" fill="var(--pencil)" />
              <circle cx={xe} cy={MID} r="13" fill="var(--pencil)" />
            </svg>
          </div>

          <p class="cap gap">배음. 기본음의 몇 배 자리에 얼마나 센 소리가 있는지</p>
          <svg viewBox="0 0 {w} 180" width={w} height="180" role="img" aria-label="배음 1번부터 16번까지의 세기">
            <line x1="0" x2={w} y1="150" y2="150" stroke="var(--ink)" stroke-width="2" />
            {#each stems as st (st.k)}
              <line x1={st.x} x2={st.x} y1="150" y2={st.y} stroke="var(--ink)" stroke-width="3" />
              <ellipse cx={st.x} cy={st.y} rx="11" ry="8" transform="rotate(-20 {st.x} {st.y})" fill="var(--ink)" />
              <text x={st.x} y="172" text-anchor="middle" font-size="14" fill="var(--ink-soft)">{st.k}</text>
            {/each}
          </svg>
        </div>

        <div class="result">
          {#if m && m.f0}
            <p class="cap">기본 주파수</p>
            <p class="hz" data-testid="f0">{m.f0.toFixed(1)}<small>Hz</small></p>
            <p class="say">{describePitch(m.f0)}</p>
            <svg viewBox="0 0 280 60" class="ruler" role="img" aria-label="가장 가까운 음에서 {Math.round(nearestNote(m.f0).cents)}센트">
              <line x1="15" y1="30" x2="265" y2="30" stroke="var(--ink)" stroke-width="2" />
              {#each [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50] as c}
                <line x1={140 + c * 2.5} x2={140 + c * 2.5} y1={c % 50 === 0 ? 14 : 22} y2="30" stroke="var(--ink)" stroke-width={c % 50 === 0 ? 2.5 : 1.2} />
                {#if c % 50 === 0}<text x={140 + c * 2.5} y="54" text-anchor="middle" font-size="14" fill="var(--ink-soft)">{c > 0 ? '+' : ''}{c}</text>{/if}
              {/each}
              <path d="M{140 + nearestNote(m.f0).cents * 2.5} 30l-8-22h16z" fill="var(--pencil)" />
            </svg>
            <table>
              <tbody>
                <tr><td>주기</td><td>{(1000 / m.f0).toFixed(3)} ms</td></tr>
                <tr><td>측정 신뢰도</td><td data-testid="confidence">{confidenceLevel(m.confidence)}</td></tr>
                <tr><td>가장 센 배음</td><td>{m.strongest === 1 ? '기본음' : `${m.strongest}배음, 기본음의 ${Math.round(m.harmonics[m.strongest - 1] * 100)}%`}</td></tr>
              </tbody>
            </table>
            {#if confidenceLevel(m.confidence) === '낮음'}
              <p class="notice small">음높이가 뚜렷하지 않습니다. 소리가 고르게 이어지는 곳으로 괄호를 옮겨 보세요.</p>
            {/if}
          {:else if m}
            <p class="notice">이 구간에서는 음높이를 찾지 못했습니다. 소리가 고르게 이어지는 곳으로 괄호를 옮겨 보세요.</p>
          {:else}
            <p class="cap">재는 중입니다.</p>
          {/if}
          <div class="acts">
            <button class="btn" onclick={() => hear('part')}>{playing === 'part' ? '멈추기' : '고른 구간 듣기'}</button>
            <button class="btn" onclick={() => hear('all')}>{playing === 'all' ? '멈추기' : '전체 듣기'}</button>
          </div>
        </div>
      </div>

      {#if m && m.f0}
        <section aria-labelledby="timbre">
          <h3 id="timbre">내 음색</h3>
          {#if usableAsTimbre(m)}
            <p>이 소리의 배음 세기를 작곡실의 악기 소리로 씁니다. 누르면 그 음색으로 도를 한 번 들려줍니다.</p>
            <p class="acts">
              <button class="btn ink" onclick={useTimbre}>이 소리를 내 음색으로 쓰기</button>
              {#if isTimbre}<span data-testid="timbre-set">지금 내 음색은 이 소리입니다.</span>{/if}
            </p>
          {:else}
            <p class="notice">이 소리는 음색으로 쓸 수 없습니다. 배음이 기본음의 정수배 자리에서 벗어나 있거나 음높이가 뚜렷하지 않습니다.</p>
          {/if}
        </section>

        {#if others.length}
          <section aria-labelledby="compare">
            <h3 id="compare">다른 소리와 견주기</h3>
            <table class="wide" data-testid="compare">
              <thead><tr><th>소리</th><th>기본 주파수</th><th>{sound.label}의 몇 배</th></tr></thead>
              <tbody>
                {#each others as o (o.s.id)}
                  <tr><td>{o.s.label}</td><td>{o.s.f0!.toFixed(1)} Hz</td><td>{o.ratio.toFixed(3)}배</td></tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}

        <section aria-labelledby="fit">
          <h3 id="fit">사인 그래프 맞추기</h3>
          <p>먹색 선은 고른 구간의 앞부분, 빨간 선은 내가 만드는 그래프입니다. 세 값을 움직여 두 선을 겹쳐 보세요.</p>
          {#if seg && model}
            <svg viewBox="0 0 {fw} 200" width={fw} height="200" role="img" aria-label="측정한 파형과 내가 만든 사인 그래프">
              <line x1="0" x2={fw} y1="100" y2="100" stroke="var(--staff)" stroke-width="1.2" />
              <path d={linePath(seg, fw, 100, 78)} fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linejoin="round" />
              <path d={linePath(model, fw, 100, 78)} fill="none" stroke="var(--pencil)" stroke-width="2.6" stroke-linejoin="round" stroke-dasharray="9 5" />
            </svg>
            <p class="tex"><Formula tex={fitTex} block /></p>
            <div class="sliders">
              <label><span>높이 A = {A.toFixed(2)}</span><input class="slider" type="range" min="0" max="1.5" step="0.01" bind:value={A} onchange={keepFit} /></label>
              <label><span>주파수 f = {f.toFixed(1)} Hz</span><input class="slider" type="range" min={Math.round(f0! * 0.5)} max={Math.round(f0! * 2)} step="0.1" bind:value={f} onchange={keepFit} data-testid="fit-f" /></label>
              <label><span>시작 위치 φ = {phi.toFixed(2)}</span><input class="slider" type="range" min="0" max="6.28" step="0.01" bind:value={phi} onchange={keepFit} /></label>
            </div>
            <table class="wide">
              <tbody>
                <tr><td>겹친 정도</td><td data-testid="overlap">{overlap}%</td></tr>
                <tr><td>주기 <Formula tex={'T = \\tfrac{1}{f}'} /></td><td>{(1000 / f).toFixed(3)} ms</td></tr>
                <tr><td><Formula tex={'b = 2\\pi f'} /> (식 <Formula tex={'y = A\\sin(bt + \\phi)'} />의 b)</td><td>{(2 * Math.PI * f).toFixed(1)}</td></tr>
              </tbody>
            </table>
            <div class="acts">
              <button class="btn" onclick={() => (added = Math.max(1, added - 1))} disabled={added <= 1}>배음 하나 빼기</button>
              <button class="btn" onclick={() => (added = Math.min(8, added + 1))} disabled={added >= 8}>배음 하나 더하기</button>
              <span data-testid="added">{added === 1 ? '기본음만 그렸습니다.' : `기본음에 ${added}배음까지 더했습니다.`}</span>
            </div>
          {/if}
        </section>

        <section aria-labelledby="spec">
          <h3 id="spec">스펙트럼</h3>
          <p>가로는 주파수, 세로는 세기입니다. 아래 세모는 기본음의 정수배 자리입니다.</p>
          <div class="seg" role="group" aria-label="보이는 범위">
            {#each ranges as r}
              <button aria-pressed={range === r} onclick={() => (range = r)}>0~{r} Hz</button>
            {/each}
          </div>
          <svg viewBox="0 0 {fw} 190" width={fw} height="190" role="img" aria-label="스펙트럼">
            <path d={specPath} fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" />
            <line x1="0" x2={fw} y1="142" y2="142" stroke="var(--ink)" stroke-width="2" />
            {#each ticks as t}
              <line x1={(t / range) * fw} x2={(t / range) * fw} y1="142" y2="150" stroke="var(--ink)" stroke-width="1.5" />
              <text x={Math.min(fw - 4, Math.max(4, (t / range) * fw))} y="184" text-anchor={t === 0 ? 'start' : (t / range) * fw > fw - 30 ? 'end' : 'middle'} font-size="14" fill="var(--ink-soft)">{t}</text>
            {/each}
            {#each Array.from({ length: 16 }, (_, k) => (k + 1) * m.f0!).filter((h) => h <= range) as h}
              <path d="M{(h / range) * fw} 152l-6 12h12z" fill="var(--ink)" />
            {/each}
          </svg>
        </section>
      {/if}
    {/if}
  {/if}
</article>

<style>
  article {
    max-width: 800px;
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
    margin-bottom: 6px;
  }
  section {
    display: grid;
    gap: 10px;
    padding-top: 18px;
    border-top: 2px solid var(--ink);
    min-width: 0;
  }
  .sub {
    margin-top: 6px;
    color: var(--ink-soft);
  }
  .cap {
    font-size: 15px;
    color: var(--ink-soft);
    margin-bottom: 4px;
  }
  .gap {
    margin-top: 12px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px 22px;
  }
  .tabs {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 0 12px;
  }
  .tabs button {
    appearance: none;
    min-height: var(--tap);
    min-width: var(--tap);
    padding: 0 6px;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .tabs button[aria-selected='true'] {
    font-weight: 800;
    border-bottom-color: var(--pencil);
  }

  .bench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 14px 30px;
  }
  .plots {
    min-width: 0;
  }
  .plots svg,
  section svg {
    display: block;
    max-width: 100%;
  }
  .wave {
    touch-action: pan-y;
    cursor: grab;
    user-select: none;
  }
  .result {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .hz {
    font-size: 64px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .hz small {
    font-size: 24px;
    font-weight: 500;
    letter-spacing: 0;
    margin-left: 6px;
  }
  .say {
    font-size: 20px;
    margin: 8px 0 12px;
  }
  .ruler {
    width: 100%;
    max-width: 280px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 16px;
  }
  td,
  th {
    padding: 8px 0;
    border-top: 1px solid var(--rule);
    text-align: left;
    font-weight: 400;
  }
  th {
    font-size: 15px;
    color: var(--ink-soft);
    border-top: 0;
  }
  tr:last-child td {
    border-bottom: 1px solid var(--rule);
  }
  td:last-child,
  th:last-child {
    text-align: right;
    font-weight: 700;
  }
  th:last-child {
    font-weight: 400;
  }
  .wide td:nth-child(2):not(:last-child),
  .wide th:nth-child(2):not(:last-child) {
    text-align: right;
    padding-right: 24px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .result .acts {
    margin-top: auto;
  }
  .result .acts .btn {
    flex: 1 1 auto;
    padding: 0 14px;
  }
  .small {
    font-size: 15px;
    margin-bottom: 12px;
  }
  .tex {
    padding: 4px 0;
    overflow-x: auto;
  }

  .sliders {
    display: grid;
    gap: 6px;
  }
  .sliders label {
    display: grid;
    grid-template-columns: 220px 1fr;
    align-items: center;
    gap: 14px;
  }
  /* 미는 막대: 줄 하나 위의 음표 머리 */
  .slider {
    appearance: none;
    width: 100%;
    height: var(--tap);
    margin: 0;
    background: linear-gradient(var(--staff), var(--staff)) center / 100% 2px no-repeat;
    cursor: pointer;
  }
  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 30px;
    height: 22px;
    border-radius: 50%;
    background: var(--ink);
    transform: rotate(-20deg);
  }
  .slider::-moz-range-thumb {
    width: 30px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: var(--ink);
    transform: rotate(-20deg);
  }

  .seg {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 2px solid var(--ink);
    border-radius: 26px;
    overflow: hidden;
    justify-self: start;
  }
  .seg button {
    appearance: none;
    min-height: var(--tap);
    padding: 0 18px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--ink);
    color: #fff;
  }

  @media (max-width: 680px) {
    .bench {
      grid-template-columns: minmax(0, 1fr);
    }
    .sliders label {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
