/** 단계 목록 (작업지시서 3.1절, 5.1절). 번호는 실제 수업 순서다 */

export const STAGES = [
  {
    id: 'listen',
    name: '듣기',
    place: '녹음실',
    does: '소리 두세 개를 녹음하거나 예시음을 골라 내 소리 카드를 만듭니다.',
    tex: 'f = \\dfrac{1}{T}',
    opens: '12월 6일',
  },
  {
    id: 'see',
    name: '보기',
    place: '분석대',
    does: '파형에서 구간을 골라 기본 주파수와 배음을 읽고, 사인 그래프를 겹쳐 맞춥니다.',
    tex: 'y = A\\sin(2\\pi f t + \\phi)',
    opens: '12월 6일',
  },
  {
    id: 'count',
    name: '세기',
    place: '비율 실험실',
    does: '반음 한 칸에 주파수가 어떻게 변하는지 예측하고 측정값으로 확인합니다.',
    tex: 'r^{12} = 2,\\quad r = 2^{\\frac{1}{12}}',
    opens: '12월 13일',
  },
  {
    id: 'build',
    name: '짓기',
    place: '음계 공방',
    does: '순정률과 평균율의 차이를 센트로 재고, 곡에 쓸 내 음계를 정합니다.',
    tex: '1200\\log_2 \\dfrac{f_2}{f_1}',
    opens: '12월 13일',
  },
  {
    id: 'make',
    name: '만들기',
    place: '작곡실',
    does: '내 음계와 내 음색으로 여덟 마디를 짓습니다.',
    tex: '',
    opens: '12월 20일',
  },
  {
    id: 'bind',
    name: '묶기',
    place: '앨범',
    does: '보고서와 소리 파일, 앨범을 내보내 제출합니다.',
    tex: '',
    opens: '12월 27일',
  },
  {
    id: 'more',
    name: '심화',
    place: '심화 탐구',
    does: '간섭과 소음 지우기, 음색 설계, 왜 12인가, 0원 악기 가운데 골라 탐구합니다.',
    tex: '',
    opens: '12월 27일',
  },
] as const;

export type StageId = (typeof STAGES)[number]['id'];
