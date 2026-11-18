<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { StepClock } from '../audio/clock';
  import { engine } from '../audio/engine';
  import { renderSong, RENDER_RATE } from '../audio/render';
  import { encodeWav } from '../audio/wav';
  import { usableAsTimbre } from '../dsp/analyze';
  import { download } from '../lib/format';
  import { rowFreq, rowName, stepName } from '../music/scales';
  import { chordLabel, chordPresets, chordRatio, notesAt, SECTION, STEPS } from '../music/song';
  import { fileStem, TIMBRE_PRESETS, type Project } from '../store/project';
  import { session } from '../store/session.svelte';

  const project = $derived(session.project!);
  const scale = $derived(project.scale);
  const song = $derived(project.song);
  const n = $derived(scale.steps.length);
  const rows = $derived(Array.from({ length: n * 2 }, (_, i) => n * 2 - 1 - i)); // 위가 높은 음
  const COLS = Array.from({ length: SECTION }, (_, i) => i);

  let section = $state(0);
  const base = $derived(section * SECTION);
  let message = $state('');

  // ── 고치기와 되돌리기 ──
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  let history = $state<Project['song'][]>([]);

  function edit(fn: (s: Project['song']) => void) {
    history = [...history.slice(-49), copy(project.song)];
    session.change((p) => fn(p.song));
  }

  function undo() {
    const last = history.at(-1);
    if (!last) return;
    history = history.slice(0, -1);
    session.change((p) => (p.song = last));
  }

  function clearSection() {
    edit((s) => {
      for (let i = base; i < base + SECTION; i++) {
        s.melody[i] = null;
        s.chords[i] = null;
      }
    });
    message = `${section * 4 + 1}~${section * 4 + 4}마디를 지웠습니다. 되돌리기로 살릴 수 있습니다.`;
  }

  // ── 선율 ──
  async function toggle(row: number, col: number) {
    const step = base + col;
    const on = song.melody[step] === row;
    edit((s) => (s.melody[step] = on ? null : row));
    if (!on) {
      await engine.wake();
      if (playing === null) engine.play(project.timbre.harmonics, rowFreq(scale, row), 0.45);
    }
  }

  // ── 화음 ──
  let chordAt = $state<number | null>(null);
  const chord = $derived(chordAt === null ? null : song.chords[chordAt]);
  const presets = $derived(chordPresets(scale));

  async function hearChord(rowsToPlay: number[]) {
    await engine.wake();
    for (const r of rowsToPlay) engine.play(project.timbre.harmonics, rowFreq(scale, r), 0.9, 0.45);
  }

  function setChord(rowsNext: number[] | null) {
    if (chordAt === null) return;
    const at = chordAt;
    edit((s) => (s.chords[at] = rowsNext && rowsNext.length ? [...rowsNext].sort((a, b) => a - b) : null));
    if (rowsNext && rowsNext.length) void hearChord(rowsNext);
  }

  function toggleChordNote(r: number) {
    const cur = chord ?? [];
    if (cur.includes(r)) return setChord(cur.filter((x) => x !== r));
    if (cur.length >= 3) {
      message = '화음에는 음을 세 개까지 쌓을 수 있습니다. 하나를 빼고 고르세요.';
      return;
    }
    message = '';
    setChord([...cur, r]);
  }

  function fillBar() {
    if (chordAt === null || !chord) return;
    const start = Math.floor(chordAt / 4) * 4;
    const c = [...chord];
    edit((s) => {
      for (let i = start; i < start + 4; i++) s.chords[i] = [...c];
    });
  }

  const ratio = $derived(chord && chord.length > 1 ? chordRatio(scale, chord) : null);

  // ── 재생 ──
  let playing = $state<'all' | 'section' | null>(null);
  let loop = $state(false);
  let now = $state<number | null>(null);
  let stopRun: (() => void) | null = null;

  async function play(mode: 'all' | 'section') {
    if (playing === mode) return stop();
    stop();
    await engine.wake();
    playing = mode;
    const from = mode === 'all' ? 0 : base;
    const to = mode === 'all' ? STEPS : base + SECTION;
    const repeat = mode === 'section' && loop;
    stopRun = engine.run(
      (start) => new StepClock(project.song.bpm, start, from, to, repeat),
      (k) => notesAt(project.song, project.scale, k, from, to).map((x) => ({ harmonics: project.timbre.harmonics, ...x })),
      (k) => {
        now = k;
        if (k !== null && mode === 'all') section = k < SECTION ? 0 : 1;
        if (k === null) playing = null;
      },
    );
  }

  function stop() {
    stopRun?.();
    stopRun = null;
    engine.stop();
    playing = null;
    now = null;
  }

  // 재생 위치가 화면 밖이면 그 칸이 보이게 민다(세로로 든 화면)
  let scroller: HTMLDivElement | undefined = $state();
  $effect(() => {
    const k = now;
    if (k === null || !scroller) return;
    const el = scroller.querySelector<HTMLElement>(`[data-col="${k - base}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // 처음에는 아래쪽(낮은 옥타브)이 보이게
  $effect(() => {
    if (!scroller) return;
    void tick().then(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  });

  // ── 빠르기 ──
  function setBpm(v: number) {
    const wasPlaying = playing;
    session.change((p) => (p.song.bpm = Math.round(Math.min(160, Math.max(60, v)))));
    if (wasPlaying) {
      stop();
      void play(wasPlaying);
    }
  }

  // ── 음색 ──
  const timbres = $derived([
    ...Object.keys(TIMBRE_PRESETS).map((k) => ({ id: k, label: k, harmonics: TIMBRE_PRESETS[k] })),
    ...project.sounds
      .filter((s) => s.harmonics.length === 16 && usableAsTimbre({ f0: s.f0, confidence: s.confidence, inharmonicity: s.inharmonicity }))
      .map((s) => ({ id: s.id, label: s.label, harmonics: s.harmonics })),
  ]);
  const timbreName = $derived(timbres.find((t) => t.id === project.timbre.from)?.label ?? '내가 만든 음색');

  async function setTimbre(t: { id: string; harmonics: number[] }) {
    session.change((p) => (p.timbre = { harmonics: [...t.harmonics], from: t.id }));
    await engine.wake();
    if (playing === null) engine.play(t.harmonics, rowFreq(scale, 0), 0.6);
  }

  // ── 파일 ──
  let saving = $state(false);
  const hasNotes = $derived(song.melody.some((x) => x !== null) || song.chords.some((c) => c && c.length));

  async function saveWav() {
    saving = true;
    message = '';
    try {
      await session.flush();
      const pcm = await renderSong(project.song, project.scale, project.timbre.harmonics);
      const name = `${fileStem(project)}_곡.wav`;
      download(name, new Blob([encodeWav(pcm, RENDER_RATE)], { type: 'audio/wav' }));
      message = `${name} 파일로 저장했습니다. 패들렛이나 클래스룸에 올리면 바로 들을 수 있습니다.`;
    } catch {
      message = '곡 파일을 만들지 못했습니다. 앱을 새로 고친 뒤 다시 눌러 주세요.';
    } finally {
      saving = false;
    }
  }

  const label = (row: number, col: number) => `${section * 4 + Math.floor(col / 4) + 1}마디 ${(col % 4) + 1}박 ${rowName(scale, row)}`;

  onDestroy(stop);
</script>

<article>
  <header class="head">
    <div>
      <h2>작곡실</h2>
      <p class="sub">{scale.name}, 음색은 {timbreName}. 칸을 누르면 음이 놓이고, 한 번 더 누르면 지워집니다.</p>
    </div>
    <div class="acts right">
      <button class="btn" onclick={undo} disabled={history.length === 0}>되돌리기</button>
      <button class="btn" onclick={saveWav} disabled={!hasNotes || saving}>{saving ? '만드는 중' : '곡 저장 (WAV)'}</button>
    </div>
  </header>

  {#if message}<p class="notice" role="status" data-testid="message">{message}</p>{/if}

  <div class="bar">
    <div class="seg" role="tablist" aria-label="구간">
      <button role="tab" aria-selected={section === 0} onclick={() => (section = 0)}>1~4마디</button>
      <button role="tab" aria-selected={section === 1} onclick={() => (section = 1)}>5~8마디</button>
    </div>
    <button class="btn ink" onclick={() => play('all')}>{playing === 'all' ? '멈추기' : '처음부터 듣기'}</button>
    <button class="btn" onclick={() => play('section')}>{playing === 'section' ? '멈추기' : '이 구간 듣기'}</button>
    <button class="btn toggle" aria-pressed={loop} onclick={() => (loop = !loop)}>구간 반복</button>
    <div class="tempo" role="group" aria-label="빠르기">
      <span>빠르기</span>
      <button class="step" onclick={() => setBpm(song.bpm - 4)} disabled={song.bpm <= 60} aria-label="느리게">−</button>
      <b data-testid="bpm" aria-live="polite">{song.bpm}</b>
      <button class="step" onclick={() => setBpm(song.bpm + 4)} disabled={song.bpm >= 160} aria-label="빠르게">+</button>
      <small>1분에 {song.bpm}박</small>
    </div>
  </div>

  <div class="scroller" bind:this={scroller} data-testid="grid">
    <div class="system" style:--rows={rows.length}>
      <div class="corner"></div>
      {#each COLS as c}
        <div class="num" data-col={c}>
          {#if c % 4 === 0}<span>{section * 4 + c / 4 + 1}</span>{/if}
          {#if now === base + c}<svg class="head-mark" viewBox="0 0 16 12" aria-hidden="true"><path d="M0 0h16L8 12z" /></svg>{/if}
        </div>
      {/each}

      {#each rows as r (r)}
        <div class="lab" class:tonic={r % n === 0}><b>{rowName(scale, r)}</b><small>{rowFreq(scale, r).toFixed(1)}</small></div>
        {#each COLS as c}
          <button
            class="c"
            class:bar={c % 4 === 0}
            class:end={c === SECTION - 1}
            class:on={song.melody[base + c] === r}
            class:now={now === base + c}
            aria-pressed={song.melody[base + c] === r}
            aria-label={label(r, c)}
            onclick={() => toggle(r, c)}
          ></button>
        {/each}
      {/each}

      <div class="lab chordlab"><b>화음</b></div>
      {#each COLS as c}
        {@const ch = song.chords[base + c]}
        <button
          class="ch"
          class:bar={c % 4 === 0}
          class:end={c === SECTION - 1}
          class:now={now === base + c}
          aria-pressed={chordAt === base + c}
          aria-label="{section * 4 + Math.floor(c / 4) + 1}마디 {(c % 4) + 1}박 화음 {ch ? chordLabel(scale, ch) : '없음'}"
          onclick={() => ((chordAt = chordAt === base + c ? null : base + c), (message = ''))}
        >{ch ? chordLabel(scale, ch) : ''}</button>
      {/each}
    </div>
  </div>

  {#if chordAt !== null}
    <section class="drawer" aria-labelledby="chord-title" data-testid="chord-editor" {@attach (el) => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
      <div class="drawer-head">
        <h3 id="chord-title">{Math.floor(chordAt / 4) + 1}마디 {(chordAt % 4) + 1}박의 화음</h3>
        <button class="btn" onclick={() => (chordAt = null)}>닫기</button>
      </div>
      {#if presets.length}
        <div class="chips" role="group" aria-label="자주 쓰는 화음">
          {#each presets as p}
            <button class="chip" aria-pressed={!!chord && chordLabel(scale, chord) === p.name} onclick={() => setChord(p.rows)}>
              {p.name} <small>{p.rows.map((r) => stepName(scale, r)).join('')}</small>
            </button>
          {/each}
        </div>
      {/if}
      <p class="hint">음을 눌러 두세 개를 쌓으세요.</p>
      <div class="chips" role="group" aria-label="화음에 쌓을 음">
        {#each Array.from({ length: n * 2 }, (_, i) => i) as r}
          <button class="chip note" aria-pressed={!!chord && chord.includes(r)} onclick={() => toggleChordNote(r)}>{rowName(scale, r)}</button>
        {/each}
      </div>
      {#if ratio}
        <p class="ratio" data-testid="chord-ratio">
          주파수 비 {ratio.decimals.map((d) => d.toFixed(3)).join(' : ')}
          {#if ratio.integers}<b> = {ratio.integers.join(' : ')}</b>{:else}<span class="hint"> (정수의 비로 딱 떨어지지 않습니다)</span>{/if}
        </p>
      {/if}
      <p class="acts">
        <button class="btn" onclick={() => chord && hearChord(chord)} disabled={!chord}>화음 듣기</button>
        <button class="btn" onclick={fillBar} disabled={!chord}>이 마디 네 칸에 모두 넣기</button>
        <button class="btn" onclick={() => setChord(null)} disabled={!chord}>이 칸 화음 지우기</button>
      </p>
    </section>
  {/if}

  <div class="settings">
    <p class="cap">음색</p>
    <div class="chips" role="group" aria-label="음색">
      {#each timbres as t (t.id)}
        <button class="chip" aria-pressed={project.timbre.from === t.id} onclick={() => setTimbre(t)}>{t.label}</button>
      {/each}
    </div>
  </div>

  <p class="acts foot">
    <button class="btn" onclick={clearSection}>이 구간 지우기</button>
    {#if !hasNotes}<span class="hint">음을 하나 넘게 놓으면 곡을 저장할 수 있습니다.</span>{/if}
  </p>
</article>

<style>
  article {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  h2 {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.015em;
    line-height: 1.1;
  }
  h3 {
    font-size: 20px;
    font-weight: 800;
  }
  .sub {
    margin-top: 6px;
    color: var(--ink-soft);
  }
  .hint,
  .cap {
    font-size: 15px;
    color: var(--ink-soft);
  }
  .cap {
    margin-bottom: 4px;
  }
  .bar,
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .toggle[aria-pressed='true'] {
    background: var(--ink);
    color: #fff;
  }

  /* ── 격자: 행마다 가운데 줄 하나, 4칸마다 굵은 마디줄, 켠 음은 음표 머리 ── */
  .scroller {
    overflow: auto;
    /* 격자 끝까지 밀면 화면 전체가 이어서 내려가도록 막지 않는다 */
    max-height: max(300px, calc(100dvh - 270px));
    border-bottom: 1px solid var(--rule);
  }
  .system {
    display: grid;
    grid-template-columns: 76px repeat(16, minmax(48px, 1fr));
    grid-template-rows: 30px repeat(var(--rows), 48px) 52px;
    min-width: calc(76px + 16 * 48px);
  }
  .corner,
  .num {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--page);
  }
  .corner {
    left: 0;
    z-index: 4;
  }
  .num {
    position: sticky;
    font-size: 14px;
    color: var(--ink-soft);
    padding-left: 5px;
    display: flex;
    align-items: flex-start;
  }
  .head-mark {
    position: absolute;
    left: 50%;
    bottom: 2px;
    width: 16px;
    height: 12px;
    margin-left: -8px;
    fill: var(--pencil);
  }
  .lab {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--page);
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.05;
    padding-right: 6px;
  }
  .lab b {
    font-size: 17px;
    font-weight: 700;
    white-space: nowrap;
  }
  .lab.tonic b {
    font-weight: 800;
  }
  .lab small {
    font-size: 12px;
    color: var(--ink-soft);
  }
  .c,
  .ch {
    appearance: none;
    position: relative;
    margin: 0;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--rule);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }
  .c::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1.5px solid var(--staff);
  }
  .c:active {
    background: var(--wash);
  }
  .c.bar,
  .ch.bar {
    border-left: 3px solid var(--ink);
  }
  .c.end,
  .ch.end {
    border-right: 3px solid var(--ink);
  }
  .c.on::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 34px;
    height: 25px;
    margin: -12.5px 0 0 -17px;
    background: var(--ink);
    border-radius: 50%;
    transform: rotate(-20deg);
  }
  .c.now,
  .ch.now {
    background: #c2362b1f;
  }
  .c.now.on::after {
    background: var(--pencil);
  }
  .chordlab {
    bottom: 0;
    position: sticky;
    z-index: 3;
    border-top: 2px solid var(--ink);
  }
  .ch {
    position: sticky;
    bottom: 0;
    z-index: 1;
    background: var(--wash);
    border-top: 2px solid var(--ink);
    font-size: 15px;
    font-weight: 700;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ch[aria-pressed='true'] {
    box-shadow: inset 0 0 0 3px var(--ink);
  }

  .drawer {
    display: grid;
    gap: 10px;
    padding: 14px 0;
    border-top: 2px solid var(--ink);
    border-bottom: 2px solid var(--ink);
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .ratio {
    font-size: 17px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    appearance: none;
    min-height: var(--tap);
    min-width: var(--tap);
    padding: 0 16px;
    border: 2px solid var(--ink);
    border-radius: 26px;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .chip small {
    font-weight: 400;
    font-size: 14px;
  }
  .chip[aria-pressed='true'] {
    background: var(--ink);
    color: #fff;
  }
  .chip.note {
    padding: 0 12px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 10px 20px;
  }
  .tempo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tempo b {
    font-size: 24px;
    font-weight: 800;
    min-width: 2.2em;
    text-align: center;
  }
  .tempo small {
    font-size: 14px;
    color: var(--ink-soft);
  }
  .step {
    appearance: none;
    width: var(--tap);
    height: var(--tap);
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }
  .step:disabled {
    opacity: 0.4;
  }
  .seg {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 2px solid var(--ink);
    border-radius: 26px;
    overflow: hidden;
  }
  .seg button {
    appearance: none;
    min-height: var(--tap);
    padding: 0 16px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .seg button[aria-selected='true'] {
    background: var(--ink);
    color: #fff;
  }


</style>
