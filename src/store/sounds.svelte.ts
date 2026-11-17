/**
 * 작업에 든 소리: 더하기, 지우기, 구간 바꾸기, 다시 재기. 소리 자체(PCM)는 기기 저장소에 따로 둔다.
 */
import { resample } from '../audio/recorder';
import { bestRegion, MAX_SELECTION, MIN_SELECTION, measure, type Measured, type Selection } from '../dsp/analyze';
import type { Backup } from './backup';
import { deletePcm, loadPcm, savePcm } from './db';
import { MAX_SOUNDS, type Project, type Sound } from './project';
import { session } from './session.svelte';

const cache = new Map<string, Float32Array>();
const key = (projectId: string, soundId: string) => `${projectId}:${soundId}`;

/** 소리의 전체 녹음을 가져온다. 기기에 없으면 null */
export async function pcmOf(projectId: string, soundId: string): Promise<Float32Array | null> {
  const k = key(projectId, soundId);
  const hit = cache.get(k);
  if (hit) return hit;
  const pcm = await loadPcm(projectId, soundId).catch(() => null);
  if (pcm) cache.set(k, pcm);
  return pcm;
}

function apply(sound: Sound, m: Measured): void {
  sound.f0 = m.f0;
  sound.confidence = m.confidence;
  sound.harmonics = m.harmonics;
  sound.inharmonicity = Math.min(1, m.inharmonicity);
}

/** 열린 작업에 소리를 더한다. 가장 안정된 0.5초를 골라 잰다 */
export async function addSound(label: string, source: Sound['source'], pcm: Float32Array, sampleRate: number): Promise<Sound | null> {
  const p = session.project;
  if (!p || p.sounds.length >= MAX_SOUNDS) return null;
  const selection = bestRegion(pcm, sampleRate);
  const sound: Sound = {
    id: crypto.randomUUID(),
    label: label.slice(0, 30),
    source,
    sampleRate,
    length: pcm.length,
    selection,
    f0: null,
    confidence: 0,
    harmonics: [],
    inharmonicity: 0,
  };
  apply(sound, measure(pcm, sampleRate, selection));
  await savePcm(p.id, sound.id, pcm);
  cache.set(key(p.id, sound.id), pcm);
  session.change((proj) => proj.sounds.push(sound));
  return sound;
}

export async function removeSound(soundId: string): Promise<void> {
  const p = session.project;
  if (!p) return;
  session.change((proj) => {
    proj.sounds = proj.sounds.filter((s) => s.id !== soundId);
    if (proj.timbre.from === soundId) proj.timbre.from = `${proj.timbre.from} (지운 소리)`.slice(0, 64);
  });
  cache.delete(key(p.id, soundId));
  await deletePcm(p.id, soundId).catch(() => {});
}

/** 구간을 길이 한계 안으로 맞춘다 */
export function clampSelection(sel: Selection, length: number, sampleRate: number): Selection {
  const min = Math.min(length, Math.round(MIN_SELECTION * sampleRate));
  const max = Math.min(length, Math.round(MAX_SELECTION * sampleRate));
  let start = Math.max(0, Math.min(Math.round(sel.start), length - min));
  let end = Math.max(start + min, Math.min(Math.round(sel.end), length));
  if (end - start > max) end = start + max;
  return { start, end };
}

/** 구간을 바꾸고 다시 잰다. 잰 결과(스펙트럼 포함)를 돌려준다 */
export async function reselect(soundId: string, sel: Selection): Promise<Measured | null> {
  const p = session.project;
  const sound = p?.sounds.find((s) => s.id === soundId);
  if (!p || !sound) return null;
  const pcm = await pcmOf(p.id, soundId);
  if (!pcm) return null;
  const selection = clampSelection(sel, pcm.length, sound.sampleRate);
  const m = measure(pcm, sound.sampleRate, selection);
  session.change((proj) => {
    const s = proj.sounds.find((x) => x.id === soundId);
    if (!s) return;
    s.selection = selection;
    apply(s, m);
  });
  return m;
}

// ── 백업에 넣는 소리 조각 ─────────────────────────────

const CLIP_RATE = 22050;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 소리마다 고른 구간만 22.05kHz 16비트로 줄여 백업에 넣는다 (6.5절) */
export async function clipsFor(project: Project): Promise<Backup['clips']> {
  const clips: Backup['clips'] = {};
  for (const s of project.sounds) {
    const pcm = await pcmOf(project.id, s.id);
    if (!pcm) continue;
    const part = await resample(pcm.subarray(s.selection.start, s.selection.end), s.sampleRate, CLIP_RATE);
    const pcm16 = new Int16Array(part.length);
    for (let i = 0; i < part.length; i++) pcm16[i] = Math.round(Math.max(-1, Math.min(1, part[i])) * 32767);
    clips[s.id] = { sampleRate: CLIP_RATE, pcm16: toBase64(new Uint8Array(pcm16.buffer)) };
  }
  return clips;
}

/**
 * 백업에서 되살린 작업의 소리를 기기에 넣는다. 백업에는 고른 구간만 있으므로
 * 그 조각이 소리의 전체가 되고, 구간은 조각 전체로 바뀐다. 조각이 없는 소리는 작업에서 뺀다.
 */
export async function restoreClips(project: Project, clips: Backup['clips']): Promise<void> {
  const kept: Sound[] = [];
  for (const s of project.sounds) {
    const clip = clips[s.id];
    if (!clip) continue;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(clip.pcm16), (c) => c.charCodeAt(0));
    } catch {
      continue;
    }
    const pcm16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    if (pcm16.length < 64 || !(clip.sampleRate >= 8000 && clip.sampleRate <= 192000)) continue;
    const pcm = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm16[i] / 32767;
    s.sampleRate = clip.sampleRate;
    s.length = pcm.length;
    s.selection = { start: 0, end: pcm.length };
    await savePcm(project.id, s.id, pcm);
    cache.set(key(project.id, s.id), pcm);
    kept.push(s);
  }
  project.sounds = kept;
}
