/**
 * 기기 저장소(IndexedDB). 작업은 `projects`, 녹음한 소리 전체는 `pcm`에 둔다.
 */
import { parseProject, type Project } from './project';

const NAME = 'mc2';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pcm')) db.createObjectStore('pcm');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function run<T>(store: 'projects' | 'pcm', mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = work(tx.objectStore(store));
        tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  sounds: number;
  scale: string;
}

/** 저장된 작업 목록. 최근에 고친 것부터. 읽을 수 없는 항목은 건너뛴다 */
export async function listProjects(): Promise<Project[]> {
  const all = await run<unknown[]>('projects', 'readonly', (s) => s.getAll());
  const ok: Project[] = [];
  for (const raw of all) {
    try {
      ok.push(parseProject(raw));
    } catch {
      // 모양이 맞지 않는 항목은 목록에 올리지 않는다
    }
  }
  return ok.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  const raw = await run<unknown>('projects', 'readonly', (s) => s.get(id));
  if (raw === undefined) return null;
  return parseProject(raw);
}

export function saveProject(project: Project): Promise<void> {
  // 반응형 상태의 껍데기를 벗겨 순수한 값으로 저장한다
  const plain = JSON.parse(JSON.stringify(project)) as Project;
  return run<void>('projects', 'readwrite', (s) => void s.put(plain));
}

export async function deleteProject(project: Project): Promise<void> {
  await run<void>('pcm', 'readwrite', (s) => {
    for (const sound of project.sounds) s.delete(sound.id);
  });
  await run<void>('projects', 'readwrite', (s) => void s.delete(project.id));
}

export function savePcm(soundId: string, pcm: Float32Array): Promise<void> {
  return run<void>('pcm', 'readwrite', (s) => void s.put(pcm, soundId));
}

export async function loadPcm(soundId: string): Promise<Float32Array | null> {
  const v = await run<unknown>('pcm', 'readonly', (s) => s.get(soundId));
  return v instanceof Float32Array ? v : null;
}

export function deletePcm(soundId: string): Promise<void> {
  return run<void>('pcm', 'readwrite', (s) => void s.delete(soundId));
}

/** 브라우저가 공간이 모자랄 때 작업을 지우지 않도록 요청한다. 받아들여졌는지 돌려준다 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
