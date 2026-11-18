/**
 * 곡을 소리 파일로 (작업지시서 6.4절). OfflineAudioContext로 8마디를 한 번에 그린다.
 * 화면 재생과 같은 출력 경로(buildOutput), 같은 음표 예약 함수(scheduleNote), 같은 음 목록(notesAt)을 쓴다.
 */
import { notesAt, songSeconds, STEPS } from '../music/song';
import type { Project, Scale } from '../store/project';
import { buildOutput, scheduleNote, waveFor } from './engine';

export const RENDER_RATE = 44100;
const LEAD = 0.05;

export async function renderSong(song: Project['song'], scale: Scale, harmonics: readonly number[], sampleRate = RENDER_RATE): Promise<Float32Array> {
  const sec = 60 / song.bpm;
  const length = Math.ceil((LEAD + songSeconds(song.bpm)) * sampleRate);
  const off = new OfflineAudioContext(1, length, sampleRate);
  const out = buildOutput(off);
  for (let step = 0; step < STEPS; step++) {
    for (const n of notesAt(song, scale, step)) {
      scheduleNote(off, out, waveFor(off, harmonics, n.freq), { freq: n.freq, start: LEAD + step * sec, duration: n.steps * sec * 0.95, gain: n.gain });
    }
  }
  return (await off.startRendering()).getChannelData(0).slice();
}
