import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function newProject(page: Page, name: string, stage: RegExp) {
  await page.goto('/');
  await page.getByLabel('작업 이름').fill(name);
  await page.getByRole('button', { name: '작업 만들기' }).click();
  await expect(page.getByRole('heading', { name: '녹음실' })).toBeVisible();
  await page.getByRole('link', { name: stage }).click();
}

async function type(page: Page, testid: string, value: string) {
  const cell = page.getByTestId(testid);
  await cell.fill(value);
  await cell.press('Tab');
}

const mark = (page: Page, testid: string) => page.getByTestId(testid).locator('xpath=following-sibling::span[1]');

test('3차시: 예측하고, r을 찾고, 평균율 계산표를 채운다', async ({ page, baseURL }) => {
  const outside: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await newProject(page, '반음 탐구', /세기/);
  await expect(page.getByRole('heading', { name: '비율 실험실' })).toBeVisible();

  // 같은 값을 더하는 예측: 차는 같고 비는 줄어든다
  const step = (523.26 - 261.63) / 12;
  for (let k = 1; k <= 11; k++) await type(page, `pred-${k}`, (261.63 + step * k).toFixed(2));
  const rows = page.getByTestId('prediction').locator('tbody tr');
  await expect(rows.nth(1).locator('td').nth(3)).toHaveText('21.80');
  await expect(rows.nth(1).locator('td').nth(4)).toHaveText('1.0833');
  await expect(rows.nth(11).locator('td').nth(4)).toHaveText('1.0455');
  await page.getByRole('button', { name: '내 예측 듣기' }).click();
  await expect(page.getByRole('button', { name: '멈추기' })).toBeVisible();
  await page.getByRole('button', { name: '멈추기' }).click();

  // r 찾기
  await type(page, 'r', '1.06');
  await expect(page.getByText('2보다 큽니다')).toBeVisible();
  await type(page, 'r', '1.05946');
  await expect(page.getByTestId('r12')).toContainText('1.99993'); // 1.05946¹²
  await expect(page.getByText('2에 아주 가깝습니다')).toBeVisible();
  await page.getByRole('button', { name: '+0.001' }).click();
  await expect(page.getByTestId('r')).toHaveValue('1.06046');

  // 계산표: 맞음과 다시
  await type(page, 'eq-1', '277.18');
  await expect(mark(page, 'eq-1')).toHaveText('맞음');
  await type(page, 'eq-2', '293.66');
  await expect(mark(page, 'eq-2')).toHaveText('맞음');
  await type(page, 'eq-3', '311.5');
  await expect(mark(page, 'eq-3')).toHaveText('다시');
  await type(page, 'eq-3', '311,13'); // 쉼표로 적어도 읽는다
  await expect(mark(page, 'eq-3')).toHaveText('맞음');
  await type(page, 'eq-7', '392.00');
  await expect(mark(page, 'eq-7')).toHaveText('맞음');
  await type(page, 'eq-12', '약 523');
  await expect(mark(page, 'eq-12')).toHaveText('수만');
  await expect(page.getByTestId('equal-count')).toContainText('4칸');
  // 이웃 칸과의 비가 같다
  await expect(page.getByTestId('equal').locator('tbody tr').nth(2).locator('td').nth(3)).toHaveText('1.0595');
  await page.screenshot({ path: 'test-results/m3-count-landscape.png' });

  // 다시 열어도 적은 것이 남는다
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('pred-5')).toHaveValue((261.63 + step * 5).toFixed(2));
  await expect(mark(page, 'eq-3')).toHaveText('맞음');

  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('4차시: 센트 유도표, 두 음 비교와 맥놀이', async ({ page }) => {
  await newProject(page, '센트 탐구', /세기/);
  await page.getByRole('tab', { name: '센트와 맥놀이' }).click();

  const fill = async (row: string, oct: string, semi: string, cent: string) => {
    await type(page, `cent-${row}-oct`, oct);
    await type(page, `cent-${row}-semi`, semi);
    await type(page, `cent-${row}-cent`, cent);
  };
  await fill('fifth', '0.585', '7.02', '702');
  await expect(mark(page, 'cent-fifth-cent')).toHaveText('맞음');
  await type(page, 'cent-third-oct', '0.32');
  await expect(mark(page, 'cent-third-oct')).toHaveText('다시');
  await expect(page.getByTestId('cent-formula')).toHaveCount(0);
  await fill('third', '0.3219', '3.863', '386.31');
  await fill('semi', '0.0833', '1', '100');
  await expect(page.getByTestId('cent-formula')).toBeVisible();

  // 장3도: 순정률과 평균율
  await expect(page.getByTestId('gap')).toContainText('13.69센트 높습니다');
  await expect(page.getByTestId('beat-diff')).toHaveText('2.60 Hz'); // 329.6333 − 327.0375. 반올림한 표의 값끼리 빼면 2.59
  await page.getByRole('button', { name: '함께 울리기' }).click();
  await expect(page.getByRole('button', { name: '멈추기' })).toBeVisible();
  await page.getByRole('button', { name: '멈추기' }).click();
  await page.screenshot({ path: 'test-results/m3-beats-landscape.png', fullPage: false });

  // 완전5도의 순정률과 피타고라스는 같은 높이
  await page.getByRole('button', { name: '도에서 완전5도' }).click();
  await page.getByRole('button', { name: '둘째 소리로 피타고라스' }).click();
  await expect(page.getByTestId('gap')).toHaveText('두 소리의 높이가 같습니다.');
  await expect(page.getByTestId('beat-diff')).toHaveText('0.00 Hz');
});

test('음계 공방: 음계를 고르고 내 음계로 정한다', async ({ page }) => {
  await newProject(page, '음계 탐구', /짓기/);
  await expect(page.getByRole('heading', { name: '음계 공방' })).toBeVisible();
  await expect(page.getByTestId('my-scale')).toHaveText('12평균율');

  await page.getByRole('button', { name: '순정률 장음계' }).click();
  const table = page.getByTestId('scale-table');
  await expect(table.locator('tbody tr')).toHaveCount(7);
  await expect(table.locator('tbody tr').nth(2)).toContainText('386.31');
  await expect(table.locator('tbody tr').nth(2)).toContainText('327.04 Hz');
  await expect(table.locator('tbody tr').nth(2)).toContainText('−13.69');
  await page.getByRole('button', { name: '미 듣기' }).click();
  await page.screenshot({ path: 'test-results/m3-build-landscape.png' });

  await page.getByRole('button', { name: '이 음계를 내 음계로 쓰기' }).click();
  await expect(page.getByTestId('scale-notice')).toContainText('순정률 장음계');
  await expect(page.getByTestId('my-scale')).toHaveText('순정률 장음계');
  await expect(page.getByTestId('state')).toContainText('순정률 장음계');

  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.getByTestId('my-scale')).toHaveText('12평균율');
});

test('곡이 있을 때 음계를 바꾸면 묻고, 음을 가장 가까운 음으로 옮기고, 되돌린다 (5.6절)', async ({ page }, info) => {
  // 12평균율의 미(4)·파(5)·솔(7)과 화음 [4, 5]가 든 백업을 만든다
  await newProject(page, '곡 있는 작업', /짓기/);
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 저장' }).click()]);
  const backup = JSON.parse(await readFile(await d1.path(), 'utf8'));
  backup.project.id = 'with-song';
  backup.project.name = '곡 있는 작업 2';
  backup.project.song.melody[0] = 4;
  backup.project.song.melody[1] = 5;
  backup.project.song.melody[2] = 7;
  backup.project.song.chords[0] = [4, 5];
  const file = info.outputPath('with-song.json');
  await writeFile(file, JSON.stringify(backup));

  await page.getByRole('link', { name: '작업 목록으로 돌아가기' }).click();
  await page.getByTestId('restore').setInputFiles(file);
  await page.getByTestId('projects').getByRole('link', { name: /곡 있는 작업 2/ }).click();
  await expect(page.getByTestId('state')).toContainText('곡 1/8마디');
  await page.getByRole('link', { name: /짓기/ }).click();

  await page.getByRole('button', { name: '5음계' }).click();
  await page.getByRole('button', { name: '이 음계를 내 음계로 쓰기' }).click();
  await expect(page.getByTestId('remap-ask')).toBeVisible();
  await page.getByRole('button', { name: '바꾸고 곡의 음 옮기기' }).click();
  await expect(page.getByTestId('scale-notice')).toContainText('가장 가까운 음으로 옮겼습니다');

  const melodyOf = async () => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 저장' }).click()]);
    return JSON.parse(await readFile(await d.path(), 'utf8')).project.song;
  };
  let song = await melodyOf();
  // 미(400)→미(2), 파(500)→미(2), 솔(700)→솔(3), 화음 [미, 파]→[미]
  expect(song.melody.slice(0, 3)).toEqual([2, 2, 3]);
  expect(song.chords[0]).toEqual([2]);

  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.getByTestId('my-scale')).toHaveText('12평균율');
  song = await melodyOf();
  expect(song.melody.slice(0, 3)).toEqual([4, 5, 7]);
  expect(song.chords[0]).toEqual([4, 5]);
});

test('세로 화면(753×1000)의 비율 실험실과 음계 공방: 넘치지 않고 누르는 곳이 48px 이상', async ({ page }) => {
  await page.setViewportSize({ width: 753, height: 1000 });
  await newProject(page, '세로 3~4차시', /세기/);
  const check = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('main a, main button, main input')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.height < 47.5 || r.width < 47.5))
          .map(({ el, r }) => `${(el as HTMLElement).getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 12)} ${Math.round(r.width)}×${Math.round(r.height)}`),
      ),
    ).toEqual([]);
  };
  await type(page, 'r', '1.05946');
  await page.screenshot({ path: 'test-results/m3-count-portrait.png' });
  await check();
  await page.getByRole('tab', { name: '센트와 맥놀이' }).click();
  await page.screenshot({ path: 'test-results/m3-cent-portrait.png' });
  await check();
  await page.getByRole('link', { name: /짓기/ }).click();
  await page.screenshot({ path: 'test-results/m3-build-portrait.png' });
  await check();
});
