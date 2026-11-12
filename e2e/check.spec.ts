import { expect, test } from '@playwright/test';

test('기기 점검 페이지가 자기 주소 밖으로 요청하지 않는다', async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  });
  await page.goto('/#/check');
  await expect(page.getByRole('heading', { name: '기기 점검' })).toBeVisible();
  await expect(page.getByTestId('offline')).toContainText('준비 완료', { timeout: 20_000 });
  expect(outside).toEqual([]);
});

test('마이크로 440Hz를 측정하고 녹음한다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/#/check');
  await page.getByRole('button', { name: '마이크 켜기' }).click();
  await expect(page.getByTestId('mic')).toHaveText('켜짐', { timeout: 10_000 });

  const live = page.getByTestId('live');
  await expect(live).toContainText('Hz', { timeout: 10_000 });
  const hz = parseFloat((await live.textContent())!);
  expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(5);

  await page.getByRole('button', { name: '3초 녹음하기' }).click();
  const result = page.getByTestId('rec');
  await expect(result).toContainText('측정', { timeout: 10_000 });
  const measured = parseFloat((await result.textContent())!.match(/측정 ([\d.]+)Hz/)![1]);
  expect(Math.abs(1200 * Math.log2(measured / 440))).toBeLessThan(5);
  await page.screenshot({ path: 'test-results/check-mic.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('인터넷이 끊겨도 다시 열린다', async ({ page, context }) => {
  await page.goto('/#/check');
  await expect(page.getByTestId('offline')).toContainText('준비 완료', { timeout: 20_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '기기 점검' })).toBeVisible();
  // 오프라인에서도 녹음 처리기를 불러올 수 있어야 한다
  await page.getByRole('button', { name: '마이크 켜기' }).click();
  await expect(page.getByTestId('mic')).toHaveText('켜짐', { timeout: 10_000 });
});

test('저장 표식이 다시 열어도 남아 있다', async ({ page }) => {
  await page.goto('/#/check');
  await page.getByRole('button', { name: '표식 남기기' }).click();
  await expect(page.getByTestId('marker')).toContainText('방금 남김');
  await page.reload();
  await expect(page.getByTestId('marker')).toContainText('남아 있음');
});

test('파일 네 가지를 내려받는다', async ({ page }) => {
  await page.goto('/#/check');
  for (const [button, file] of [
    ['소리 파일', '점검_소리.wav'],
    ['앨범 HTML', '점검_앨범.html'],
    ['백업 파일', '점검_백업.json'],
    ['측정값 CSV', '점검_측정값.csv'],
  ]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button, exact: true }).click()]);
    expect(download.suggestedFilename()).toBe(file);
  }
});
