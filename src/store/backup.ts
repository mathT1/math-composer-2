/**
 * 백업 파일과 앨범 HTML에서 작업을 꺼내고 넣는다.
 * 앨범 HTML은 `<script type="application/json" id="mc2-data">` 안에 같은 내용을 담는다 (M5에서 만든다).
 */
import { parseProject, ProjectError, type Project } from './project';

export const BACKUP_KIND = 'math-composer-2-backup';

export interface Backup {
  kind: typeof BACKUP_KIND;
  savedAt: number;
  project: Project;
  /** 소리마다 고른 구간의 16비트 PCM(base64, 22.05kHz). M2에서 채운다 */
  clips: Record<string, { sampleRate: number; pcm16: string }>;
}

export function toBackup(project: Project, clips: Backup['clips'] = {}, now = Date.now()): string {
  const backup: Backup = { kind: BACKUP_KIND, savedAt: now, project, clips };
  // HTML 안에 넣어도 태그가 닫히지 않도록 <를 바꿔 쓴다
  return JSON.stringify(backup).replace(/</g, '\\u003c');
}

const DATA_TAG = /<script[^>]*\bid=["']mc2-data["'][^>]*>([\s\S]*?)<\/script>/i;

/** 파일 내용(백업 JSON 또는 앨범 HTML)에서 작업을 읽는다. 맞지 않으면 ProjectError */
export function fromBackupText(text: string): Backup {
  let json = text.trim();
  if (json.startsWith('<')) {
    const m = DATA_TAG.exec(json);
    if (!m) throw new ProjectError('이 HTML 파일에는 작업 내용이 들어 있지 않습니다. 소리의 수학에서 저장한 앨범 파일인지 확인하세요.');
    json = m[1];
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ProjectError('파일을 읽을 수 없습니다. 내려받다가 끊겼거나 다른 종류의 파일입니다.');
  }
  if (typeof data !== 'object' || data === null || (data as { kind?: unknown }).kind !== BACKUP_KIND) {
    throw new ProjectError('소리의 수학에서 저장한 백업 파일이 아닙니다.');
  }
  const raw = data as Record<string, unknown>;
  const project = parseProject(raw.project);
  const clips: Backup['clips'] = {};
  if (typeof raw.clips === 'object' && raw.clips !== null) {
    for (const [id, c] of Object.entries(raw.clips as Record<string, unknown>)) {
      const clip = c as { sampleRate?: unknown; pcm16?: unknown };
      if (
        project.sounds.some((s) => s.id === id) &&
        typeof clip?.sampleRate === 'number' &&
        typeof clip?.pcm16 === 'string' &&
        /^[A-Za-z0-9+/=]*$/.test(clip.pcm16)
      ) {
        clips[id] = { sampleRate: clip.sampleRate, pcm16: clip.pcm16 };
      }
    }
  }
  return { kind: BACKUP_KIND, savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0, project, clips };
}
