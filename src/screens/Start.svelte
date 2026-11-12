<script lang="ts">
  import { onMount } from 'svelte';
  import { when } from '../lib/format';
  import { router } from '../lib/route.svelte';
  import { fromBackupText } from '../store/backup';
  import { deleteProject, listProjects, saveProject } from '../store/db';
  import { createProject, filledBars, ProjectError, type Project } from '../store/project';

  let name = $state('');
  let studentId = $state('');
  let studentName = $state('');
  let projects = $state<Project[]>([]);
  let loaded = $state(false);
  let message = $state('');
  let asking = $state<string | null>(null);

  async function refresh() {
    try {
      projects = await listProjects();
    } catch {
      message = '이 브라우저에서는 작업을 기기에 저장할 수 없습니다. 비공개 창(시크릿 모드)이면 일반 창으로 다시 여세요.';
    }
    loaded = true;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    message = '';
    if (!name.trim()) {
      message = '작업 이름을 적어 주세요. 예: 리코더 소리 탐구';
      return;
    }
    const p = createProject(name, { id: studentId, name: studentName });
    try {
      await saveProject(p);
    } catch {
      message = '작업을 저장하지 못했습니다. 태블릿의 저장 공간을 확인한 뒤 다시 눌러 주세요.';
      return;
    }
    router.go({ screen: 'project', id: p.id, stage: 'listen' });
  }

  async function restore(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = '';
    try {
      if (file.size > 20 * 1024 * 1024) throw new ProjectError('파일이 너무 큽니다. 소리의 수학에서 저장한 파일인지 확인하세요.');
      const { project } = fromBackupText(await file.text());
      // 이 기기에 같은 작업이 있으면 덮어쓰지 않고 따로 둔다
      if (projects.some((p) => p.id === project.id)) {
        project.id = crypto.randomUUID();
        project.name = `${project.name} (불러옴)`.slice(0, 40);
      }
      project.updatedAt = Date.now();
      await saveProject(project);
      await refresh();
      message = `“${project.name}” 작업을 불러왔습니다. 아래 목록에서 눌러 이어서 하세요.`;
    } catch (err) {
      message = err instanceof ProjectError ? err.message : '파일을 불러오지 못했습니다. 다시 골라 주세요.';
    }
  }

  async function remove(p: Project) {
    await deleteProject(p);
    asking = null;
    await refresh();
  }

  onMount(refresh);
</script>

<div class="start">
  <section aria-labelledby="new">
    <h2 id="new">새 작업</h2>
    <form onsubmit={create} novalidate>
      <label class="field wide">
        <span>작업 이름</span>
        <input bind:value={name} maxlength="40" placeholder="리코더 소리 탐구" autocomplete="off" enterkeyhint="done" />
      </label>
      <label class="field">
        <span>학번 (적지 않아도 됩니다)</span>
        <input bind:value={studentId} maxlength="20" inputmode="numeric" autocomplete="off" />
      </label>
      <label class="field">
        <span>이름 (적지 않아도 됩니다)</span>
        <input bind:value={studentName} maxlength="20" autocomplete="off" />
      </label>
      <p class="hint wide">학번과 이름은 내보내는 파일의 이름과 보고서에만 쓰입니다.</p>
      <button class="btn ink" type="submit">작업 만들기</button>
    </form>
  </section>

  {#if message}<p class="notice" role="status" data-testid="message">{message}</p>{/if}

  <section aria-labelledby="resume">
    <h2 id="resume">이어하기</h2>
    {#if !loaded}
      <p class="hint">저장된 작업을 찾는 중입니다.</p>
    {:else if projects.length === 0}
      <p class="hint">이 태블릿에 저장된 작업이 아직 없습니다. 위에서 새 작업을 만드세요.</p>
    {:else}
      <ul class="list" data-testid="projects">
        {#each projects as p (p.id)}
          <li>
            {#if asking === p.id}
              <p class="ask">“{p.name}”을(를) 지우면 되돌릴 수 없습니다.</p>
              <button class="btn ink" onclick={() => remove(p)}>지우기</button>
              <button class="btn" onclick={() => (asking = null)}>그만두기</button>
            {:else}
              <a href="#/p/{encodeURIComponent(p.id)}/listen">
                <b>{p.name}</b>
                <span>
                  {when(p.updatedAt)}에 저장, 소리 {p.sounds.length}개, 곡 {filledBars(p)}/8마디{p.studentName ? `, ${p.studentName}` : ''}
                </span>
              </a>
              <button class="btn" onclick={() => (asking = p.id)} aria-label="{p.name} 지우기">지우기</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="restore">
    <h2 id="restore">백업에서 불러오기</h2>
    <p class="hint">전에 저장한 백업 파일이나 앨범 파일을 고르면 그 작업을 이어서 할 수 있습니다.</p>
    <label class="btn file">
      파일 고르기
      <input type="file" accept=".json,.html,application/json,text/html" onchange={restore} data-testid="restore" />
    </label>
  </section>
</div>

<style>
  .start {
    max-width: 620px;
    display: grid;
    gap: 34px;
  }
  h2 {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.015em;
    line-height: 1.1;
    margin-bottom: 14px;
  }
  section + section h2,
  .notice + section h2 {
    font-size: 24px;
  }
  form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px 28px;
    justify-items: start;
  }
  form .field {
    width: 100%;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .hint {
    font-size: 15px;
    color: var(--ink-soft);
  }
  form .hint {
    margin-top: -8px;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--ink);
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    border-bottom: 1px solid var(--rule);
  }
  .list a {
    flex: 1;
    min-width: 0;
    display: grid;
    padding: 10px 0;
    color: inherit;
    text-decoration: none;
  }
  .list b {
    font-size: 20px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .list span {
    font-size: 15px;
    color: var(--ink-soft);
  }
  .list .btn {
    min-height: var(--tap);
    padding: 0 18px;
    flex: none;
  }
  .ask {
    flex: 1;
    font-weight: 700;
  }

  .file {
    position: relative;
    margin-top: 12px;
  }
  .file input {
    position: absolute;
    inset: -2px;
    opacity: 0;
    cursor: pointer;
  }
  .file:focus-within {
    outline: 3px solid var(--ink);
    outline-offset: 3px;
  }

  @media (max-width: 520px) {
    form {
      grid-template-columns: 1fr;
    }
  }
</style>
