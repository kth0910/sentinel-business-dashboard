import { describe, expect, it } from 'vitest';
import { normalizeRows, SalesImportError } from '../src/normalize.ts';

const HEAD = ['번호', '구분', '영업대표', '영업코드', '사용고객', '계약사', '제품/서비스', '공급가', '영업진행사항', '계약일', '로그수', '영업개시일', '마지막 로그일', '최종영업확도'];

function row(over: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    번호: 1, 구분: '본 영업', 영업대표: '홍길동', 영업코드: 8225, 사용고객: '고객사 A', 계약사: '협력사 A',
    '제품/서비스': 'CF v4.0(Cloud)', 공급가: 9600000, 영업진행사항: '진행', 계약일: '2026-11-17 00:00:00.0',
    로그수: 1, 영업개시일: '2026-11-24', '마지막 로그일': null, 최종영업확도: '중A', ...over,
  };
  return HEAD.map((h) => base[h]);
}

describe('normalizeRows', () => {
  it('maps a row', () => {
    const { rows, warnings } = normalizeRows([HEAD, row()]);
    expect(warnings).toEqual([]);
    expect(rows[0]).toEqual({
      key: '8225::CF v4.0(Cloud)', code: 8225, product: 'CF v4.0(Cloud)', division: '본 영업', rep: '홍길동',
      customer: '고객사 A', contractor: '협력사 A', amount: 9600000, progress: '진행', contractDate: '2026-11-17',
      startDate: '2026-11-24', probability: '중A', isCloud: true, weight: null, revenueType: null, revenueDate: null,
    });
  });

  // 가중치·매출 구분·매출일정: 지금 엑셀에는 없고 업무관리시스템 API로 받을 열. 있으면 읽는다.
  it('reads 가중치, 매출 구분, 매출일정 when the columns exist', () => {
    const head = [...HEAD, '가중치', '매출 구분', '매출일정'];
    const { rows } = normalizeRows([head, [...row(), 'High(100%)', '과업매출', '2026-12-18 00:00:00.0']]);
    expect(rows[0]).toMatchObject({ weight: 'High(100%)', revenueType: '과업매출', revenueDate: '2026-12-18' });
  });

  it('empty date and null probability', () => {
    const { rows } = normalizeRows([HEAD, row({ 계약일: '', 최종영업확도: null, '제품/서비스': 'ImageFilter 4C' })]);
    expect(rows[0].contractDate).toBeNull();
    expect(rows[0].probability).toBe('');
    expect(rows[0].isCloud).toBe(false);
  });

  it('same code different products are separate rows', () => {
    const { rows } = normalizeRows([HEAD, row({ '제품/서비스': 'A' }), row({ '제품/서비스': 'B' })]);
    expect(rows.map((r) => r.key)).toEqual(['8225::A', '8225::B']);
  });

  it('duplicate key sums amount with a warning', () => {
    const { rows, warnings } = normalizeRows([HEAD, row({ 공급가: 100 }), row({ 공급가: 50 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(150);
    expect(warnings).toHaveLength(1);
  });

  it('missing columns throws', () => {
    expect(() => normalizeRows([['번호', '구분']])).toThrow(SalesImportError);
    try {
      normalizeRows([['번호', '구분']]);
    } catch (e) {
      expect((e as SalesImportError).missing).toContain('영업코드');
      expect((e as SalesImportError).missing).not.toContain('구분');
    }
  });

  it('column order does not matter', () => {
    const order = [...HEAD].reverse();
    const r = row();
    const reversed = order.map((h) => r[HEAD.indexOf(h)]);
    expect(normalizeRows([order, reversed]).rows).toEqual(normalizeRows([HEAD, r]).rows);
  });

  it('blank trailing rows are skipped', () => {
    const { rows } = normalizeRows([HEAD, row(), HEAD.map(() => null), []]);
    expect(rows).toHaveLength(1);
  });

  it('header cells are trimmed', () => {
    const { rows } = normalizeRows([HEAD.map((h) => ` ${h} `), row()]);
    expect(rows).toHaveLength(1);
  });
});
