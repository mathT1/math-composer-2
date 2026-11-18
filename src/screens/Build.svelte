<script lang="ts">
  import { onDestroy } from 'svelte';
  import { StepClock } from '../audio/clock';
  import { engine } from '../audio/engine';
  import { PRESETS, presetScale, remapSong, rowFreq, songHasNotes, stepName, type PresetKind } from '../music/scales';
  import { clean, type Project, type Scale } from '../store/project';
  import { session } from '../store/session.svelte';
  import Formula from '../ui/Formula.svelte';
  import ScaleCircle from '../ui/ScaleCircle.svelte';

  const project = $derived(session.project!);
  const KINDS = Object.keys(PRESETS) as PresetKind[];

  // 보고 있는 음계: 처음에는 지금 내 음계
  let kind = $state<PresetKind>(KINDS.includes(session.project!.scale.kind as PresetKind) ? (session.project!.scale.kind as PresetKind) : 'equal12');
  const viewing = $derived<Scale>(kind === project.scale.kind ? project.scale : presetScale(kind));
  let label = $state(session.project!.scale.name);
  $effect(() => {
    label = kind === project.scale.kind ? project.scale.name : PRESETS[kind].name;
  });
  const isMine = $derived(kind === project.scale.kind);

  let asking = $state(false);
  let notice = $state('');
  /** 바로 앞의 음계와 곡. 되돌리기용 */
  let undo = $state<{ scale: Scale; song: Project['song'] } | null>(null);

  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  function use() {
    notice = '';
    if (!isMine && songHasNotes(project.song)) {
      asking = true;
      return;
    }
    apply();
  }

  function apply() {
    asking = false;
    const next: Scale = { ...copy(viewing), name: clean(label, 30) || PRESETS[kind].name };
    const before = { scale: copy(project.scale), song: copy(project.song) };
    const moved = songHasNotes(project.song) && !isMine;
    session.change((p) => {
      if (moved) p.song = remapSong(p.song, p.scale, next);
      p.scale = next;
    });
    undo = before;
    notice = moved ? `내 음계를 “${next.name}”(으)로 바꾸고 곡의 음을 가장 가까운 음으로 옮겼습니다.` : `내 음계를 “${next.name}”(으)로 정했습니다.`;
  }

  function revert() {
    if (!undo) return;
    const back = undo;
    session.change((p) => {
      p.scale = back.scale;
      p.song = back.song;
    });
    kind = (KINDS.includes(back.scale.kind as PresetKind) ? back.scale.kind : 'equal12') as PresetKind;
    undo = null;
    notice = `이전 음계 “${back.scale.name}”와 곡으로 되돌렸습니다.`;
  }

  // ── 소리 ──
  let current = $state<number | null>(null);
  let playing = $state(false);
  let stopRun: (() => void) | null = null;

  async function hear(i: number) {
    stop();
    await engine.wake();
    current = i;
    engine.play(project.timbre.harmonics, rowFreq(viewing, i), 0.7);
    setTimeout(() => current === i && !playing && (current = null), 700);
  }

  async function hearAll() {
    if (playing) return stop();
    stop();
    await engine.wake();
    playing = true;
    const n = viewing.steps.length;
    const s = viewing;
    stopRun = engine.run(
      (start) => new StepClock(120, start, 0, n + 1, false),
      (k) => [{ harmonics: project.timbre.harmonics, freq: rowFreq(s, k), gain: 0.6 }],
      (k) => {
        current = k === null ? null : k % n;
        if (k === null) playing = false;
      },
    );
  }

  function stop() {
    stopRun?.();
    stopRun = null;
    engine.stop();
    playing = false;
    current = null;
  }

  const ratioTex = (r: [number, number] | undefined, cents: number) => (r ? (r[1] === 1 ? `${r[0]}` : `\\tfrac{${r[0]}}{${r[1]}}`) : `2^{\\frac{${Math.round(cents / 100)}}{12}}`);
  const off = (cents: number) => {
    const d = cents - Math.round(cents / 100) * 100;
    return Math.abs(d) < 0.005 ? '0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
  };

  onDestroy(stop);
</script>

<article>
  <header>
    <h2>음계 공방</h2>
    <p class="sub">곡에 쓸 음계를 고릅니다. 지금 내 음계는 <b data-testid="my-scale">{project.scale.name}</b>입니다.</p>
  </header>

  <div class="seg" role="group" aria-label="음계 고르기">
    {#each KINDS as k}
      <button aria-pressed={kind === k} onclick={() => ((kind = k), (notice = ''), (asking = false))}>{PRESETS[k].name}</button>
    {/each}
  </div>
  <p>{PRESETS[kind].about}</p>

  <div class="bench">
    <div class="tablewrap">
      <table class="grid" data-testid="scale-table">
        <thead>
          <tr><th>음</th><th class="num">기준음과의 비</th><th class="num">센트</th><th class="num">평균율과의 차</th><th class="num">주파수</th><th><span class="sr">듣기</span></th></tr>
        </thead>
        <tbody>
          {#each viewing.steps as st, i}
            <tr class:now={current === i}>
              <td><b>{stepName(viewing, i)}</b></td>
              <td class="num"><Formula tex={ratioTex(st.ratio, st.cents)} /></td>
              <td class="num">{st.cents.toFixed(2)}</td>
              <td class="num">{off(st.cents)}</td>
              <td class="num">{rowFreq(viewing, i).toFixed(2)} Hz</td>
              <td><button class="btn small" onclick={() => hear(i)} aria-label="{stepName(viewing, i)} 듣기">듣기</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="acts">
        <button class="btn" onclick={hearAll}>{playing ? '멈추기' : '음계 차례로 듣기'}</button>
      </p>
    </div>
    <figure>
      <ScaleCircle scale={viewing} {current} />
      <figcaption>음표 머리는 이 음계의 음, 바깥 눈금은 12평균율의 반음 자리입니다. 눈금에서 벗어난 만큼 평균율과 다릅니다.</figcaption>
    </figure>
  </div>

  <section aria-labelledby="mine">
    <h3 id="mine">내 음계로 정하기</h3>
    <div class="save">
      <label class="field">
        <span>음계 이름</span>
        <input bind:value={label} maxlength="30" />
      </label>
      <button class="btn ink" onclick={use}>{isMine ? '이름 바꾸기' : '이 음계를 내 음계로 쓰기'}</button>
    </div>

    {#if asking}
      <div class="notice" role="alertdialog" aria-labelledby="ask-title" data-testid="remap-ask">
        <p id="ask-title">이미 지은 곡이 있습니다.</p>
        <p class="plain">음계를 바꾸면 곡의 음이 새 음계에서 높이가 가장 가까운 음으로 옮겨집니다. 바꾼 뒤 “되돌리기”로 원래대로 돌릴 수 있습니다.</p>
        <p class="acts">
          <button class="btn ink" onclick={apply}>바꾸고 곡의 음 옮기기</button>
          <button class="btn" onclick={() => (asking = false)}>그만두기</button>
        </p>
      </div>
    {/if}
    {#if notice}
      <p class="acts" role="status">
        <span data-testid="scale-notice">{notice}</span>
        {#if undo}<button class="btn" onclick={revert}>되돌리기</button>{/if}
      </p>
    {/if}
  </section>
</article>

<style>
  article {
    max-width: 800px;
    display: grid;
    gap: 18px;
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
  }
  .sub {
    margin-top: 6px;
    color: var(--ink-soft);
  }
  section {
    display: grid;
    gap: 12px;
    padding-top: 18px;
    border-top: 2px solid var(--ink);
  }
  .bench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 14px 28px;
    align-items: start;
  }
  .tablewrap {
    min-width: 0;
    overflow-x: auto;
  }
  figure {
    margin: 0;
  }
  figcaption {
    font-size: 15px;
    color: var(--ink-soft);
    margin-top: 6px;
  }
  .grid {
    border-collapse: collapse;
    width: 100%;
    font-size: 16px;
  }
  .grid th {
    font-size: 15px;
    font-weight: 400;
    color: var(--ink-soft);
    text-align: left;
    padding: 6px 8px 6px 0;
    border-bottom: 2px solid var(--ink);
  }
  .grid td {
    padding: 2px 8px 2px 0;
    border-bottom: 1px solid var(--rule);
    height: 54px;
    white-space: nowrap;
  }
  .grid .num {
    text-align: right;
  }
  .grid tr.now td {
    background: #c2362b14;
  }
  .grid tr.now td:first-child {
    box-shadow: inset 4px 0 0 var(--pencil);
    padding-left: 8px;
  }
  .btn.small {
    min-height: var(--tap);
    padding: 0 14px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    margin-top: 12px;
  }
  .save {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px 20px;
  }
  .save .field {
    flex: 1 1 240px;
    max-width: 360px;
  }
  .notice .plain {
    font-weight: 400;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
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
  @media (max-width: 760px) {
    .bench {
      grid-template-columns: minmax(0, 1fr);
    }
    figure {
      max-width: 320px;
    }
  }
</style>
