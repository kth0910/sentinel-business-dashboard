// /form/<viewId> — the shareable respondent page of a form view (works signed-out for public forms).
// States: closed or deleted, not publicly available and requiring login, and submission confirmation.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api.ts';
import { navigate } from '../../../../lib/router.ts';
import { useSession } from '../../../../lib/store/session.ts';
import { FormRenderer, type PublicForm } from './FormRenderer.tsx';
import './form.css';

type Res = { status: 'ok' | 'closed' | 'login' | 'denied' | 'notfound'; form?: PublicForm; spaceName?: string };

export function PublicFormPage({ viewId }: { viewId: string }) {
  const status = useSession((s) => s.status);
  const [res, setRes] = useState<Res | null>(null);
  useEffect(() => {
    let alive = true;
    api<Res>('getPublicForm', { viewId })
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ status: 'notfound' }));
    return () => {
      alive = false;
    };
  }, [viewId, status]);

  useEffect(() => {
    if (res?.form?.title) document.title = res.form.title;
  }, [res?.form?.title]);

  let body;
  if (!res) body = <div className="nc-form-page-loading" />;
  else if (res.status === 'ok' && res.form) body = <FormRenderer form={res.form} />;
  else if (res.status === 'login') {
    body = (
      <div className="nc-form-state">
        <div className="nc-form-state-title">이 폼은 공개되어 있지 않습니다.</div>
        <div className="nc-form-state-sub">제출하려면 로그인하거나 폼 소유자에게 게시를 요청하세요.</div>
        <div role="button" className="nc-form-btn primary" onClick={() => navigate('/login')}>로그인</div>
      </div>
    );
  } else if (res.status === 'denied') {
    body = (
      <div className="nc-form-state">
        <div className="nc-form-state-title">이 폼은 공개되어 있지 않습니다.</div>
        <div className="nc-form-state-sub">Only members at {res.spaceName ?? 'this workspace'} can fill out this form.</div>
      </div>
    );
  } else {
    body = (
      <div className="nc-form-state">
        <div className="nc-form-state-title">이 폼은 마감되었거나 더 이상 사용할 수 없습니다.</div>
        <div className="nc-form-state-sub">문제가 있다고 생각되면 폼 소유자에게 문의하세요.</div>
      </div>
    );
  }
  return (
    <div className="nc-form-page lit-scroller vertical" data-form-view-id={viewId}>
      <div className="nc-form-page-inner">{body}</div>
    </div>
  );
}
