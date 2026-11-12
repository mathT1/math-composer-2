import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('시작 화면이 자기 주소 밖으로 요청하지 않고 오프라인 준비를 마친다', async ({ page, baseURL }) => {
  const outside: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '소리의 수학' })).toBeVisible();
  await expect(page.getByTestId('offline')).toContainText('준비가 됐습니다', { timeout: 20_000 });
  // 내장한 글꼴로 그려지는지
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("700 20px 'Hahmlet'", '소리의 수학'))).toBe(true);
  await page.screenshot({ path: 'test-results/m1-start-landscape.png' });
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('작업을 만들고, 다시 열어 이어하고, 백업으로 되살린다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '작업 만들기' }).click();
  await expect(page.getByTestId('message')).toContainText('작업 이름을 적어 주세요');

  await page.getByLabel('작업 이름').fill('리코더 소리 탐구');
  await page.getByLabel('학번').fill('20315');
  await page.getByLabel('이름 (적지 않아도 됩니다)').fill('김하늘');
  await page.getByRole('button', { name: '작업 만들기' }).click();

  await expect(page.getByTestId('project-name')).toHaveText('리코더 소리 탐구');
  await expect(page.getByRole('heading', { name: '녹음실' })).toBeVisible();
  await expect(page.getByTestId('saved')).toContainText('저장됨');
  await page.waitForTimeout(400); // 표지가 접히는 움직임이 끝난 뒤
  await page.screenshot({ path: 'test-results/m1-stage-landscape.png' });
  expect(await page.evaluate(() => document.querySelector('.cover')!.scrollHeight <= window.innerHeight)).toBe(true);

  // 단계 이동: 앞 단계를 끝내지 않아도 갈 수 있다
  await page.getByRole('link', { name: /보기/ }).click();
  await expect(page.getByRole('heading', { name: '분석대' })).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /보기/ })).toHaveAttribute('aria-current', 'step');

  // 백업 저장
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 저장' }).click()]);
  expect(download.suggestedFilename()).toBe('20315_김하늘_소리의수학_백업.json');
  const backupPath = await download.path();
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backup.project.name).toBe('리코더 소리 탐구');

  // 다시 열어도 그 단계가 그대로 열린다
  await page.reload();
  await expect(page.getByRole('heading', { name: '분석대' })).toBeVisible();
  await expect(page.getByTestId('project-name')).toHaveText('리코더 소리 탐구');

  // 시작 화면의 이어하기
  await page.getByRole('link', { name: '작업 목록으로 돌아가기' }).click();
  const list = page.getByTestId('projects');
  await expect(list.getByRole('link')).toHaveCount(1);
  await expect(list).toContainText('김하늘');

  // 지우기는 한 번 더 묻는다
  await list.getByRole('button', { name: '리코더 소리 탐구 지우기' }).click();
  await expect(list).toContainText('되돌릴 수 없습니다');
  await list.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(page.getByText('저장된 작업이 아직 없습니다')).toBeVisible();

  // 백업에서 되살린다
  await page.getByTestId('restore').setInputFiles(backupPath);
  await expect(page.getByTestId('message')).toContainText('불러왔습니다');
  await page.getByTestId('projects').getByRole('link').click();
  await expect(page.getByTestId('project-name')).toHaveText('리코더 소리 탐구');
});

test('다른 파일을 불러오면 이유를 말하고, 없는 작업 주소는 시작 화면으로 보낸다', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('restore').setInputFiles({ name: '숙제.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByTestId('message')).toContainText('백업 파일이 아닙니다');
  await page.goto('/#/p/no-such/make');
  await expect(page.getByText('열려던 작업이 이 태블릿에 없습니다')).toBeVisible();
});

test('인터넷이 끊겨도 작업을 다시 열 수 있다', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('offline')).toContainText('준비가 됐습니다', { timeout: 20_000 });
  await page.getByLabel('작업 이름').fill('오프라인 작업');
  await page.getByRole('button', { name: '작업 만들기' }).click();
  await expect(page.getByTestId('saved')).toContainText('저장됨');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveText('오프라인 작업');
  await page.getByRole('link', { name: /세기/ }).click();
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("700 20px 'Hahmlet'", '비율 실험실'))).toBe(true);
});

test('세로로 든 화면(753×1000)에서 가로로 넘치지 않고 누르는 곳이 48px 이상이다', async ({ page }) => {
  await page.setViewportSize({ width: 753, height: 1000 });
  await page.goto('/');
  await page.getByLabel('작업 이름').fill('세로 화면 확인');
  await page.screenshot({ path: 'test-results/m1-start-portrait.png' });
  const tooSmall = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('a, button, input')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.height < 47.5 || r.width < 47.5))
        .map(({ el, r }) => `${el.textContent?.trim().slice(0, 12)} ${Math.round(r.width)}×${Math.round(r.height)}`),
    );
  expect(await tooSmall()).toEqual([]);
  await page.getByRole('button', { name: '작업 만들기' }).click();
  await expect(page.getByRole('heading', { name: '녹음실' })).toBeVisible();
  await page.screenshot({ path: 'test-results/m1-stage-portrait.png' });
  await page.setViewportSize({ width: 412, height: 800 });
  await page.screenshot({ path: 'test-results/m1-stage-narrow.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await tooSmall()).toEqual([]);
});

test('소리 엔진의 출력이 정해진 최대 음량을 넘지 않는다', async ({ page }) => {
  await page.goto('/#/check');
  await page.getByRole('button', { name: '출력 한계 확인' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('통과', { timeout: 15_000 });
});
