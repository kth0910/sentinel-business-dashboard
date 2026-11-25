// 일정 시간 표시·입력. 저장은 항상 'HH:MM'(24시간)이고, 화면 표시만 사용자 설정(오전/오후 또는 24시간)을 따른다.
export type TimeMode = '12h' | '24h';

const pad = (n: number) => String(n).padStart(2, '0');

/** 'HH:MM' → '오전 9:00'(12h) 또는 '09:00'(24h). 빈 값은 빈 문자열. */
export function formatTime(hhmm: string, mode: TimeMode): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return '';
  const h = Number(m[1]);
  if (mode === '24h') return `${m[1]}:${m[2]}`;
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m[2]}`;
}

/**
 * 사람이 친 시간 → 'HH:MM'. 빈 입력은 ''(지우기), 알아볼 수 없으면 null.
 * 받는 형태: 14:30, 9, 930, 1430, 오후 2:30, 2:30pm, 12am, 오후 2시, 2시 30분.
 */
export function parseTime(input: string): string | null {
  let s = (input ?? '').trim().toLowerCase();
  if (!s) return '';
  let meridiem: 'am' | 'pm' | null = null;
  if (/오전|a\.?m\.?/.test(s)) meridiem = 'am';
  else if (/오후|p\.?m\.?/.test(s)) meridiem = 'pm';
  s = s.replace(/오전|오후|a\.?m\.?|p\.?m\.?/g, '').trim();

  let h: number;
  let min: number;
  const ko = /^(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?$/.exec(s);
  const compact = s.replace(/\s+/g, '');
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(compact);
  if (ko) {
    h = Number(ko[1]);
    min = Number(ko[2] ?? 0);
  } else if (colon) {
    h = Number(colon[1]);
    min = Number(colon[2]);
  } else if (/^\d{1,4}$/.test(compact)) {
    if (compact.length <= 2) {
      h = Number(compact);
      min = 0;
    } else {
      h = Number(compact.slice(0, compact.length - 2));
      min = Number(compact.slice(-2));
    }
  } else {
    return null;
  }

  if (min > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = meridiem === 'am' ? h % 12 : (h % 12) + 12;
  } else if (h > 23) {
    return null;
  }
  return `${pad(h)}:${pad(min)}`;
}
