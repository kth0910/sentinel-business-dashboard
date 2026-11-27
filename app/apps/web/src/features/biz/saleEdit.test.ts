// 수정 창에서 저장할 내용 만들기: 바뀐 칸만 보내고, '원래 값으로'는 null, 구분은 있는 이름이면 id·없으면 새 이름.
import { describe, expect, it } from 'vitest';
import { buildSaleEdit, parseAmount, type FieldState } from './saleEdit.ts';

const st = (field: string, kind: FieldState['kind'], initial: string, draft = initial, reset = false): FieldState => ({ field, kind, initial, draft, reset });
const cats = [{ id: 'raise', label: '목표매출 상향', position: 1, system: false }, { id: 'unclassified', label: '미분류', position: 99, system: true }];

describe('parseAmount', () => {
  it('reads commas, 원, spaces and a minus sign', () => {
    expect(parseAmount('1,500,000원')).toBe(1_500_000);
    expect(parseAmount(' −20,000 ', true)).toBe(-20_000);
    expect(parseAmount('+300', true)).toBe(300);
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc', true)).toBeNull();
  });
});

describe('buildSaleEdit', () => {
  it('sends only what changed', () => {
    const r = buildSaleEdit([st('customer', 'text', '가', '가'), st('weight', 'option', 'Low(10%)', 'High(100%)'), st('amount', 'number', '100', '1,200')], cats);
    expect(r).toEqual({ edit: { fields: { weight: 'High(100%)', amount: 1200 } } });
  });

  it('nothing changed → empty edit', () => {
    expect(buildSaleEdit([st('customer', 'text', '가')], cats)).toEqual({ edit: {} });
  });

  it('원래 값으로 → null', () => {
    expect(buildSaleEdit([st('customer', 'text', '나', '가', true)], cats)).toEqual({ edit: { fields: { customer: null } } });
  });

  it('구분: an existing name is sent as id, a new name as categoryLabel', () => {
    expect(buildSaleEdit([st('category', 'category', '미분류', '목표매출 상향')], cats)).toEqual({ edit: { categoryId: 'raise' } });
    expect(buildSaleEdit([st('category', 'category', '미분류', ' 단가 조정 ')], cats)).toEqual({ edit: { categoryLabel: '단가 조정' } });
    expect(buildSaleEdit([st('category', 'category', '미분류', '')], cats).error).toBeTruthy();
  });

  it('증감액: a signed number, or null to go back to the computed one', () => {
    expect(buildSaleEdit([st('delta', 'delta', '80', '-20')], cats)).toEqual({ edit: { delta: -20 } });
    expect(buildSaleEdit([st('delta', 'delta', '-20', '80', true)], cats)).toEqual({ edit: { delta: null } });
    expect(buildSaleEdit([st('delta', 'delta', '80', '없음')], cats).error).toBeTruthy();
  });

  it('bad amount is an error, not a save', () => {
    expect(buildSaleEdit([st('amount', 'number', '100', '-1')], cats).error).toBeTruthy();
  });

  it('date can be emptied', () => {
    expect(buildSaleEdit([st('revenueDate', 'date', '2026-12-31', '')], cats)).toEqual({ edit: { fields: { revenueDate: '' } } });
  });
});
