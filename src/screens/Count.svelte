<script lang="ts">
  import { onDestroy } from 'svelte';
  import { StepClock } from '../audio/clock';
  import { engine } from '../audio/engine';
  import { grade, readNumber, TOL } from '../music/grade';
  import { BASE_FREQ, INTERVALS, stepName, presetScale, tuningRatio, type IntervalId } from '../music/scales';
  import { session } from '../store/session.svelte';
  import { readTables, type Tables } from '../store/tables';
  import Formula from '../ui/Formula.svelte';
  import NumberCell from '../ui/NumberCell.svelte';

  const project = $derived(session.project!);
  const t = $derived(readTables(project));
  const R = 2 ** (1 / 12);
  const TOP = BASE_FREQ * 2;
  const KS = Array.from({ length: 13 }, (_, k) => k);
  const chromatic = presetScale('equal12');
  const name = (k: number) => (k === 12 ? '높은 도' : stepName(chromatic, k));

  let part = $state<'three' | 'four'>('three');

  function edit(fn: (t: Tables) => void) {
    session.change((p) => {
      const next = readTables(p);
      fn(next);
      p.tables = { ...p.tables, ...next };
    });
  }

  // ── 소리 ──
  let playing = $state<string | null>(null);
  let now = $state<number | null>(null);
  let stopRun: (() => void) | null = null;

  async function playSeries(id: string, freqs: (number | null)[]) {
    if (playing === id) return stop();
    stop();
    await engine.wake();
    playing = id;
    const h = project.timbre.harmonics;
    stopRun = engine.run(
      (start) => new StepClock(150, start, 0, freqs.length, false),
      (k) => (freqs[k] ? [{ harmonics: h, freq: freqs[k]!, gain: 0.6 }] : []),
      (k) => {
        now = k;
        if (k === null && playing === id) playing = null;
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

  // ── 1. 예측 ──
  const predicted = $derived(
    KS.map((k) => (k === 0 ? BASE_FREQ : k === 12 ? TOP : readNumber(t.prediction[k]))).map((v) => (v !== null && Number.isFinite(v) && v > 0 ? v : null)),
  );
  const filledPrediction = $derived(predicted.slice(1, 12).filter((v) => v !== null).length);

  // ── 2. r ──
  const r = $derived(readNumber(t.r));
  const rOk = $derived(r !== null && Number.isFinite(r) && r > 0 && r < 4);
  const powers = $derived(rOk ? KS.slice(1).map((k) => r! ** k) : []);

  function step(by: number) {
    const base = rOk ? r! : 1.05;
    edit((x) => (x.r = String(Math.round((base + by) * 1e5) / 1e5)));
  }

  // ── 3. 계산표 ──
  /** 바로 앞 칸에 적은 값(맞은 경우)에 r을 곱한 값도 정답으로 본다. 반올림한 값을 이어 곱하는 학생을 위해 */
  const equalMarks = $derived(
    KS.map((k) => {
      if (k === 0) return 'right' as const;
      const answers = [BASE_FREQ * R ** k];
      const prev = k === 1 ? BASE_FREQ : readNumber(t.equal[k - 1]);
      if (prev !== null && Number.isFinite(prev) && Math.abs(prev - BASE_FREQ * R ** (k - 1)) <= TOL.hz * k) answers.push(prev * R);
      return grade(t.equal[k], answers, TOL.hz);
    }),
  );
  const equalValues = $derived(KS.map((k) => (k === 0 ? BASE_FREQ : equalMarks[k] === 'right' ? readNumber(t.equal[k]) : null)));
  const rightCount = $derived(equalMarks.slice(1).filter((m) => m === 'right').length);

  /** 내 소리 가운데 이 옥타브의 칸에 50센트 안으로 드는 것 */
  const measured = $derived(
    KS.map((k) => {
      const target = BASE_FREQ * R ** k;
      const hit = project.sounds
        .filter((s) => s.f0 !== null)
        .map((s) => ({ s, c: 1200 * Math.log2(s.f0! / target) }))
        .filter((x) => Math.abs(x.c) < 50)
        .sort((a, b) => Math.abs(a.c) - Math.abs(b.c))[0];
      return hit ? { label: hit.s.label, f0: hit.s.f0! } : null;
    }),
  );

  const ratioText = (a: number | null, b: number | null) => (a && b ? (b / a).toFixed(4) : '');
  const diffText = (a: number | null, b: number | null) => (a && b ? (b - a).toFixed(2) : '');

  // ── 4. 센트 유도표 ──
  const CENT_ROWS = [
    { id: 'oct', label: '옥타브', ratio: 2, tex: '2', given: true },
    { id: 'fifth', label: '순정 완전5도', ratio: 1.5, tex: '\\tfrac{3}{2}', given: false },
    { id: 'third', label: '순정 장3도', ratio: 1.25, tex: '\\tfrac{5}{4}', given: false },
    { id: 'semi', label: '평균율 반음', ratio: R, tex: '2^{\\frac{1}{12}}', given: false },
  ] as const;
  const COLS = [
    { id: 'oct', head: '옥타브 수', f: (x: number) => Math.log2(x), tol: TOL.octaves },
    { id: 'semi', head: '반음 수', f: (x: number) => 12 * Math.log2(x), tol: TOL.semis },
    { id: 'cent', head: '센트', f: (x: number) => 1200 * Math.log2(x), tol: TOL.cents },
  ] as const;
  const centMark = (row: (typeof CENT_ROWS)[number], col: (typeof COLS)[number]) => grade(t.cent[`${row.id}.${col.id}`], col.f(row.ratio), col.tol);
  const centDone = $derived(CENT_ROWS.filter((r) => !r.given).every((r) => COLS.every((c) => centMark(r, c) === 'right')));

  // ── 5. 두 음 비교 ──
  let interval = $state<IntervalId>('third');
  let pick = $state<[number, number]>([0, 1]);
  const tunings = $derived(INTERVALS[interval].tunings.map((tu) => ({ name: tu.name, ratio: tu.ratio, value: tuningRatio(tu) })));
  const fa = $derived(BASE_FREQ * tunings[pick[0]].value);
  const fb = $derived(BASE_FREQ * tunings[pick[1]].value);
  const centGap = $derived(1200 * Math.log2(fb / fa));

  function choose(slot: 0 | 1, i: number) {
    const next: [number, number] = [...pick];
    next[slot] = i;
    pick = next;
  }

  async function alternate() {
    await playSeries('alt', [fa, fb, fa, fb]);
  }

  async function together() {
    if (playing === 'both') return stop();
    stop();
    await engine.wake();
    playing = 'both';
    engine.play([1], fa, 4, 0.5);
    engine.play([1], fb, 4, 0.5);
    setTimeout(() => playing === 'both' && (playing = null), 4000);
  }

  // 두 사인을 실제로 더한 파형 (1.2초)
  let w = $state(700);
  const SECONDS = 1.2;
  const beatPath = $derived.by(() => {
    const n = Math.max(200, Math.floor(w * 3));
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const tt = (i / (n - 1)) * SECONDS;
      const v = (Math.sin(2 * Math.PI * fa * tt) + Math.sin(2 * Math.PI * fb * tt)) / 2;
      pts.push(`${((i / (n - 1)) * w).toFixed(1)} ${(80 - v * 64).toFixed(1)}`);
    }
    return `M${pts.join('L')}`;
  });

  onDestroy(stop);
</script>

<article bind:clientWidth={w}>
  <header class="head">
    <div>
      <h2>비율 실험실</h2>
      <p class="sub">도에서 한 옥타브 위 도까지, 주파수가 어떤 규칙으로 커지는지 찾습니다.</p>
    </div>
    <div class="seg" role="tablist" aria-label="차시">
      <button role="tab" aria-selected={part === 'three'} onclick={() => (part = 'three')}>반음의 비</button>
      <button role="tab" aria-selected={part === 'four'} onclick={() => (part = 'four')}>센트와 맥놀이</button>
    </div>
  </header>

  {#if part === 'three'}
    <section aria-labelledby="predict">
      <h3 id="predict">먼저 예측하기</h3>
      <p>
        도(261.63 Hz)와 높은 도(523.26 Hz) 사이에 반음이 12칸 있습니다. 칸마다 주파수가 얼마일지 먼저 적어 보세요. 칸마다 같은 값을 더할지, 같은 값을 곱할지는
        여러분이 정합니다.
      </p>
      <table class="grid" data-testid="prediction">
        <thead><tr><th>칸</th><th>음</th><th class="num">내 예측 (Hz)</th><th class="num">앞 칸과의 차</th><th class="num">앞 칸과의 비</th></tr></thead>
        <tbody>
          {#each KS as k}
            <tr class:now={playing === 'pred' && now === k}>
              <td>{k}</td>
              <td>{name(k)}</td>
              <td class="num">
                {#if k === 0 || k === 12}<b>{(k === 0 ? BASE_FREQ : TOP).toFixed(2)}</b>
                {:else}<NumberCell value={t.prediction[k]} label="{k}칸 예측" onchange={(v) => edit((x) => (x.prediction[k] = v))} testid="pred-{k}" />{/if}
              </td>
              <td class="num">{k > 0 ? diffText(predicted[k - 1], predicted[k]) : ''}</td>
              <td class="num">{k > 0 ? ratioText(predicted[k - 1], predicted[k]) : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="acts">
        <button class="btn" onclick={() => playSeries('pred', predicted)} disabled={filledPrediction === 0}>{playing === 'pred' ? '멈추기' : '내 예측 듣기'}</button>
        <button class="btn" onclick={() => playSeries('equal', KS.map((k) => BASE_FREQ * R ** k))}>{playing === 'equal' ? '멈추기' : '피아노 음계 듣기'}</button>
        <span class="hint">두 음계를 번갈아 들어 보고 어느 칸이 다르게 들리는지 찾아보세요.</span>
      </p>
    </section>

    <section aria-labelledby="ratio">
      <h3 id="ratio">반음 한 칸의 비 r</h3>
      <p>
        피아노는 칸마다 같은 수 <Formula tex="r" />를 곱합니다. 12칸을 가면 주파수가 두 배가 되므로 <Formula tex={'r^{12} = 2'} />입니다. <Formula tex="r" />를 바꿔 가며
        12번 곱한 값이 2가 되는 수를 찾아보세요.
      </p>
      <div class="rbox">
        <label class="rin">
          <span><Formula tex="r =" /></span>
          <NumberCell value={t.r} label="r" placeholder="1.05" onchange={(v) => edit((x) => (x.r = v))} testid="r" />
        </label>
        <div class="steps" role="group" aria-label="r을 조금씩 바꾸기">
          <button class="btn" onclick={() => step(-0.001)}>−0.001</button>
          <button class="btn" onclick={() => step(-0.0001)}>−0.0001</button>
          <button class="btn" onclick={() => step(0.0001)}>+0.0001</button>
          <button class="btn" onclick={() => step(0.001)}>+0.001</button>
        </div>
      </div>
      {#if rOk}
        <p class="big" data-testid="r12"><Formula tex={'r^{12} ='} /> {powers[11].toFixed(5)}</p>
        <p class="hint">
          {#if Math.abs(powers[11] - 2) < 0.0005}2에 아주 가깝습니다. 이 r이 반음 한 칸의 비입니다.
          {:else if powers[11] > 2}2보다 큽니다. r을 조금 줄여 보세요.
          {:else}2보다 작습니다. r을 조금 키워 보세요.{/if}
        </p>
        <ol class="pow" aria-label="r의 거듭제곱">
          {#each powers as v, i}
            <li><span><Formula tex={`r^{${i + 1}}`} /></span><b>{v.toFixed(4)}</b></li>
          {/each}
        </ol>
      {/if}
    </section>

    <section aria-labelledby="table">
      <h3 id="table">평균율 계산표</h3>
      <p>
        <Formula tex={'261.63 \\times r^{k}'} />로 칸마다의 주파수를 계산해 적으세요. 소수 둘째 자리까지 적으면 됩니다. 계산기를 써도 좋습니다. 맞으면 칸 옆에
        “맞음”이 뜹니다.
      </p>
      <table class="grid" data-testid="equal">
        <thead>
          <tr><th>칸 k</th><th>음</th><th class="num">평균율 (Hz)</th><th class="num">앞 칸과의 비</th><th class="num">내 예측</th><th class="num">내 소리</th></tr>
        </thead>
        <tbody>
          {#each KS as k}
            <tr>
              <td>{k}</td>
              <td>{name(k)}</td>
              <td class="num">
                {#if k === 0}<b>261.63</b>{:else}<NumberCell value={t.equal[k]} mark={equalMarks[k]} label="{k}칸 평균율 주파수" onchange={(v) => edit((x) => (x.equal[k] = v))} testid="eq-{k}" />{/if}
              </td>
              <td class="num">{k > 0 ? ratioText(equalValues[k - 1], equalValues[k]) : ''}</td>
              <td class="num soft">{k > 0 && k < 12 && predicted[k] ? predicted[k]!.toFixed(2) : ''}</td>
              <td class="num soft">{#if measured[k]}{measured[k]!.f0.toFixed(1)}<small> {measured[k]!.label}</small>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="hint" data-testid="equal-count">12칸 가운데 {rightCount}칸을 맞혔습니다. “내 소리”는 녹음실에서 담은 소리 가운데 그 칸에 가까운 것입니다.</p>
    </section>
  {:else}
    <section aria-labelledby="cent">
      <h3 id="cent">센트 만들기</h3>
      <p>
        두 음의 높이 차이를 재는 단위를 만듭니다. 한 옥타브는 반음 12개이고, 반음 하나를 100센트로 정합니다. 표를 왼쪽부터 채워 보세요.
        <Formula tex={'\\log_2 x = \\tfrac{\\log x}{\\log 2}'} />를 쓰면 계산기로 구할 수 있습니다.
      </p>
      <div class="scroll">
        <table class="grid" data-testid="cent-table">
          <thead>
            <tr>
              <th>음정</th><th class="num">두 주파수의 비</th>
              <th class="num">옥타브 수<br /><small><Formula tex={'\\log_2 \\frac{f_2}{f_1}'} /></small></th>
              <th class="num">반음 수<br /><small>옥타브 수 × 12</small></th>
              <th class="num">센트<br /><small>반음 수 × 100</small></th>
            </tr>
          </thead>
          <tbody>
            {#each CENT_ROWS as row}
              <tr>
                <td>{row.label}</td>
                <td class="num"><Formula tex={row.tex} /></td>
                {#each COLS as col}
                  <td class="num">
                    {#if row.given}<b>{col.f(row.ratio).toFixed(0)}</b>
                    {:else}<NumberCell value={t.cent[`${row.id}.${col.id}`] ?? ''} mark={centMark(row, col)} label="{row.label} {col.head}" onchange={(v) => edit((x) => (x.cent[`${row.id}.${col.id}`] = v))} testid="cent-{row.id}-{col.id}" />{/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if centDone}
        <div class="found" data-testid="cent-formula">
          <p>표를 모두 채웠습니다. 세 단계를 한 식으로 쓰면 이렇습니다.</p>
          <p class="tex big">센트 <Formula tex={'= 1200 \\log_2 \\dfrac{f_2}{f_1}'} /></p>
        </div>
      {/if}
    </section>

    <section aria-labelledby="compare">
      <h3 id="compare">두 음 비교하기</h3>
      <p>같은 이름의 음정도 만드는 방법에 따라 높이가 조금씩 다릅니다. 두 가지를 골라 번갈아 듣고, 함께 울려 보세요.</p>
      <div class="seg" role="group" aria-label="음정">
        {#each Object.entries(INTERVALS) as [id, it]}
          <button aria-pressed={interval === id} onclick={() => (interval = id as IntervalId)}>도에서 {it.name}</button>
        {/each}
      </div>
      <table class="grid" data-testid="tunings">
        <thead><tr><th>만드는 방법</th><th class="num">비</th><th class="num">주파수</th><th class="num">센트</th><th class="pick">첫째 소리</th><th class="pick">둘째 소리</th></tr></thead>
        <tbody>
          {#each tunings as tu, i}
            <tr>
              <td>{tu.name}</td>
              <td class="num">{#if tu.ratio}<Formula tex={`\\tfrac{${tu.ratio[0]}}{${tu.ratio[1]}}`} />{:else}<Formula tex={`2^{\\frac{${interval === 'third' ? 4 : 7}}{12}}`} />{/if}</td>
              <td class="num">{(BASE_FREQ * tu.value).toFixed(2)} Hz</td>
              <td class="num">{(1200 * Math.log2(tu.value)).toFixed(2)}</td>
              <td class="pick"><button class="dot" aria-pressed={pick[0] === i} aria-label="첫째 소리로 {tu.name}" onclick={() => choose(0, i)}></button></td>
              <td class="pick"><button class="dot" aria-pressed={pick[1] === i} aria-label="둘째 소리로 {tu.name}" onclick={() => choose(1, i)}></button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="say" data-testid="gap">
        {#if Math.abs(centGap) < 0.005}두 소리의 높이가 같습니다.
        {:else}둘째 소리가 첫째 소리보다 {Math.abs(centGap).toFixed(2)}센트 {centGap > 0 ? '높습니다' : '낮습니다'}.{/if}
      </p>
      <p class="acts">
        <button class="btn" onclick={alternate}>{playing === 'alt' ? '멈추기' : '번갈아 듣기'}</button>
        <button class="btn ink" onclick={together}>{playing === 'both' ? '멈추기' : '함께 울리기'}</button>
      </p>
      <p class="cap">두 소리를 더한 파형, 1.2초. 가로 눈금 하나가 0.1초입니다.</p>
      <svg viewBox="0 0 {w} 180" width={w} height="180" role="img" aria-label="{fa.toFixed(2)} Hz와 {fb.toFixed(2)} Hz를 더한 파형">
        <line x1="0" x2={w} y1="80" y2="80" stroke="var(--staff)" stroke-width="1" />
        <path d={beatPath} fill="none" stroke="var(--ink)" stroke-width="1" />
        <line x1="0" x2={w} y1="152" y2="152" stroke="var(--ink)" stroke-width="2" />
        {#each Array.from({ length: 13 }, (_, i) => i) as i}
          <line x1={(i / 12) * w} x2={(i / 12) * w} y1="152" y2={i % 5 === 0 ? 164 : 159} stroke="var(--ink)" stroke-width="1.5" />
          {#if i % 5 === 0}<text x={Math.min(w - 4, (i / 12) * w + (i === 0 ? 2 : 0))} y="178" text-anchor={i === 0 ? 'start' : 'middle'} font-size="14" fill="var(--ink-soft)">{(i / 10).toFixed(1)}초</text>{/if}
        {/each}
      </svg>
      <table class="grid narrow">
        <tbody>
          <tr><td>첫째 소리</td><td class="num">{fa.toFixed(2)} Hz</td></tr>
          <tr><td>둘째 소리</td><td class="num">{fb.toFixed(2)} Hz</td></tr>
          <tr><td>두 주파수의 차</td><td class="num" data-testid="beat-diff">{Math.abs(fb - fa).toFixed(2)} Hz</td></tr>
        </tbody>
      </table>
      <p class="hint">함께 울렸을 때 소리가 커졌다 작아지는 것을 맥놀이라고 합니다. 파형에서 한 번 커졌다 작아지는 데 걸리는 시간을 재어 두 주파수의 차와 견주어 보세요.</p>
    </section>
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
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px 22px;
  }
  .head .seg {
    margin-left: auto;
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
    min-width: 0;
  }
  .hint,
  .cap {
    font-size: 15px;
    color: var(--ink-soft);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .say {
    font-size: 20px;
  }
  svg {
    display: block;
    max-width: 100%;
  }
  .scroll {
    overflow-x: auto;
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
    vertical-align: bottom;
  }
  .grid td {
    padding: 2px 8px 2px 0;
    border-bottom: 1px solid var(--rule);
    height: 52px;
  }
  .grid .num {
    text-align: right;
  }
  .grid th.num {
    text-align: right;
  }
  .grid td.num :global(.cell) {
    max-width: 150px;
    margin-left: auto;
  }
  .grid .soft {
    color: var(--ink-soft);
  }
  .grid small {
    font-size: 13px;
  }
  .grid tr.now td {
    background: #c2362b14;
  }
  .grid tr.now td:first-child {
    box-shadow: inset 4px 0 0 var(--pencil);
  }
  .narrow {
    max-width: 360px;
  }
  .pick {
    text-align: center !important;
    width: 80px;
  }
  .dot {
    appearance: none;
    width: var(--tap);
    height: var(--tap);
    border: 0;
    background: none;
    cursor: pointer;
    position: relative;
  }
  .dot::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 26px;
    height: 19px;
    margin: -9.5px 0 0 -13px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    transform: rotate(-20deg);
  }
  .dot[aria-pressed='true']::after {
    background: var(--pencil);
    border-color: var(--pencil);
  }

  .rbox {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
  }
  .rin {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    width: 220px;
  }
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .steps .btn {
    min-height: var(--tap);
    padding: 0 14px;
  }
  .big {
    font-size: 34px;
    font-weight: 800;
  }
  .pow {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 4px 12px;
    font-size: 15px;
  }
  .pow li {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid var(--rule);
    padding: 4px 0;
  }
  .found {
    border-left: 6px solid var(--ink);
    padding-left: 14px;
  }
  .tex {
    padding: 4px 0;
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
  .seg button[aria-pressed='true'],
  .seg button[aria-selected='true'] {
    background: var(--ink);
    color: #fff;
  }

  @media (max-width: 680px) {
    .pow {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .head .seg {
      margin-left: 0;
    }
  }
</style>
