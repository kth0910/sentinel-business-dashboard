// 리뷰 #5: 행을 번호가 아니라 id로 고친다. 다른 사람이 앞 행을 지워도 내가 고치던 행에 들어간다.
import { describe, expect, it } from 'vitest';
import { addRow, keyed, patchRow, removeRow } from './listEdit.ts';

const rows = [{ id: 'a', v: '1' }, { id: 'b', v: '2' }, { id: 'c', v: '3' }];

describe('row edits by id', () => {
  it('a patch lands on its row after someone else deleted an earlier row', () => {
    const latest = removeRow(rows, 'a'); // 다른 사람이 첫 행 삭제
    expect(patchRow(latest, 'b', { v: '내 입력' })).toEqual([{ id: 'b', v: '내 입력' }, { id: 'c', v: '3' }]);
  });

  it('a patch to a row someone deleted changes nothing', () => {
    expect(patchRow(removeRow(rows, 'b'), 'b', { v: 'x' })).toEqual([{ id: 'a', v: '1' }, { id: 'c', v: '3' }]);
  });

  it('rows saved before ids existed get stable positional ids', () => {
    const legacy = [{ v: '1' }, { v: '2' }];
    expect(keyed(legacy).map((r) => r.id)).toEqual(['i0', 'i1']);
    expect(patchRow(legacy, 'i1', { v: 'x' })).toEqual([{ id: 'i0', v: '1' }, { id: 'i1', v: 'x' }]);
  });

  it('adds a row with a fresh id', () => {
    const next = addRow(rows, { v: '4' });
    expect(next).toHaveLength(4);
    expect(new Set(next.map((r) => r.id)).size).toBe(4);
  });
});
