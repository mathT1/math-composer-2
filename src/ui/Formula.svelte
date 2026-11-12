<script lang="ts">
  // 수식은 앱에 들어 있는 문구만 그린다. 학생이 쓴 글을 여기에 넣지 않는다
  import katex from 'katex';
  import 'katex/dist/katex.min.css';

  let { tex, block = false }: { tex: string; block?: boolean } = $props();
  const html = $derived(katex.renderToString(tex, { displayMode: block, throwOnError: false, output: 'html' }));
</script>

<span class="formula" class:block>{@html html}</span>

<style>
  .formula {
    font-size: 1.1em;
  }
  .block {
    display: block;
    font-size: 1.35em;
  }
  .formula :global(.katex-display) {
    margin: 0;
    text-align: left;
  }
  .formula :global(.katex-display > .katex) {
    text-align: left;
  }
</style>
