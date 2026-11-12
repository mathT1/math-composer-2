/**
 * 주소의 # 뒤로 화면을 정한다. 서버 설정 없이 GitHub Pages 하위 경로와 오프라인에서 그대로 동작한다.
 *   (없음)            시작 화면
 *   #/p/<작업>/<단계>  작업의 한 단계
 *   #/check           기기 점검
 */
import { STAGES, type StageId } from '../content/stages';

export type Route = { screen: 'start' } | { screen: 'check' } | { screen: 'project'; id: string; stage: StageId };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'check') return { screen: 'check' };
  if (parts[0] === 'p' && parts[1]) {
    const stage = STAGES.find((s) => s.id === parts[2])?.id ?? STAGES[0].id;
    return { screen: 'project', id: decodeURIComponent(parts[1]), stage };
  }
  return { screen: 'start' };
}

export function hrefFor(route: Route): string {
  if (route.screen === 'check') return '#/check';
  if (route.screen === 'project') return `#/p/${encodeURIComponent(route.id)}/${route.stage}`;
  return '#/';
}

class Router {
  current = $state<Route>(typeof location === 'undefined' ? { screen: 'start' } : parseHash(location.hash));

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => (this.current = parseHash(location.hash)));
    }
  }

  go(route: Route): void {
    location.hash = hrefFor(route);
  }
}

export const router = new Router();
