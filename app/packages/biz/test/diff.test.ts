import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/diff.ts';
import type { SalesRow } from '../src/types.ts';

function r(over: Partial<SalesRow> = {}): SalesRow {
  return {
    key: '1::A', code: 1, product: 'A', division: '본 영업', rep: '홍길동', customer: '고객사 A', contractor: '협력사 A',
    amount: 100, progress: '진행', contractDate: null, startDate: '2026-11-01', probability: '중A', isCloud: false, ...over,
  };
}

describe('diffSnapshots', () => {
  it('first import is baseline', () => {
    expect(diffSnapshots(null, [r()])).toEqual([]);
  });

  it('no change yields nothing', () => {
    expect(diffSnapshots([r()], [r()])).toEqual([]);
  });

  it('new row', () => {
    const [c] = diffSnapshots([], [r({ amount: 300 })]);
    expect(c.kind).toBe('new');
    expect(c.delta).toBe(300);
    expect(c.before).toBeNull();
  });

  it('removed row', () => {
    const [c] = diffSnapshots([r({ amount: 300 })], []);
    expect(c.kind).toBe('exclude');
    expect(c.delta).toBe(-300);
    expect(c.after).toBeNull();
  });

  it('confirm wins over raise', () => {
    const [c] = diffSnapshots([r()], [r({ probability: '확정', amount: 120 })]);
    expect(c.kind).toBe('confirm');
    expect(c.delta).toBe(20);
  });

  it('drop to low probability', () => {
    const [c] = diffSnapshots([r({ probability: '중B' })], [r({ probability: '하' })]);
    expect(c.kind).toBe('exclude');
    expect(c.delta).toBe(-100);
  });

  it('progress to 보류', () => {
    const [c] = diffSnapshots([r()], [r({ progress: '보류' })]);
    expect(c.kind).toBe('exclude');
  });

  it('already low stays not exclude', () => {
    const [c] = diffSnapshots([r({ probability: '하' })], [r({ probability: '매우낮음' })]);
    expect(c.kind).toBe('unclassified');
  });

  it('amount up', () => {
    const [c] = diffSnapshots([r()], [r({ amount: 150 })]);
    expect(c.kind).toBe('raise');
    expect(c.delta).toBe(50);
    expect(c.diffs).toEqual([{ field: 'amount', before: 100, after: 150 }]);
  });

  it('amount down is unclassified', () => {
    const [c] = diffSnapshots([r({ amount: 150 })], [r({ amount: 100 })]);
    expect(c.kind).toBe('unclassified');
    expect(c.delta).toBe(-50);
  });

  it('non-main rows ignored', () => {
    expect(diffSnapshots([r({ division: '기획영업' })], [r({ division: '기획영업', amount: 999 })])).toEqual([]);
  });

  it('text-only change ignored', () => {
    expect(diffSnapshots([r()], [r({ customer: '고객사 B', rep: '김철수' })])).toEqual([]);
  });

  it('sorted by absolute delta then key', () => {
    const prev = [r({ key: 'a', amount: 100 }), r({ key: 'b', amount: 100 }), r({ key: 'c', amount: 100 })];
    const curr = [r({ key: 'a', amount: 110 }), r({ key: 'b', amount: 50 }), r({ key: 'c', amount: 110 })];
    expect(diffSnapshots(prev, curr).map((c) => c.key)).toEqual(['b', 'a', 'c']);
  });

  // 리뷰 #3: 이미 목표에서 빠진 건(확도 하·매우낮음 또는 보류·실패)은 다시 빼지 않는다
  it('low then stopped is not excluded twice', () => {
    const [c] = diffSnapshots([r({ probability: '하' })], [r({ probability: '하', progress: '실패' })]);
    expect(c.kind).toBe('unclassified');
    expect(c.delta).toBe(0);
  });

  it('removed after being excluded subtracts nothing', () => {
    const [c] = diffSnapshots([r({ probability: '하' })], []);
    expect(c.kind).toBe('exclude');
    expect(c.delta).toBe(0);
  });

  it('amount up on an excluded row is not a raise', () => {
    const [c] = diffSnapshots([r({ progress: '보류' })], [r({ progress: '보류', amount: 500 })]);
    expect(c.kind).toBe('unclassified');
    expect(c.delta).toBe(0);
  });

  it('coming back from low probability adds the amount back', () => {
    const [c] = diffSnapshots([r({ probability: '하' })], [r({ probability: '중A', amount: 120 })]);
    expect(c.kind).toBe('unclassified');
    expect(c.delta).toBe(120);
  });

  it('confirming an excluded row counts its full amount', () => {
    const [c] = diffSnapshots([r({ probability: '하' })], [r({ probability: '확정' })]);
    expect(c.kind).toBe('confirm');
    expect(c.delta).toBe(100);
  });
});
