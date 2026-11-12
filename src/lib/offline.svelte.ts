/**
 * 오프라인 준비 상태. 서비스 워커가 모든 파일을 받아 두면 ‘ready’.
 * 새 판이 있으면 알리기만 하고, 사용자가 누를 때 바꾼다(작업 중에 화면이 갑자기 바뀌지 않게).
 */
import { registerSW } from 'virtual:pwa-register';

class Offline {
  status = $state<'checking' | 'ready' | 'failed'>('checking');
  error = $state('');
  hasUpdate = $state(false);
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

  #apply: ((reload?: boolean) => Promise<void>) | null = null;
  #started = false;

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#apply = registerSW({
      onOfflineReady: () => (this.status = 'ready'),
      onNeedRefresh: () => {
        this.status = 'ready';
        this.hasUpdate = true;
      },
      onRegisteredSW: (_url, registration) => {
        if (registration?.active && this.status === 'checking') this.status = 'ready';
      },
      onRegisterError: (e) => {
        this.status = 'failed';
        this.error = String(e);
      },
    });
    const on = () => (this.online = navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
  }

  /** 새 판으로 바꾸고 화면을 다시 연다 */
  update(): void {
    void this.#apply?.(true);
  }
}

export const offline = new Offline();
