<script lang="ts">
  import { onMount } from 'svelte';
  import { offline } from './lib/offline.svelte';
  import { router } from './lib/route.svelte';
  import Check from './screens/Check.svelte';
  import Stage from './screens/Stage.svelte';
  import Start from './screens/Start.svelte';
  import { session } from './store/session.svelte';
  import Cover from './ui/Cover.svelte';

  const route = $derived(router.current);
  let missing = $state(false);

  // 주소가 가리키는 작업을 연다. 없는 작업이면 시작 화면에서 알린다
  $effect(() => {
    const r = route;
    if (r.screen === 'project') {
      if (session.project?.id !== r.id) {
        void session.open(r.id).then((ok) => {
          missing = !ok;
          if (!ok) router.go({ screen: 'start' });
        });
      }
    } else if (session.project) {
      void session.close();
    }
  });

  onMount(() => offline.start());
</script>

{#if offline.hasUpdate}
  <div class="update" role="status">
    <p>앱의 새 판이 준비됐습니다. 바꾸는 동안 화면이 한 번 다시 열립니다. 작업은 그대로 남습니다.</p>
    <button class="btn" onclick={() => offline.update()}>새 판으로 바꾸기</button>
  </div>
{/if}

{#if route.screen === 'check'}
  <div class="plain">
    <p class="back"><a href="#/">시작 화면으로</a></p>
    <Check />
  </div>
{:else}
  <div class="book">
    <Cover stage={route.screen === 'project' ? route.stage : null} />
    <main>
      {#if route.screen === 'project'}
        {#if session.project}<Stage stage={route.stage} />{/if}
      {:else}
        {#if missing}
          <p class="notice gone" role="status">열려던 작업이 이 태블릿에 없습니다. 백업 파일이 있으면 아래에서 불러오세요.</p>
        {/if}
        <Start />
      {/if}
    </main>
  </div>
{/if}

<style>
  .book {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 26px 34px 26px 38px;
  }
  .gone {
    margin-bottom: 26px;
    max-width: 620px;
  }
  .plain {
    height: 100%;
    overflow-y: auto;
  }
  .back {
    max-width: 46rem;
    margin: 0 auto;
    padding: 12px 1.25rem 0;
  }
  .back a {
    color: inherit;
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    text-underline-offset: 4px;
  }
  .update {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    background: var(--wash);
    border-top: 2px solid var(--ink);
  }
  .update p {
    flex: 1;
  }
  .update .btn {
    flex: none;
    background: var(--page);
  }

  @media (max-width: 899px) {
    .book {
      flex-direction: column;
    }
    main {
      padding: 22px 20px 26px;
    }
    .update {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
