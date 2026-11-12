import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages 하위 경로와 압축 파일 배포 양쪽에서 동작하도록 상대 경로를 쓴다
  base: './',
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Math-Composer 2 — 소리의 수학',
        short_name: '소리의 수학',
        description: '소리를 녹음해 측정하고, 음계의 수학을 확인하고, 곡을 짓는다.',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#1d2b3a',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // 기본 설정은 글꼴과 소리 파일을 캐시하지 않는다. 오프라인에서 빠지는 것이 없도록 모두 적는다
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,woff,ttf,wav,mp3,ogg,m4a,json,webmanifest}'],
        // 시안 세 가지의 글꼴(약 18MB)은 미리 캐시하지 않는다. 서체가 정해지면 한글 2,350자로 줄여 내장하고 이 줄을 지운다
        globIgnores: ['design/**', '**/*.woff', '**/*.woff2'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: null,
      },
    }),
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        // 고른 시안(나). 실제 화면이 만들어지면 지운다
        na: 'design/na.html',
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
