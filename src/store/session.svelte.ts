/**
 * 지금 열려 있는 작업. 고치면 잠시 뒤 기기에 저장한다.
 */
import { loadProject, requestPersistence, saveProject } from './db';
import type { Project } from './project';

const SAVE_DELAY = 400;

class Session {
  project = $state<Project | null>(null);
  /** 마지막으로 기기에 저장한 시각 */
  savedAt = $state<number | null>(null);
  saveError = $state('');
  /** 저장소 보호가 받아들여졌는지. null은 아직 묻지 않음 */
  protected_ = $state<boolean | null>(null);

  #timer: ReturnType<typeof setTimeout> | null = null;

  async open(id: string): Promise<boolean> {
    await this.flush();
    const p = await loadProject(id).catch(() => null);
    this.project = p;
    this.savedAt = p ? p.updatedAt : null;
    this.saveError = '';
    if (p && this.protected_ === null) void requestPersistence().then((ok) => (this.protected_ = ok));
    return p !== null;
  }

  async close(): Promise<void> {
    await this.flush();
    this.project = null;
    this.savedAt = null;
  }

  /** 작업을 고친다. 고친 내용은 잠시 뒤 저장된다 */
  change(edit: (p: Project) => void): void {
    if (!this.project) return;
    edit(this.project);
    this.project.updatedAt = Date.now();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  /** 기다리는 저장을 지금 한다 */
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const p = this.project;
    if (!p) return;
    try {
      await saveProject(p);
      this.savedAt = p.updatedAt;
      this.saveError = '';
    } catch (e) {
      this.saveError = `저장하지 못했습니다(${(e as Error)?.name ?? '알 수 없는 오류'}). 백업 저장을 눌러 파일로 남겨 두세요.`;
    }
  }
}

export const session = new Session();

if (typeof document !== 'undefined') {
  // 탭을 닫거나 다른 앱으로 넘어갈 때 기다리던 저장을 마친다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void session.flush();
  });
}
