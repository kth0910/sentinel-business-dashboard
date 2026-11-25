// '/' 메뉴 숨김 규칙: 같은 id에 여러 모듈이 규칙을 걸면 하나라도 숨기면 숨긴다(등록 순서와 무관).
import { describe, expect, it } from 'vitest';
import { applySlashOverrides, hideSlashItemWhen } from './registry.ts';

const item = (id: string) => ({ id, apply: () => {} });

describe('hideSlashItemWhen', () => {
  it('keeps an item hidden when a later module registers a rule that would show it', () => {
    hideSlashItemWhen('t-ai', () => true);
    hideSlashItemWhen('t-ai', () => false);
    expect(applySlashOverrides([item('t-ai'), item('t-text')]).map((i) => i.id)).toEqual(['t-text']);
  });
});
