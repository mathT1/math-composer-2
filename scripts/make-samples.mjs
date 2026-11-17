// 예시음 원본을 다듬는다: 소리 시작 직전부터 2.5초, 24kHz 모노, 최대 0.7, 앞뒤 기울기
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(join(root, 'node_modules/playwright/index.mjs')).href);
const { encodeWav } = await import(pathToFileURL(join(root, 'src/audio/wav.ts')).href);
const { detectPitch } = await import(pathToFileURL(join(root, 'src/dsp/pitch.ts')).href);
const LIST = [
  ['리코도 도.m4a', 'recorder-c'], ['리코더 솔.m4a', 'recorder-g'], ['리코더 높은도.m4a', 'recorder-c2'],
  ['목소리.m4a', 'voice'], ['피아노도.m4a', 'piano-c'], ['피아노미.m4a', 'piano-e'], ['피아노솔.m4a', 'piano-g'],
];
const RATE = 24000, SECONDS = 2.5;
const out = join(root, 'public/samples');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.setContent('<html></html>');
for (const [file, id] of LIST) {
  const b64 = (await readFile(join(root, '예시음', file))).toString('base64');
  const pcm = await page.evaluate(async ([b64, RATE, SECONDS]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.buffer);
    const x = buf.getChannelData(0);
    const sr = buf.sampleRate, hop = Math.round(sr * 0.02);
    const rms = [];
    for (let at = 0; at + hop <= x.length; at += hop) { let e = 0; for (let i = at; i < at + hop; i++) e += x[i] * x[i]; rms.push(Math.sqrt(e / hop)); }
    const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)];
    const on = rms.findIndex((r, i) => r > loud * 0.3 && rms[i + 1] > loud * 0.3 && rms[i + 2] > loud * 0.3);
    const start = Math.max(0, on * hop - Math.round(sr * 0.05));
    const off = new OfflineAudioContext(1, Math.round(RATE * SECONDS), RATE);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0, start / sr, SECONDS);
    const y = (await off.startRendering()).getChannelData(0);
    let s = '';
    const u8 = new Uint8Array(y.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, [b64, RATE, SECONDS]);
  const raw = Buffer.from(pcm, 'base64');
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  const fade = Math.round(RATE * 0.03);
  for (let i = 0; i < y.length; i++) y[i] = (y[i] / peak) * 0.7 * Math.min(1, i / fade, (y.length - 1 - i) / fade);
  await writeFile(join(out, `${id}.wav`), Buffer.from(encodeWav(y, RATE)));
  const mid = y.subarray(Math.round(RATE * 0.8), Math.round(RATE * 1.3));
  const p = detectPitch(mid, RATE);
  console.log(id, (y.length / RATE).toFixed(2) + 's', p.f0?.toFixed(1), p.clarity.toFixed(2));
}
await browser.close();
