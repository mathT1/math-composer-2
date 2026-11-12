<script lang="ts">
  // 단계 화면이 만들어지기 전까지 자리를 지키는 화면. M2부터 단계별 화면으로 바뀐다
  import { STAGES, type StageId } from '../content/stages';
  import Formula from '../ui/Formula.svelte';

  let { stage }: { stage: StageId } = $props();
  const s = $derived(STAGES.find((x) => x.id === stage)!);
</script>

<article>
  <h2>{s.place}</h2>
  <p class="does">{s.does}</p>
  {#if s.tex}<p class="tex"><Formula tex={s.tex} block /></p>{/if}
  <p class="notice">이 화면은 아직 만드는 중입니다. {s.opens}에 열립니다.</p>
</article>

<style>
  article {
    max-width: 620px;
    display: grid;
    gap: 18px;
    justify-items: start;
  }
  h2 {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.015em;
    line-height: 1.1;
  }
  .does {
    font-size: 20px;
  }
  .tex {
    padding: 6px 0;
  }
</style>
