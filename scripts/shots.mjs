// 디자인 시안을 태블릿 크기로 찍는다: node scripts/shots.mjs ga na da
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const names = process.argv.slice(2);
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
for (const name of names) {
  await page.goto(`http://localhost:5199/design/${name}.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const frames = page.locator('.frame');
  for (let i = 0; i < (await frames.count()); i++) {
    await frames.nth(i).screenshot({ path: `test-results/${name}-${i + 1}.png` });
  }
}
console.log(problems.length ? problems.join('\n') : '오류 없음');
await browser.close();
await server.close();
