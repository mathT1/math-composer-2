<script lang="ts">
  // 한 바퀴가 한 옥타브인 원. 먹 선의 원, 12평균율 눈금, 음마다 음표 머리 (디자인.md “다른 시안에서 가져오는 것”)
  import { stepName } from '../music/scales';
  import type { Scale } from '../store/project';

  let { scale, current = null, size = 300 }: { scale: Scale; current?: number | null; size?: number } = $props();

  const c = $derived(size / 2);
  const R = $derived(size / 2 - 46);
  const at = (cents: number, r: number) => {
    const a = (cents / 1200) * 2 * Math.PI - Math.PI / 2;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };
</script>

<svg viewBox="0 0 {size} {size}" width={size} height={size} role="img" aria-label="{scale.name}의 음을 한 옥타브 원 위에 놓은 그림">
  <circle cx={c} cy={c} r={R} fill="none" stroke="var(--ink)" stroke-width="2" />
  {#each Array.from({ length: 12 }, (_, k) => k) as k}
    {@const p1 = at(k * 100, R - 9)}
    {@const p2 = at(k * 100, R + 9)}
    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--staff)" stroke-width={k % 12 === 0 ? 3 : 1.5} />
  {/each}
  {#each scale.steps as st, i}
    {@const p = at(st.cents, R)}
    {@const q = at(st.cents, R + 30)}
    <ellipse cx={p.x} cy={p.y} rx="11" ry="8" transform="rotate(-20 {p.x} {p.y})" fill={current === i ? 'var(--pencil)' : 'var(--ink)'} />
    <text x={q.x} y={q.y + 5} text-anchor="middle" font-size="15" font-weight={current === i ? 800 : 400} fill="var(--ink)">{stepName(scale, i)}</text>
  {/each}
  <text x={c} y={c - 4} text-anchor="middle" font-size="15" fill="var(--ink-soft)">한 바퀴</text>
  <text x={c} y={c + 16} text-anchor="middle" font-size="15" fill="var(--ink-soft)">= 1200센트</text>
</svg>

<style>
  svg {
    display: block;
    max-width: 100%;
    height: auto;
  }
</style>
