// 변동 구분 관리: 추가·이름 변경·삭제. '미분류'는 삭제할 수 없다(설계 7.2).
import { useState } from 'react';
import type { Category } from '@nc/biz';
import { useUI } from '../../lib/store/ui.ts';
import { biz } from './api.ts';
import { Field, isolate } from './fields.tsx';
import { refreshSales } from './sales.ts';

export function CategoryManager({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const [list, setList] = useState(categories);
  const [label, setLabel] = useState('');
  const act = async (fn: () => Promise<{ categories: Category[] }>) => {
    try {
      setList((await fn()).categories);
      refreshSales();
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '처리하지 못했습니다');
    }
  };
  return (
    <div className="biz-cats">
      <div className="biz-block-head">
        <h3>변동 구분 관리</h3>
        <button {...isolate} type="button" className="biz-link" onClick={onClose}>닫기</button>
      </div>
      {list.map((c) => (
        <div key={c.id} className="biz-row">
          <Field ariaLabel={`${c.label} 이름`} value={c.label} readOnly={c.system} onCommit={(v) => void act(() => biz.saveCategory({ id: c.id, label: v }))} />
          {c.system
            ? <span className="biz-note">기본 구분</span>
            : <button {...isolate} type="button" className="biz-link" onClick={() => { if (confirm(`'${c.label}' 구분을 삭제할까요? 이 구분이 붙은 변동은 미분류로 옮겨집니다.`)) void act(() => biz.deleteCategory(c.id)); }}>삭제</button>}
        </div>
      ))}
      <form className="biz-row" onSubmit={(e) => { e.preventDefault(); if (label.trim()) void act(() => biz.saveCategory({ label })).then(() => setLabel('')); }}>
        <input {...isolate} className="biz-input" value={label} placeholder="새 구분 이름" aria-label="새 구분 이름" onChange={(e) => setLabel(e.target.value)} />
        <button {...isolate} type="submit" className="biz-btn">추가</button>
      </form>
    </div>
  );
}
