/** 내장 예시음. 교사가 교실 물건과 악기로 직접 녹음한 소리 (원칙 5: 녹음이 안 돼도 완주) */

export const SAMPLES = [
  { id: 'recorder-c', label: '리코더 도', about: '기준이 되는 소리' },
  { id: 'recorder-g', label: '리코더 솔', about: '도에서 다섯째 음' },
  { id: 'recorder-c2', label: '리코더 높은 도', about: '도보다 한 옥타브 위' },
  { id: 'voice', label: '목소리 아', about: '배음이 많은 소리' },
  { id: 'piano-c', label: '피아노 도', about: '평균율로 조율한 악기' },
  { id: 'piano-e', label: '피아노 미', about: '도에서 셋째 음' },
  { id: 'piano-g', label: '피아노 솔', about: '도에서 다섯째 음' },
] as const;

export const sampleUrl = (id: string) => `${import.meta.env.BASE_URL}samples/${id}.wav`;
