
export function relativeEdited(t: number | undefined): string {
  if (!t) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 편집';
  if (m < 60) return `${m}분 전 편집`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전 편집`;
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} 편집`;
}

export function formatDateTime(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const today = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (today) return `오늘 ${time}`;
  if (yesterday) return `어제 ${time}`;
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', year: 'numeric' })} ${time}`;
}

export function formatShortDate(t: number): string {
  return new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return '방금';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return formatShortDate(t);
}
