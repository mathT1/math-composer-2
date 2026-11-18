import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function newProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('작업 이름').fill(name);
  await page.getByRole('button', { name: '작업 만들기' }).click();
  await expect(page.getByRole('heading', { name: '녹음실' })).toBeVisible();
}

async function take(page: Page, label: string) {
  if (!(await page.getByTestId('samples').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '예시음 고르기' }).click();
  }
  await page.getByRole('button', { name: `${label} 담기` }).click();
}

const hz = async (page: Page) => parseFloat((await page.getByTestId('f0').textContent())!);
const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(b / a));

test('예시음만으로 1~2차시를 끝낸다 (원칙 5)', async ({ page, baseURL }) => {
  const outside: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await newProject(page, '예시음 탐구');
  await take(page, '리코더 도');
  await take(page, '리코더 높은 도');
  await take(page, '피아노 도');
  await take(page, '피아노 솔');
  const sounds = page.getByTestId('sounds');
  await expect(sounds.getByTestId('sound-f0')).toHaveCount(4);
  await expect(sounds.getByTestId('sound-f0').first()).toContainText('Hz');
  await expect(page.getByTestId('state')).toContainText('소리 4개');
  await page.screenshot({ path: 'test-results/m2-listen-landscape.png' });

  // 분석대: 기본 주파수, 음이름, 신뢰도
  await sounds.getByRole('link', { name: '분석하기' }).first().click();
  await expect(page.getByTestId('sound-title')).toHaveText('리코더 도');
  await expect(page.getByTestId('f0')).toContainText('Hz');
  const low = await hz(page);
  expect(cents(534, low)).toBeLessThan(12);
  await expect(page.getByTestId('confidence')).toHaveText('높음');
  await expect(page.getByText(/도5보다 \d+센트 높음/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/m2-see-landscape.png' });

  // 한 옥타브 위 소리는 약 2배 (2차시)
  const compare = page.getByTestId('compare');
  const row = compare.getByRole('row', { name: /리코더 높은 도/ });
  const ratio = parseFloat((await row.getByRole('cell').nth(2).textContent())!);
  expect(Math.abs(ratio - 2)).toBeLessThan(0.03);

  // 사인 맞추기: 주파수를 측정값에 맞추면 겹친 정도가 오른다
  const before = parseInt((await page.getByTestId('overlap').textContent())!);
  await page.getByTestId('fit-f').fill(low.toFixed(1));
  await page.getByTestId('fit-f').dispatchEvent('change');
  await page.getByRole('button', { name: '배음 하나 더하기' }).click();
  await expect(page.getByTestId('added')).toContainText('2배음까지');
  await page.getByTestId('fit-f').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/m2-fit-landscape.png' });
  expect(before).toBeLessThan(60);
  // 시작 위치 φ를 돌려 보면 어딘가에서 겹친 정도가 뚜렷하게 오른다 (M2-A1)
  let best = 0;
  const phiSlider = page.getByRole('slider', { name: /시작 위치/ });
  for (let p = 0; p <= 6.2; p += 0.2) {
    await phiSlider.fill(p.toFixed(2));
    best = Math.max(best, parseInt((await page.getByTestId('overlap').textContent())!));
  }
  // 높이 A와 나머지 배음까지 맞추기 전이라 100에는 못 미친다. 고치기 전에는 여기서 0%였다
  expect(best).toBeGreaterThan(50);
  expect(best).toBeGreaterThan(before + 20);

  // 내 음색으로 쓰기
  await page.getByRole('button', { name: '이 소리를 내 음색으로 쓰기' }).click();
  await expect(page.getByTestId('timbre-set')).toBeVisible();

  // 다른 소리로 바꿔 본다
  await page.getByRole('tab', { name: '피아노 솔' }).click();
  await expect(page.getByTestId('sound-title')).toHaveText('피아노 솔');
  await expect.poll(async () => cents(393, await hz(page))).toBeLessThan(12);

  // 다시 열어도 소리, 음색, 맞춘 식이 남아 있다 (자동 저장은 고친 뒤 0.4초에 일어난다)
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('f0')).toContainText('Hz');
  await expect(page.getByTestId('timbre-set')).toBeVisible();
  await expect(page.getByTestId('fit-f')).toHaveValue(low.toFixed(1));

  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('마이크로 녹음해 재고, 구간을 옮기면 다시 잰다', async ({ page }) => {
  await newProject(page, '녹음 탐구');
  await page.getByRole('button', { name: '녹음하기' }).click();
  await expect(page.getByTestId('mic-info')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => parseFloat((await page.getByTestId('rec-time').textContent())!), { timeout: 10_000 }).toBeGreaterThan(1.5);
  await page.screenshot({ path: 'test-results/m2-recording.png' });
  await page.getByRole('button', { name: '녹음 끝내기' }).click();
  const f0 = page.getByTestId('sounds').getByTestId('sound-f0');
  await expect(f0).toContainText('Hz', { timeout: 10_000 });
  expect(cents(440, parseFloat((await f0.textContent())!))).toBeLessThan(5);

  await page.getByRole('link', { name: '분석하기' }).click();
  await expect(page.getByTestId('f0')).toContainText('Hz');
  // 구간을 화살표로 옮겨도 같은 음이 재어진다
  const wave = page.getByRole('group', { name: /잴 구간/ });
  await wave.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => cents(440, await hz(page))).toBeLessThan(5);
  // 손가락으로 끌어도 된다
  const box = (await wave.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => cents(440, await hz(page))).toBeLessThan(5);
});

test('소리 파일을 올리고, 소리가 든 백업으로 되살린다', async ({ page }) => {
  await newProject(page, '파일 탐구');
  await page.getByTestId('upload').setInputFiles('e2e/fixtures/a440.wav');
  const f0 = page.getByTestId('sounds').getByTestId('sound-f0');
  await expect(f0).toContainText('Hz', { timeout: 10_000 });

  await page.getByTestId('upload').setInputFiles({ name: '메모.wav', mimeType: 'audio/wav', buffer: Buffer.from('소리가 아님') });
  await expect(page.getByTestId('message')).toContainText('소리로 읽을 수 없습니다');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 저장' }).click()]);
  const path = await download.path();
  const backup = JSON.parse(await readFile(path, 'utf8'));
  expect(Object.keys(backup.clips)).toHaveLength(1);

  // 지우고 백업에서 되살리면 소리를 다시 잴 수 있다
  await page.getByRole('link', { name: '작업 목록으로 돌아가기' }).click();
  await page.getByRole('button', { name: '파일 탐구 지우기' }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await page.getByTestId('restore').setInputFiles(path);
  await page.getByTestId('projects').getByRole('link').click();
  await page.getByRole('link', { name: '분석하기' }).click();
  await expect(page.getByTestId('f0')).toContainText('Hz');
  expect(cents(440, await hz(page))).toBeLessThan(5);
});

test('세로 화면(753×1000)의 녹음실과 분석대: 넘치지 않고 누르는 곳이 48px 이상', async ({ page }) => {
  await page.setViewportSize({ width: 753, height: 1000 });
  await newProject(page, '세로 탐구');
  await take(page, '목소리 아');
  await take(page, '피아노 미');
  await expect(page.getByTestId('sounds').getByTestId('sound-f0')).toHaveCount(2);
  const check = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('a, button, input, [role=tab]')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.height < 47.5 || r.width < 47.5))
          .map(({ el, r }) => `${el.textContent?.trim().slice(0, 12)} ${Math.round(r.width)}×${Math.round(r.height)}`),
      ),
    ).toEqual([]);
  };
  await page.screenshot({ path: 'test-results/m2-listen-portrait.png', fullPage: false });
  await check();
  await page.getByRole('link', { name: /보기/ }).click();
  await expect(page.getByTestId('f0')).toContainText('Hz');
  await page.screenshot({ path: 'test-results/m2-see-portrait.png' });
  await check();
});
