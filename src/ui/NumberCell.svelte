<script lang="ts">
  // 표 안의 수 입력 칸. 맞음·다시는 글자와 선 모양으로 알린다(색에만 기대지 않음, 빨간 연필은 쓰지 않음)
  import type { Mark } from '../music/grade';

  let {
    value,
    mark = 'empty',
    label,
    onchange,
    placeholder = '',
    testid,
  }: {
    value: string;
    mark?: Mark;
    label: string;
    onchange: (v: string) => void;
    placeholder?: string;
    testid?: string;
  } = $props();
</script>

<span class="cell {mark}">
  <input
    type="text"
    inputmode="decimal"
    autocomplete="off"
    {value}
    {placeholder}
    maxlength="20"
    aria-label={label}
    aria-invalid={mark === 'wrong' || mark === 'invalid'}
    data-testid={testid}
    onchange={(e) => onchange(e.currentTarget.value)}
  />
  {#if mark === 'right'}<span class="m" data-mark="right">맞음</span>
  {:else if mark === 'wrong'}<span class="m" data-mark="wrong">다시</span>
  {:else if mark === 'invalid'}<span class="m" data-mark="invalid">수만</span>{/if}
</span>

<style>
  .cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  input {
    appearance: none;
    width: 100%;
    min-width: 0;
    min-height: var(--tap);
    padding: 4px 2px;
    border: 0;
    border-bottom: 1.5px solid var(--staff);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  input:focus-visible {
    outline: none;
    border-bottom: 3px solid var(--ink);
    background: var(--wash);
  }
  input::placeholder {
    color: var(--ink-soft);
  }
  .right input {
    border-bottom: 3px double var(--ink);
    font-weight: 700;
  }
  .wrong input,
  .invalid input {
    border-bottom: 2px dashed var(--ink);
  }
  .m {
    flex: none;
    width: 2.6em;
    font-size: 14px;
    font-weight: 700;
  }
  .wrong .m,
  .invalid .m {
    font-weight: 400;
    color: var(--ink-soft);
  }
</style>
