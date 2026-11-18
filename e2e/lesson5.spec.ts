import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodeWav } from '../src/audio/wav';
import { detectPitch } from '../src/dsp/pitch';

async function newProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('작업 이름').fill(name);
  await page.getByRole('button', { name: '작업 만들기' }).click();
  await expect(page.getByRole('heading', { name: '녹음실' })).toBeVisible();
}

const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(b / a));

test('5차시: 내 음계와 음색으로 8마디를 짓고, 듣고, WAV로 저장한다', async ({ page, baseURL }) => {
  const outside: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await newProject(page, '첫 번째 곡');
  // 순정률 장음계를 내 음계로
  await page.getByRole('link', { name: /짓기/ }).click();
  await page.getByRole('button', { name: '순정률 장음계' }).click();
  await page.getByRole('button', { name: '이 음계를 내 음계로 쓰기' }).click();
  await page.getByRole('link', { name: /만들기/ }).click();
  await expect(page.getByRole('heading', { name: '작곡실' })).toBeVisible();
  await expect(page.getByText('순정률 장음계, 음색은 맑은')).toBeVisible();

  // 격자: 순정률 장음계 두 옥타브 = 14행, 칸은 48px 이상
  const grid = page.getByTestId('grid');
  await expect(grid.getByRole('button', { name: /^1마디 1박 (?!화음)/ })).toHaveCount(14);
  const box = (await grid.getByRole('button', { name: '1마디 1박 도', exact: true }).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(48);
  expect(box.height).toBeGreaterThanOrEqual(48);

  // 선율: 도 미 솔 높은 도, 한 칸에 한 음
  const cell = (bar: number, beat: number, note: string) => grid.getByRole('button', { name: `${bar}마디 ${beat}박 ${note}`, exact: true });
  await cell(1, 1, '도').click();
  await cell(1, 2, '미').click();
  await cell(1, 3, '솔').click();
  await cell(1, 4, '높은 도').click();
  await cell(1, 4, '시').click(); // 같은 칸의 다른 음을 누르면 바뀐다
  await expect(cell(1, 4, '시')).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(1, 4, '높은 도')).toHaveAttribute('aria-pressed', 'false');
  await cell(1, 4, '시').click(); // 한 번 더 누르면 지워진다
  await expect(cell(1, 4, '시')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '방금 한 것 되돌리기' }).click();
  await expect(cell(1, 4, '시')).toHaveAttribute('aria-pressed', 'true');

  // 화음: I 프리셋, 주파수 비 4 : 5 : 6, 마디 네 칸에
  await grid.getByRole('button', { name: /^1마디 1박 화음/ }).click();
  const editor = page.getByTestId('chord-editor');
  await editor.getByRole('button', { name: /^I / }).click();
  await expect(page.getByTestId('chord-ratio')).toContainText('4 : 5 : 6');
  await editor.getByRole('button', { name: '이 마디 네 칸에 모두 넣기' }).click();
  await expect(grid.getByRole('button', { name: '1마디 4박 화음 I' })).toBeVisible();
  // 음을 넷째로 쌓으려 하면 알린다
  await editor.getByRole('button', { name: '라', exact: true }).click();
  await expect(page.getByTestId('message')).toContainText('세 개까지');
  await editor.getByRole('button', { name: '닫기' }).click();

  // B구간
  await page.getByRole('tab', { name: '5~8마디' }).click();
  await cell(8, 1, '높은 도').click();
  await expect(page.getByTestId('state')).toContainText('곡 2/8마디');
  await page.getByRole('tab', { name: '1~4마디' }).click();
  await page.screenshot({ path: 'test-results/m4-make-landscape.png' });

  // 재생: 재생 위치 표식이 움직이고 멈춘다
  await page.getByRole('button', { name: '처음부터 듣기' }).click();
  await expect(page.locator('.head-mark')).toHaveCount(1);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/m4-playing.png' });
  await page.getByRole('button', { name: '멈추기' }).click();
  await expect(page.locator('.head-mark')).toHaveCount(0);

  // 빠르기 120, 음색 바꾸기
  await page.getByTestId('bpm-slider').fill('120');
  await page.getByTestId('bpm-slider').dispatchEvent('change');
  await expect(page.getByTestId('bpm')).toHaveText('120');
  await page.getByRole('button', { name: '날카로운' }).click();
  await expect(page.getByText('음색은 날카로운')).toBeVisible();

  // WAV 저장: 길이, 최대 음량, 첫 박의 음높이
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '곡 저장 (WAV)' }).click()]);
  expect(download.suggestedFilename()).toBe('첫_번째_곡_곡.wav');
  const buf = await readFile(await download.path());
  const { samples, sampleRate } = decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  expect(samples.length / sampleRate).toBeCloseTo(0.05 + 32 * 0.5 + 1, 1);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  expect(peak).toBeLessThanOrEqual(0.8 + 1e-3);
  expect(peak).toBeGreaterThan(0.05);
  // 5마디 첫 박부터는 아무 음도 없다가 8마디 첫 박에 높은 도(523.26Hz)
  const at = (sec: number, len = 0.3) => samples.subarray(Math.round((0.05 + sec) * sampleRate), Math.round((0.05 + sec + len) * sampleRate));
  const silent = at(16 * 0.5, 2);
  expect(Math.max(...Array.from(silent, Math.abs))).toBeLessThan(0.01);
  const hi = detectPitch(at(28 * 0.5 + 0.05), sampleRate);
  expect(cents(523.26, hi.f0!)).toBeLessThan(5);

  // 새로 고쳐도 곡이 남는다
  await page.waitForTimeout(600);
  await page.reload();
  await expect(cell(1, 3, '솔')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bpm')).toHaveText('120');

  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('구간 반복과 이 구간 지우기', async ({ page }) => {
  await newProject(page, '반복 곡');
  await page.getByRole('link', { name: /만들기/ }).click();
  const grid = page.getByTestId('grid');
  await grid.getByRole('button', { name: '1마디 1박 도', exact: true }).click();
  await grid.getByRole('button', { name: '4마디 4박 솔', exact: true }).click();
  await page.getByTestId('bpm-slider').fill('160');
  await page.getByTestId('bpm-slider').dispatchEvent('change');
  await page.getByRole('button', { name: '구간 반복' }).click();
  await page.getByRole('button', { name: '이 구간 듣기' }).click();
  // 16박 = 6초 뒤에도 계속 재생 중
  await page.waitForTimeout(6800);
  await expect(page.getByRole('button', { name: '멈추기' })).toBeVisible();
  await expect(page.locator('.head-mark')).toHaveCount(1);
  await page.getByRole('button', { name: '멈추기' }).click();

  await page.getByRole('button', { name: '이 구간 지우기' }).click();
  await expect(grid.getByRole('button', { name: '1마디 1박 도', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '곡 저장 (WAV)' })).toBeDisabled();
  await page.getByRole('button', { name: '방금 한 것 되돌리기' }).click();
  await expect(grid.getByRole('button', { name: '1마디 1박 도', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('내 소리에서 얻은 음색을 고를 수 있다', async ({ page }) => {
  await newProject(page, '음색 곡');
  await page.getByRole('button', { name: '예시음 고르기' }).click();
  await page.getByRole('button', { name: '피아노 도 담기' }).click();
  await expect(page.getByTestId('message')).toContainText('담았습니다');
  await page.getByRole('link', { name: /만들기/ }).click();
  await page.getByRole('button', { name: '피아노 도', exact: true }).click();
  await expect(page.getByText('음색은 피아노 도')).toBeVisible();
});

test('세로 화면(753×1000)의 작곡실: 페이지는 넘치지 않고 격자만 옆으로 민다, 칸은 48px 이상', async ({ page }) => {
  await page.setViewportSize({ width: 753, height: 1000 });
  await newProject(page, '세로 곡');
  await page.getByRole('link', { name: /만들기/ }).click();
  await expect(page.getByRole('heading', { name: '작곡실' })).toBeVisible();
  const grid = page.getByTestId('grid');
  await grid.getByRole('button', { name: '1마디 1박 도', exact: true }).click();
  await grid.getByRole('button', { name: /^1마디 1박 화음/ }).click();
  await page.screenshot({ path: 'test-results/m4-make-portrait.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main button, main input')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 47.5 || r.width < 47.5))
      .map(({ el, r }) => `${(el as HTMLElement).getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 12)} ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});
