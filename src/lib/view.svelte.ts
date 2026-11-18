import type { Project, Scale } from '../store/project';

/**
 * 화면 사이에 넘겨주는 것.
 * - soundId: 분석대에서 볼 소리
 * - scaleUndo: 음계 공방에서 바꾸기 전의 음계와 곡. 작곡실에 다녀와도 되돌릴 수 있게 화면 밖에 둔다 (M3-A4)
 */
export const view = $state<{
  soundId: string | null;
  scaleUndo: { projectId: string; scale: Scale; song: Project['song'] } | null;
}>({ soundId: null, scaleUndo: null });
