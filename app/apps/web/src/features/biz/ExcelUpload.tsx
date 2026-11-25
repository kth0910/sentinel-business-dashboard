// 업무관리시스템 엑셀(.xlsx) 업로드 버튼. 결과는 토스트로, 성공하면 매출 블록 전부 새로고침.
import { useRef, useState } from 'react';
import { useUI } from '../../lib/store/ui.ts';
import { biz } from './api.ts';
import { isolate } from './fields.tsx';
import { refreshSales } from './sales.ts';

export function ExcelUpload({ date }: { date: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      useUI.getState().toast('.xlsx 파일만 올릴 수 있습니다');
      return;
    }
    setBusy(true);
    try {
      let r;
      try {
        r = await biz.importSales(date, file);
      } catch (e: any) {
        // 직전 업로드보다 본 영업 건이 많이 빠진 파일(필터된 엑셀 등): 확인 후에만 반영
        if (e?.status !== 409 || !confirm(`${e.message}

그래도 이 파일로 반영할까요?`)) throw e.status === 409 ? new Error('업로드를 취소했습니다') : e;
        r = await biz.importSales(date, file, true);
      }
      const n = (v: number) => v.toLocaleString('ko-KR');
      const msg = r.baseline
        ? `${n(r.rowCount)}건을 기준 데이터로 저장했습니다`
        : `${n(r.rowCount)}건 반영 · 변동 ${n(r.changeCount)}건${r.missingCount ? ` (빠진 건 ${n(r.missingCount)})` : ''}`;
      useUI.getState().toast(r.warnings.length ? `${msg} (확인 필요 ${r.warnings.length}건)` : msg);
      refreshSales();
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '업로드에 실패했습니다');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={input} type="file" accept=".xlsx" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />
      <button {...isolate} type="button" className="biz-btn biz-btn-primary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '반영 중…' : '엑셀 업로드'}
      </button>
    </>
  );
}
