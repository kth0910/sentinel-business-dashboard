import { describe, expect, it } from 'vitest';
import { applicantTotal, normalizeRow, splitStatus } from './hiringCount.ts';

describe('채용 현황 숫자', () => {
  it('숫자는 그대로, 음수·소수는 0 이상 정수로', () => {
    expect(splitStatus(3)).toEqual({ count: 3, rest: '' });
    expect(splitStatus(-2)).toEqual({ count: 0, rest: '' });
    expect(splitStatus(2.6)).toEqual({ count: 3, rest: '' });
  });

  it('예전 글자 현황을 읽는다', () => {
    expect(splitStatus('해당자 없음')).toEqual({ count: 0, rest: '' });
    expect(splitStatus('')).toEqual({ count: 0, rest: '' });
    expect(splitStatus('해당자 3명 · 전화면접 예정')).toEqual({ count: 3, rest: '전화면접 예정' });
    expect(splitStatus('해당자 3명 (전화면접 예정)')).toEqual({ count: 3, rest: '전화면접 예정' });
    expect(splitStatus('12')).toEqual({ count: 12, rest: '' });
    expect(splitStatus('면접 진행 중')).toEqual({ count: 0, rest: '면접 진행 중' });
  });

  it('남는 글자는 비고로 옮기고, 비고가 있으면 앞에 붙인다', () => {
    expect(normalizeRow({ role: '경영지원', status: '해당자 3명 · 전화면접 예정', note: '' })).toEqual({ role: '경영지원', status: 3, note: '전화면접 예정' });
    expect(normalizeRow({ role: '경영지원', status: '해당자 3명 · 전화면접 예정', note: '11/26' })).toEqual({ role: '경영지원', status: 3, note: '전화면접 예정 · 11/26' });
    expect(normalizeRow({ role: '엔지니어', status: 2, note: '서류' })).toEqual({ role: '엔지니어', status: 2, note: '서류' });
  });

  it('지원자는 현황의 합계', () => {
    expect(applicantTotal([])).toBe(0);
    expect(applicantTotal([
      { role: 'A', status: '해당자 없음', note: '' },
      { role: 'B', status: '해당자 3명 · 전화면접 예정', note: '' },
      { role: 'C', status: 4, note: '' },
    ])).toBe(7);
  });
});
