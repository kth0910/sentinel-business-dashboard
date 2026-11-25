// 일정 시간: 저장은 'HH:MM'(24시간), 표시는 사용자가 고른 형식(오전/오후 또는 24시간). 입력은 흔한 형태를 모두 받는다.
import { describe, expect, it } from 'vitest';
import { formatTime, parseTime } from './timeFormat.ts';

describe('formatTime', () => {
  it('shows 오전/오후 in 12-hour mode', () => {
    expect(formatTime('09:00', '12h')).toBe('오전 9:00');
    expect(formatTime('14:30', '12h')).toBe('오후 2:30');
    expect(formatTime('00:05', '12h')).toBe('오전 12:05');
    expect(formatTime('12:00', '12h')).toBe('오후 12:00');
  });

  it('shows HH:MM in 24-hour mode and nothing for an empty time', () => {
    expect(formatTime('09:00', '24h')).toBe('09:00');
    expect(formatTime('14:30', '24h')).toBe('14:30');
    expect(formatTime('', '12h')).toBe('');
  });
});

describe('parseTime', () => {
  it('reads 24-hour and compact input', () => {
    expect(parseTime('14:30')).toBe('14:30');
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('9:5')).toBe('09:05');
    expect(parseTime('930')).toBe('09:30');
    expect(parseTime('1430')).toBe('14:30');
    expect(parseTime(' 18 : 00 ')).toBe('18:00');
  });

  it('reads 오전/오후 and AM/PM', () => {
    expect(parseTime('오후 2:30')).toBe('14:30');
    expect(parseTime('오전 9:00')).toBe('09:00');
    expect(parseTime('오전 12:00')).toBe('00:00');
    expect(parseTime('오후 12:10')).toBe('12:10');
    expect(parseTime('2:30pm')).toBe('14:30');
    expect(parseTime('2:30 PM')).toBe('14:30');
    expect(parseTime('12am')).toBe('00:00');
  });

  it('reads 시/분 wording', () => {
    expect(parseTime('오후 2시')).toBe('14:00');
    expect(parseTime('2시 30분')).toBe('02:30');
    expect(parseTime('오후 3시 15분')).toBe('15:15');
  });

  it('clears on empty input and rejects nonsense', () => {
    expect(parseTime('')).toBe('');
    expect(parseTime('   ')).toBe('');
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('9:75')).toBeNull();
    expect(parseTime('오후 13:00')).toBeNull();
    expect(parseTime('회의')).toBeNull();
  });
});
