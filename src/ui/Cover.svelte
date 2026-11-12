<script lang="ts">
  import { STAGES, type StageId } from '../content/stages';
  import { download, when } from '../lib/format';
  import { offline } from '../lib/offline.svelte';
  import { hrefFor } from '../lib/route.svelte';
  import { toBackup } from '../store/backup';
  import { fileStem, filledBars } from '../store/project';
  import { session } from '../store/session.svelte';

  let { stage = null }: { stage?: StageId | null } = $props();

  const project = $derived(session.project);
  const open = $derived(stage !== null && project !== null);

  let backedUp = $state('');

  async function saveBackup() {
    if (!project) return;
    await session.flush();
    const name = `${fileStem(project)}_백업.json`;
    download(name, new Blob([toBackup(project)], { type: 'application/json' }));
    backedUp = `${name} 파일로 저장했습니다.`;
  }
</script>

<header class="cover" class:open>
  {#if open && project}
    <div class="title">
      <a class="home" href="#/" aria-label="작업 목록으로 돌아가기">소리의 <br />수학</a>
      <p class="by" data-testid="project-name">{project.name}</p>
    </div>

    <nav aria-label="단계">
      <ol>
        {#each STAGES as s, i}
          <li class:extra={s.id === 'more'}>
            <a href={hrefFor({ screen: 'project', id: project.id, stage: s.id })} aria-current={s.id === stage ? 'step' : undefined}>
              <span class="n">{s.id === 'more' ? '+' : i + 1}</span>{s.name}
            </a>
          </li>
        {/each}
      </ol>
    </nav>

    <div class="foot">
      <p class="state" data-testid="state">
        <span>소리 {project.sounds.length}개,</span> <span>{project.scale.name},</span> <span>곡 {filledBars(project)}/8마디</span>
      </p>
      <p class="saved" data-testid="saved">
        {#if session.saveError}{session.saveError}{:else if session.savedAt}{when(session.savedAt)}에 저장됨{/if}
      </p>
      <button class="btn onCover" onclick={saveBackup}>백업 저장</button>
      {#if backedUp}<p class="saved" role="status">{backedUp}</p>{/if}
      {#if session.protected_ === false}
        <p class="saved roomy">수업이 끝나면 백업을 저장하세요. 이 태블릿은 공간이 모자라면 작업을 지울 수 있습니다.</p>
      {/if}
    </div>
  {:else}
    <div class="title">
      <h1>소리의 <br />수학</h1>
      <p class="by">Math-Composer 2</p>
    </div>
    <div class="foot">
      <p data-testid="offline">
        {#if offline.status === 'ready'}
          인터넷 없이 쓸 준비가 됐습니다.
        {:else if offline.status === 'failed'}
          인터넷 없이 쓸 준비를 하지 못했습니다. 인터넷에 연결한 채로 쓰세요.
        {:else}
          인터넷 없이도 쓸 수 있게 준비하는 중입니다.
        {/if}
      </p>
      <p>녹음한 소리와 이름은 이 태블릿 밖으로 나가지 않습니다.</p>
      <p><a href="#/check">기기 점검</a></p>
    </div>
  {/if}
</header>

<style>
  .cover {
    background: var(--cover);
    color: #fff;
    display: flex;
    flex-direction: column;
    padding: 28px 24px 22px;
    overflow-y: auto;
    flex: 0 0 40%;
    transition: flex-basis 0.28s ease;
  }
  .cover.open {
    flex-basis: var(--cover-w);
    padding: 24px 20px 18px;
  }
  .cover :focus-visible {
    outline-color: #fff;
  }

  h1,
  .home {
    display: block;
    margin: 0;
    color: inherit;
    text-decoration: none;
    font-weight: 800;
    line-height: 1.12;
    letter-spacing: -0.02em;
  }
  h1 {
    font-size: clamp(56px, 8.4vw, 92px);
  }
  .home {
    font-size: 28px;
  }
  .by {
    margin-top: 10px;
    font-size: 16px;
    opacity: 0.88;
    overflow-wrap: anywhere;
  }
  .cover:not(.open) .by {
    font-size: 20px;
    margin-top: 16px;
  }

  nav {
    margin-top: 22px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid #ffffff66;
  }
  li {
    border-bottom: 1px solid #ffffff66;
  }
  li a {
    display: grid;
    grid-template-columns: 28px 1fr;
    align-items: center;
    min-height: clamp(48px, 6.6vh, 54px);
    margin: 0 -20px;
    padding: 0 20px;
    color: inherit;
    text-decoration: none;
    font-size: 20px;
    font-weight: 500;
  }
  li .n {
    font-size: 16px;
    opacity: 0.8;
  }
  li a[aria-current] {
    background: #fff;
    color: var(--cover);
    font-weight: 800;
  }
  li a[aria-current] .n {
    opacity: 1;
  }

  .foot {
    margin-top: auto;
    padding-top: 18px;
    display: grid;
    gap: 8px;
    font-size: 15px;
    line-height: 1.45;
  }
  .foot a {
    color: inherit;
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    text-underline-offset: 4px;
  }
  .saved {
    opacity: 0.9;
  }
  .state span {
    white-space: nowrap;
  }
  /* 화면이 낮으면 긴 안내는 뺀다. 백업 안내는 묶기 단계에서 다시 한다 */
  @media (max-height: 779px) {
    .roomy {
      display: none;
    }
  }
  .btn.onCover {
    border-color: #fff;
    color: #fff;
    min-height: var(--tap);
    justify-self: start;
  }

  /* 세로로 들었거나 좁은 화면: 표지가 위쪽 띠로 접힌다 */
  @media (max-width: 899px) {
    .cover {
      flex: 0 0 auto;
      padding: 22px 20px 16px;
      transition: none;
    }
    h1 {
      font-size: 52px;
    }
    h1 :global(br),
    .home :global(br) {
      display: none;
    }
    .cover:not(.open) .foot {
      margin-top: 18px;
      padding-top: 0;
      gap: 2px;
    }

    .cover.open {
      flex-basis: auto;
      padding: 12px 0 0;
      overflow: visible;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 6px 12px;
    }
    .cover.open .title {
      grid-area: 1 / 1;
    }
    .cover.open .foot {
      grid-area: 1 / 2;
    }
    .cover.open nav {
      grid-area: 2 / 1 / 3 / -1;
    }
    .cover.open .title {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding-left: 20px;
      min-width: 0;
    }
    .home {
      font-size: 22px;
      min-height: var(--tap);
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
    }
    .cover.open .by {
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cover.open .foot {
      margin: 0;
      padding: 0 20px 0 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .cover.open .state,
    .cover.open .foot .saved:not([data-testid]) {
      display: none;
    }
    nav {
      margin: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    ol {
      display: flex;
      border-top: 1px solid #ffffff66;
    }
    li {
      border-bottom: 0;
      flex: 1 0 auto;
    }
    li a {
      margin: 0;
      padding: 0 16px;
      grid-template-columns: auto auto;
      justify-content: center;
      gap: 8px;
      min-height: 52px;
    }
  }
</style>
