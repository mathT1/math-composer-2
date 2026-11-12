/** 화면에 쓰는 시각과 파일 저장 */

const clock = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });

/** 오늘이면 “오후 4:47”, 아니면 “11월 12일 오후 4:47” */
export function when(time: number, now = Date.now()): string {
  const d = new Date(time);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? clock.format(d) : `${day.format(d)} ${clock.format(d)}`;
}

/** 파일을 내려받게 한다 */
export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
