import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fakeMic = fileURLToPath(new URL('./e2e/fixtures/a440.wav', import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // 갤럭시 탭 S7 가로 방향 실측(2026-11-12): 약 1036×700 CSS px. 세로는 테스트 안에서 753×1000으로 바꿔 본다
    viewport: { width: 1036, height: 700 },
    hasTouch: true,
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeMic}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
